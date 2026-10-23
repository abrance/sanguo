# AI 行为逻辑

> 实现：`js/systems/ai.js`（编排 + 局势评估）+ `js/systems/ai-econ.js`（税/募兵/营造）+ `js/systems/ai-war.js`（防守/进攻/集结）+ `js/systems/diplo.js` 的 `Diplo.ai`（外交）+ `js/systems/tech-system.js` 的 `_autoPick`（科研）
>
> 本文是 AI 行为的**唯一事实来源**。改 `ai.js` / `ai-econ.js` / `ai-war.js` 里的任何阈值、比例，同一次提交里同步本表。
>
> 当前核对版本：`feat/ai-refactor`（三文件拆分，`ai.js` 261 行 / `ai-econ.js` 95 行 / `ai-war.js` 191 行）

---

## 0. 定位与分层

规则型 AI：**没有搜索、没有学习、没有对手模型**。但不再是「一堆散装 if 互相拆台」：

```
AI.run                      每个势力每月一次
 └ AI._settleOffense        结算上一轮进攻成败 → 目标记忆（打不下的冷落 6 月）
 └ AI.assess                把局势压成一份 plan（只在这里读 State）
    ├ 在途敌军 → threatened
    ├ 前线判定 / 留守下限 / 可抽兵力（spareOf）
    ├ 兵力账目（在册兵 / 出城兵 / 本回合已投入）
    └ 目标清单（带 predict 胜算，按「能不能赢」排序）
 ├ AI._equipTreasures      把本势力城里的宝物发给最强的将（同槽只在更稀有才换）
 └ AIEcon.run(G, f, plan)   税 → 募兵（受威胁城优先）→ 营造（战时先堆墙）
 └ AIWar.run(G, f, plan)    防守 > 进攻 > 集结，三选一
 └ AI._trace(G, plan)       G.meta.aiTrace 打开时留痕，供排查
```

三条硬规矩（以前就是缺这个才长成一团）：

1. **只有 `assess` 读 `State`**。内科/军事层只消费 `plan`，想加判断先加进 `plan`。
2. **同月不互相抽兵**：`plan.budget` 与 `plan.spareOf()` 是唯一账本，进攻和集结共用。
3. **每城每月最多一路、每目标每月最多一路**（以前同一座城会被抽两次、同一目标会被两路合攻）。

调平衡优先改 `AI.TUNE` 和三张表（`AIEcon.ratioFor` / `AIEcon.buildOrder` / `AIWar.run` 的分支），不要在流程里塞零散判断。

---

## 1. 在回合流水线里的位置

`Turn.advance`（`js/systems/turn.js`）第 11 步调 `AI.run(G, stamp)`，紧跟在外交之后：

```
… 9    Rank.monthly（声望与晋升）
9.2  Relations.drift（人情账：忠诚漂移 / 叛变）
10   Diplo.advance 已在 8.5 执行（关系漂移 + AI 议和/宣战/结盟/援军）
11   AI.run（评估 → 税/募兵/营造 → 防守/进攻/集结）
12   玩家失城流亡 / 13 势力存亡 / 14 胜负
```

顺序有意义：**外交先翻牌，AI 再按新的外交状态决定打谁**；同月刚宣战的势力，同月就可能出兵。

---

## 2. 玩家势力的非直辖城也由 AI 运作

如果只有 AI 势力会长大，玩家所在的势力必然被拖死，所以玩家势力跑**同一套**流程，只是先剔除直辖城：

```
cities = factionCities(player.factionId) − player.demesne   （exclude 同时传给 assess）
```

- 直辖城：完全不进 AI 的手
- 非直辖城：税 / 募兵 / 营造 / 集结 / 出征全跑（可能替你丢城）
- 直辖城仍计入势力总兵力、科技产出、大势占比
- `Diplo.sendAid` 同样不许从玩家直辖城抽兵（与这里同一条不变量）

---

## 3. 局势评估 `AI.assess`（决策的唯一数据源）

| 字段 | 含义 |
|---|---|
| `threatened` | 有敌军在途、`eta ≤ threatEta`(2) 的城：`{cityId, eta, troops, by}` |
| `isFront(c)` | 邻接活着的敌国（`free` 不算威胁） |
| `reserveOf(c)` | 留守下限：受威胁 → 现有兵力 ×0.90；前线 → ×0.40；后方 → ×0.30；硬底 = 兵额 ×0.15 |
| `spareOf(c)` | `max(0, 驻军 − reserveOf)` —— 全项目**唯一**的可抽兵口径 |
| `totalTroops` | 本势力在册兵力（城内 + 在途） |
| `budget` | `totalTroops × commitRatio(0.75) − 本回合已投入进攻的兵力` |
| `targets[]` | 邻接敌城 × 可抽兵力：`{from, to, troops, size, edge, pred, dist}`，按「能赢 + 剩余比例」排序 |
| `maxRoutes` | 战时 `min(8, max(2, ceil(城数/2)))`；平时 1 |

目标筛选的闸门顺序（每条都在 `assess` 里，加新闸门写这里）：

