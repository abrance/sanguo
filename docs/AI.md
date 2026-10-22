# AI 行为逻辑

> 实现：`js/systems/ai.js`（势力经营与出兵）+ `js/systems/diplo.js` 的 `Diplo.ai`（外交）+ `js/systems/tech-system.js` 的 `_autoPick`（科研）
>
> 本文是 AI 行为的**唯一事实来源**。改 `ai.js` 里的任何阈值、概率、比例，同一次提交里同步本表；否则数字会像旧版 `DESIGN.md §6` 一样烂掉（那份已改成只留设计意图）。
>
> 当前核对版本：提交 `23b9f54` 之后的 `js/systems/ai.js`（218 行）

---

## 0. 定位

规则型 AI：**没有搜索、没有学习、没有对手模型**。每个势力每月按固定顺序跑几条 if + 随机数，靠 `RNG`（种子随机）做不确定性 —— 同种子同结果，所以可以在 `tools/verify.js` 里跑长跑复现。

决策质量的天花板由此决定：AI 会「算这一仗能不能赢」，但不会「为了三个月后的形势这仗先不打」。

---

## 1. 在回合流水线里的位置

`Turn.advance`（`js/systems/turn.js`）第 10 步调 `AI.run(G, stamp)`，紧跟在外交之后：

```
… 8.5 Diplo.advance（关系漂移 + AI 议和/宣战/结盟/援军）
9    Rank.monthly（声望与晋升）
10   AI.run（征税 → 营造 → 征兵 → 集结 → 多路出兵）
11   玩家失城流亡 / 12 势力存亡 / 13 胜负
```

顺序很重要：**外交先翻牌，AI 再按新的外交状态决定打谁**。同月刚宣战的势力，同月就可能出兵。

`AI.run` 遍历全部势力，跳过两类：

| 跳过条件 | 原因 |
|---|---|
| `f.kind === 'free'` | 在野势力没有城 |
| `f.dead` | 已覆灭 |

每个势力进来先算大势：`f.momentum = State.momentum(G, f.id)`，见 §7。

---

## 2. 玩家势力的非直辖城也由 AI 运作

如果只有 AI 势力会长大，玩家所在的势力必然被拖死，所以 `AI._support` 让玩家势力也跑完整逻辑，但**只操作非直辖城**：

```
managed = factionCities(player.factionId) − player.demesne
```

- 直辖城：完全不进 AI 的手，玩家自己经营
- 非直辖城：`_tax` / `_build` / `_recruit` / `_mass` / `_attack` 全跑，含出征（可能替你丢城）
- 直辖城仍计入势力总兵力、科技产出、大势占比
- `_mass` / `_attack` 额外传 `exclude = demesne` 兜底（理论上 `managed` 里已经没有直辖城，这层是防以后改逻辑时漏掉）

副作用：非直辖城玩家的兵会被调走。这是刻意的代价，不是 bug —— 见 `DESIGN.md §6`。

---

## 3. 经营三步

### 3.1 征税 `_tax`

```js
for (const c of cities) {
  const up = c.gold * 0.12;   // 各城城库 12% 上缴
  c.gold -= up; f.treasury += up;
}
f.treasury = Math.min(f.treasury, cities.length * 1100);   // 府库上限 = 城数 × 1100
```

府库只有三个出口：营造补贴、征兵后回补、外交（求和纳钱 ≤400、宣战 500）。没有别的花钱途径。

### 3.2 营造 `_build`

每城在有空闲工程位时（`Build.queueFree`，府衙 3 级才有 2 个并行位），按侵略性选一份优先级表，**只挑第一个能付得起的项目**：

| 条件 | 优先级表 |
|---|---|
| `aggression > 0.55`（好战） | `barracks farm drill stable wall ironworks academy office` |
| `aggression > 0.35`（中庸） | `farm market barracks wall office academy drill granary` |
| 其余（保守） | `farm market academy office granary wall barracks customs` |

细节与护栏：

- `c.mat < 40 && c.iron < 10` 直接跳过这城 —— 建材铁料靠本地，府库只补钱
- 府库补贴只补 `gold` 缺口：`take = min(treasury, cost.gold - c.gold)`
- 补贴后仍不够就跳过，换下一个项目；开工失败 `catch` 掉不报错

### 3.3 征兵 `_recruit`

```js
ratio  = 0.45 + aggression * 0.30       // 0.45 ~ 0.75
target = State.troopCapOf(c) * ratio
```

- 现兵 ≥ `target × 0.97` → 不招
- 单次缺口上限 `want ≤ pop × 1.6`，且 `want < 20` 不招
- 实际配兵交给 `Recruit.autoFill`，构成固定 `步 62% / 弓 26% / 骑 15% / 水 10% / 器 4%`，余量补步弓
- `autoFill` 自带粮草护栏：**存粮不足三个月开销（兵粮 + 人口口粮）就不加兵**
- 招完若城库 < 60，从府库回补 `min(treasury, 120)`，避免下月连营造都开不了工