```
邻接 235px → 不是自己 → 已宣战（Diplo.canAttack）→ 新手保护（势力 36 回合 / 直辖 54 回合）
→ 玩家密约 → 已有一路在途（pendingTargets）→ 失败冷落期（_avoid）→ 成军 ≥ minArmy(150)
```

留守口径的由来（踩过的坑）：早期按「兵额 × 0.35/0.55」留兵，城市只填到六成时会把可抽兵压到两成，
AI 于是永远打不动，扩张速度只有旧版的三分之一。现在按**现有兵力**留比例 + 兵额硬底。

---

## 4. 内政 `AIEcon`

### 4.1 征税

每月抽城库 12% 进府库，府库上限 = 城数 × 1100。

### 4.2 募兵（比例随局势走）

```js
ratioFor(plan, c):
  受威胁城      0.85
  战时          0.70 + aggression × 0.10
  平时          0.45 + aggression × 0.15
```

受威胁城排在最前（同一笔府库先到先得）；单次丁口上限 `pop × 1.6`；城库 < 60 时府库回补 ≤ 120。

### 4.3 营造（顺序按局势换档）

| 局面 | 顺序 |
|---|---|
| 有城受威胁 | `wall → barracks → drill → farm → market → office → stable → ironworks` |
| 侵略性 > 0.55 | `barracks → farm → drill → stable → wall → ironworks → academy → office` |
| 侵略性 > 0.35 | `farm → market → barracks → wall → office → academy → drill → granary` |
| 其余 | `farm → market → academy → office → granary → wall → barracks → customs` |

府库只补贴钱，建材/铁料靠本地。每城每月最多开一项（空着工程位才开）。

---

## 5. 军事 `AIWar`

### 5.1 三选一（不再「又集结又出兵」）

```
severe = threatened 里「eta ≤ 1 或来犯兵力 ≥ 守军 × 1.1」的城
① severe 非空 → defend（回防），本月不出击
② 否则 attack；出兵成功即结束
③ 打不动 → 对 threatened 输兵（defend），再向后集结（mass）
```

旧版一见敌军在途就整月不动，多线战时等于永久停摆 —— 现在只有「真要被打穿」才放弃出击。

### 5.2 防守 `defend`

从**无威胁、有盈余**的城向受威胁城输兵（`mission: 'reinforce'`），按距离由近到远，
送到「来犯兵力 ×1.2 − 现守军」为止，不足 `minSpare`(120) 就不送。

### 5.3 进攻 `attack`

- 目标按 `pred.win` 与 `pred.remain / size` 排序（旧版先按 `edge` 排再拿 `pred` 过滤，
  结果一堆打不下来的目标排在队首，一个月一路都出不去）
- 每城每月一路（`used`）、每目标每月一路（`hit`）
- 单路抽兵 = `min(spare, budget, 驻军 − 硬底)`，成军不足 `minArmy`(150) 就退回
- 主将优先本城守将 → 本城统率最高者 → 空将
- 战败/无果后退：部队消失而目标仍在敌手 → `_settleOffense` 记 `_avoid[城] = 回合 + 6`，
  6 个月内不再打它；同目标若已在路上（`pendingTargets`）也不重复派兵
- `force`（军区「征讨」号令）：不算预算、不掷骰、不看胜算，但保留兵额 15% 的硬底
- **战法**：AI 之间的战斗由 `Combat.resolve(..., { aiTactic: true })` 在第一轮放一个战法
  （按 `Combat._aiTactic` 的收益优先级挑第一个可用的；玩家指挥的仗不走这条路，由界面决定）

### 5.4 集结 `mass`

把后方盈余兵送到「排序第一的目标」所在的前线城市（`mission: 'reinforce'`），为下月出兵做准备。

- 触发：`RNG.chance(0.16 + aggression × 0.20 + (momentum−1) × 0.35)`
- 目标城在途 + 驻军 ≤ 兵额 × 1.15
- 出发城须有盈余 > `minSpare`，幅员 460px，最多 3 座

---

## 6. 外交 AI（`Diplo.ai`）

与军事 AI 分开，独立节奏：

- **每 3 回合轮到一次**：`Diplo._phase(fid) === G.meta.turn % 3`（对 fid 做字符串哈希取模，稳定分片）
- 死势力 / 无城势力跳过
- 四步按序执行，任一步 `continue` 则本月外交到此为止：

| 步 | 触发 | 动作 |
|---|---|---|
| 1 求和 | 交战 ≥2 国，或实力 < 最强敌 × 0.85，且对方会答应 | 纳钱 `min(treasury, 400)`，停战 12 月 |
| 2 结盟 | `threat > 自身实力 × 1.5` 且盟友 < 2，且有 rel ≥ 25、无积怨的候选，50% | 与关系最好的候选结盟 |
| 3 宣战 | `RNG.chance(aggression × 0.5)`，目标接壤、`rel < −40`、中立、自身实力 > 对方 × 1.8 | 花 500 钱宣战（只打最弱的） |
| 4 援军 | 盟友正在打仗，50% | `Diplo.sendAid`：从最强城抽 30%（**排除玩家直辖城**），抵达并入守军 |