---

## 4. 集结 `_mass`（把兵堆到前线）

目的：形成局部优势，而不是每城平均摊薄被各个击破。

**触发**（每次只判一次，不满足就整月不集结）：

```
cities.length ≥ 2
RNG.chance(0.16 + aggression × 0.20 + (momentum − 1) × 0.35)
```

**选点**：对每城按 70% 抽调后的兵算 `attackScore`，与 `235` 距离内每个非己方邻城的 `defenseScore` 相减，取 `edge` 最大的一组 `{staging → target}`。抽调后不足 150 兵的前线城市不参评。

**上限**：`staging.garrison + 在途援军 > stagingCap × 1.15` → 放弃。堆太高会一城养不起、整片断粮（实测未加此限时寿春堆到兵额 3.5 倍、6 城断粮）。

**抽兵**：从其他城挑 `garrison − troopCap × 0.35 > 120` 的盈余城，按盈余排序取前 3，距离 `≤ 460`，各抽 **60%** 送 `mission: 'reinforce'`。抽调后不足 100 兵就原地退回，不发空军。

这套逻辑不管粮草，只靠 `_recruit` 的护栏和 `Economy` 的断粮惩罚收尾 —— 已知副作用是孤军深入后饿死。

---

## 5. 出兵 `_attack`

### 5.1 月度预算

```js
maxArmies = max(1, ceil(cities.length / 2))       // 同时在外的军队数上限
chances   = (outgoing === 0 ? 0.10 + aggression × 0.30
                            : 0.04 + aggression × 0.15)
          + (momentum − 1) × 0.25
```

已在外的军队达到 `maxArmies` 就直接返回；否则掷一次骰，失败整月不出兵。

### 5.2 兵源

所有城按 `attackScore(garrison, 守将, 地形)` 降序排队，逐城尝试：

- 驻军 < 180 → 跳过
- 按 **80%** 抽调预览，不足 120 → 跳过
- `overstacked = garrison > troopCap × 1.25`（超编的城允许打「赢面不够」的仗泄压）

### 5.3 目标筛选（逐条都是硬闸门）

以 `235` 距离内的非己方邻城为候选：

| 闸门 | 判定 |
|---|---|
| 外交 | `Diplo.canAttack(G, fid, owner)` —— 只有宣战状态才能打，见 §6 |
| 玩家密约 | 目标是玩家直辖城且 `Diplo.hasPact` 有效 → 跳过 |
| 新手保护·势力 | `target.owner === player.factionId && turn < 36` → 跳过 |
| 新手保护·直辖 | `target.grantedTo === PLAYER_HERO_ID && turn < 54` → 跳过 |
| 胜算 | `Combat.predict()`（无随机推演，UI 悬停同一套）；不赢且未超编 → 跳过 |
| 余兵 | `pred.remain < plan × (overstacked ? 0.15 : 0.45)` → 跳过；即非超编时必须「能赢且剩 45% 以上」 |

通过全部闸门后取**距离最近**者（不是胜算最大者）。这是已知的粗糙点：路上有更好的目标也不会换。

### 5.4 成军与战报

- 实际抽调 `takeFromGarrison(garrison, 0.80)`
- 主将优先 `city.governor`，否则该城任意本势力武将，都没有则 `heroId: null`
- 目标是玩家城池 / 玩家直辖城时写一条 `bad` 级纪事（`约 N 月可至`），其他目标静默出兵

---

## 6. 外交 AI（`Diplo.ai`）

与军事 AI 分开，独立节奏：

- **每 3 回合轮到一次**：`Diplo._phase(fid) === G.meta.turn % 3`（对 fid 做字符串哈希取模，稳定分片，避免所有势力同月翻牌）
- 死势力 / 无城势力跳过
- 四步按序执行，任一步「continue」则本月外交到此为止：

| 步 | 触发 | 动作 |
|---|---|---|
| 1 求和 | 交战 ≥2 国，或实力 < 最强敌 × 0.85，且对方会答应（`Diplo.willAcceptPeace`） | 纳钱 `min(treasury, 400)`，停战 12 月 |
| 2 结盟 | `threat > 自身实力 × 1.5` 且盟友 < `MAX_ALLIES`(2)，且有 rel ≥ 25、无积怨、非盟友非交战的候选，50% 概率 | 与关系最好的候选结盟 |
| 3 宣战 | `RNG.chance(aggression × 0.5)`，目标需接壤、`rel < −40`、中立状态、自身实力 > 对方 × 1.8 | 花 500 钱宣战（只打最弱的） |
| 4 援军 | 盟友正在打仗，50% 概率 | `Diplo.sendAid`：从最强城抽 30% 走 `mission: 'aid'`，抵达并入守军，不触发战斗 |

同月内步 1/2/3 任一成功即 `continue`，因此一个势力每月最多做一件大事。步 4 不 continue，可以叠加。

`Diplo.canAttack` 是**唯一开战闸门**，AI 出兵、玩家行军落地、上命征讨都只认它。想让 AI 别打某家，改外交状态，不要改 `ai.js`。

---

## 7. 大势（滚雪球）

```js
momentum = 1 + max(0, 势力城数 / 全图城数 − 0.15) × 1.1     // State.momentum
```

三个作用点，都是「大势力更强」：

1. **兵额上限**：`State.troopCapBreakdown` 的 `momentumMul` 全线乘进去，双方同规则
2. **集结频率**：`+ (momentum − 1) × 0.35`
3. **出兵意愿**：`+ (momentum − 1) × 0.25`

没有这一项时所有势力兵额对称，世界永久僵持。城数占比 ≤ 15% 时不加成，小势力不至于被饿死。

---

## 8. 旁路：AI 的科研与太守

不在 `ai.js` 里，但属于 AI 行为，改平衡时一起考虑：

| 系统 | 位置 | AI 规则 |
|---|---|---|
| 科研 | `TechSys._autoPick` | 按 `aggression > 0.45` 选分支偏好：好战 `军→工→农→商`，否则 `农→商→工→军`；无队列，完成即自动接下一个 |
| 太守 | `Viceroy.run` | 只作用于**玩家直辖城**且设了方针的城；按方针 `buildOrder` 造（留 150 钱周转）、招到 `cap × recruitRatio`、每月回复士气 + 1 + 校场×0.6 |

`AI` 自身不管粮草生产、税收政策、士族安抚 —— 这些靠 `Economy` / `Clans` 的通用规则自然发生。

---

## 9. 参数速查

| 参数 | 值 | 位置 |
|---|---|---|
| 城库上缴比例 | 12% | `ai.js` `_tax` |
| 府库上限 | 城数 × 1100 | `ai.js` `_tax` |
| 营造优先级分界 | `aggression` 0.55 / 0.35 | `ai.js` `_buildOrder` |
| 征兵目标比例 | 0.45 + aggr × 0.30 | `ai.js` `_recruit` |
| 征兵单次丁口上限 | `pop × 1.6` | `ai.js` `_recruit` |
| 府库回补征兵 | 城库 < 60 时补 ≤ 120 | `ai.js` `_recruit` |
| 集结基础概率 | 0.16 + aggr × 0.20 | `ai.js` `_mass` |
| 集结前线门槛 | 抽调后 ≥ 150 兵 | `ai.js` `_mass` |
| 集结单城上限 | 兵额 × 1.15（含在途） | `ai.js` `_mass` |
| 集结抽兵比例 | 60%，盈余门槛 120，幅员 460 | `ai.js` `_mass` |
| 在外军队上限 | `ceil(城数/2)` | `ai.js` `_attack` |
| 出兵基础概率 | 0 支出外 0.10 + aggr×0.30；有军在外 0.04 + aggr×0.15 | `ai.js` `_attack` |
| 出兵抽调比例 | 80% | `ai.js` `_attack` |
| 出征门槛 | 驻军 ≥ 180，抽调后 ≥ 120 | `ai.js` `_attack` |
| 超编判定 | 驻军 > 兵额 × 1.25 | `ai.js` `_attack` |
| 余兵门槛 | 超编 15%，否则 45% | `ai.js` `_attack` |
| 新手保护 | 势力城 36 回合、直辖城 54 回合 | `ai.js` `_attack` |
| 外交节奏 | 每 3 回合 | `diplo.js` `_phase` |
| 求和/结盟/宣战/援军概率 | 见 §6 | `diplo.js` `ai` |
| 大势系数 | 1 + max(0, 占比−0.15) × 1.1 | `state.js` `momentum` |

---

## 10. 已知天花板（刻意留的，不是待办）

1. **不打长期账**：只看当月 `predict()` 胜率，不评估粮草、援军、后续扩张
2. **不撤退**：`_mass` 送出的援军和 `_attack` 的攻军都不会因形势变化回头（只有打输/守不住时 `Army.arrive` 自动班师）
3. **目标取最近而非最优**：挡路的高价值城不会被绕过
4. **无协同**：同一势力的多路军队互不知情，可能撞车或送人头
5. **不主动求和玩家 / 不和玩家结盟**：AI 外交只在 AI 势力之间跑；玩家侧走 `Diplo.respond` 上表流程
6. **无 AI 单测**：`tools/verify.js` 只做宏观长跑（200 回合不崩溃、兼并上限、出现过停战/结盟），不验证「打得聪不聪明」

---

## 11. 维护这份文档

改 AI 前后各做一次：

1. 改 `js/systems/ai.js` 任何数值 → 同步 §9 表格
2. 改加法/闸门/顺序 → 同步 §3–§5 正文
3. 改外交阈值或节奏 → 同步 §6
4. 动 `momentum` 公式 → 同步 §7（它会同时影响兵额，是全图平衡的总开关）
5. 跑 `node tools/verify.js`，再 `node tools/sim.js --bot 2000` 看宏观指标有没有崩（见 `docs/TESTING.md`）