`Diplo.canAttack` 是**唯一开战闸门**，AI 出兵、玩家行军落地、上命征讨都只认它。
想让 AI 别打某家，改外交状态，不要改 `ai-*.js`。

---

## 7. 大势（滚雪球）

```js
momentum = 1 + max(0, 势力城数 / 全图城数 − 0.15) × 1.1     // State.momentum
```

两个作用点：

1. **兵额上限**：`State.troopCapBreakdown` 的 `momentumMul`（双方同规则）
2. **集结频率**：`+ (momentum − 1) × 0.35`

出兵不再用概率门（改为每月必评估「能不能赢」），所以旧版那条 `+ (momentum−1)×0.25` 的出兵意愿已删。

---

## 8. 旁路：AI 的科研与太守

| 系统 | 位置 | 规则 |
|---|---|---|
| 科研 | `TechSys._autoPick` | 按 `aggression > 0.45` 选分支偏好：好战 `军→工→农→商`，否则 `农→商→工→军`；完成即接下一个 |
| 太守 | `Viceroy.run` | 只作用于**玩家直辖城**且设了方针的城（军区城跳过） |
| 军区 | `Legion.run` | 同一套营建/征兵；「征讨」号令传 `force`：不掷骰、不按半军区限军数、不看胜算 |

`AI` 不管粮草生产、税收政策、士族安抚 —— 靠 `Economy` / `Clans` 的通用规则自然发生。

---

## 9. 参数速查

| 参数 | 值 | 位置 |
|---|---|---|
| **出兵预算** | 在册兵力 × 0.75 − 本回合已投入 | `AI.TUNE.commitRatio` |
| 留守（前线/后方） | 现有兵力 × 0.40 / × 0.30 | `TUNE.reserveFront / reservePeace` |
| 留守硬底 | 兵额 × 0.15 | `TUNE.reserveForce` |
| 受威胁留守 | 现有兵力 × 0.90 | `TUNE.reserveThreat` |
| 转守判定 | `eta ≤ 2` 视为受威胁；`eta ≤ 1` 或来犯 ≥ 守军 × 1.1 视为紧急 | `TUNE.threatEta` + `AIWar.run` |
| 战线数 | 战时 `min(8, max(2, ceil(城数/2)))`，平时 1 | `TUNE.maxRoutes*` |
| 成军下限 / 可抽门槛 | 150 / 120 | `TUNE.minArmy / minSpare` |
| 目标冷落 | 6 个月 | `TUNE.avoidMonths` |
| 邻接半径 | 235px | `TUNE.frontRange` |
| 征地比例 | 0.85 / 0.70+aggr×0.10 / 0.45+aggr×0.15 | `AIEcon.ratioFor` |
| 单次征兵丁口上限 | `pop × 1.6` | `AIEcon.recruit` |
| 城库上缴 / 府库上限 | 12% / 城数 × 1100 | `AIEcon.tax` |
| 府库回补 | 城库 < 60 时补 ≤ 120 | `AIEcon.recruit` |
| 集结概率 | 0.16 + aggr×0.20 + (momentum−1)×0.35 | `AIWar.mass` |
| 集结单城上限 | 兵额 × 1.15（含在途） | `AIWar.mass` |
| 新手保护 | 势力城 36 回合、直辖城 54 回合 | `AI.assess` |
| 外交节奏 | 每 3 回合 | `diplo.js` `_phase` |
| 大势系数 | 1 + max(0, 占比−0.15) × 1.1 | `state.js` `momentum` |

---

## 10. 已知天花板（刻意留的，不是待办）

1. **不打长期账**：只看当月 `predict()`，不评估粮草、援军、后续扩张
2. **不撤退**：出动的军队不会因形势变化回头（打输/守不住时 `Army.arrive` 自动班师）
3. **无协同进攻**：多路军队互不知情，不会「三路会攻一城」
4. **不设防预判**：只对「已在途」的敌军回防，不做「他下个月可能来」的准备
5. **AI 外交不主动找玩家**（求和/结盟仍走玩家侧 `Diplo.respond` 流程）
6. **没有搜索**：不会为了三个月后的形势放弃眼前这一仗

---

## 11. 维护这份文档

改 AI 前后各做一次：

1. 跑 `node tools/verify.js`（含「AI 决策」板块：留守下限、受威胁转守、目标冷落、出兵预算、决策留痕）
2. 跑 `node tools/sim.js --bot --months 200` 与 `node tools/sim.js --months 200`，对照基线：
   - 主动玩家 200 回合 29–48 城（seed 11/22/33 = 48/29/41），世界保持 7–9 家多极
   - 被动玩家 55–75 回合被吞
   - 旧版是 51/56/51 城、世界只剩 4–6 家；现在的 AI 不靠「抽空城池换地」堆城数
3. 打开 `G.meta.aiTrace = true` 跑 20 回合，看 `posture` 分布与 `best` 是否合理（排查「为什么它不动」最快的手段）
4. 同步本表的数字
