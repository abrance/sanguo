# 命令参考

所有状态变更都必须经过 `Store.dispatch(type, payload)`。

```js
Store.dispatch('BUILD', { cityId: 'chenliu', key: 'farm' })
```

**契约**

- reducer 接收 `G` 的深拷贝草稿，只改草稿，返回任意结果对象（会原样返回给调用方）
- 校验失败**必须 `throw new Error('中文原因')`** —— 视图层直接把这个 message 弹给玩家
- 调用方（`ui.js`）统一 `try { ... } catch (e) { UI.toast(e.message) }`
- 成功时由 reducer 自己写日志（`State.log`），不要在视图层拼日志

**通用前置**：几乎每个命令都会先检查 `if (G.over) throw new Error('战局已终')`。
所有涉及城池的命令都要求 `city.grantedTo === 'PLAYER'`（玩家的直辖城），
**不是** `owner === player.factionId`。

---

## 回合

### `END_TURN`
无参数。推进一个月，跑完整条流水线（见 [ARCHITECTURE.md §4](ARCHITECTURE.md)）。
`G.over` 非空时抛错。

---

## 军事

### `RECRUIT` `{ cityId, troop, amount }`
在直辖城募兵。

- `troop` ∈ `inf | cav | arc | nvy | siege`
- 校验：兵种兵额（`State.troopCapByType`）、总兵额、钱、丁口
- 门槛：`cav` 需马场 ≥1；`nvy` 需船坞 ≥1
- 扣费：`gold`、`pop`（丁口）
- 返回：`{ amount, cost }`

### `FILL_TROOPS` `{ cityId, ratio }`
按兵额比例一键补兵，内部走 `Recruit.autoFill`。

- `ratio` 默认 1，clamp 到 0.2–1；目标 = `兵额 × ratio × 0.98`
- 缺口 <10 时抛「已接近兵额」
- 钱/丁口不足时抛错
- 返回：`{ added }`

### `BATCH_FILL` `{ cityIds }`
多城批量补兵。逐城按兵额 98% 补，逐城 `autoFill`（带粮草护栏），最后只写一条汇总日志。

- 全部城都满员/资源不足时抛错
- 返回：`{ total, cities }`

### `DISPATCH` `{ fromId, toId, ratio }`
单城出兵。

- `from` 必须是直辖城；`fromId !== toId`
- 在外军队上限 `直辖城数 + 1`
- 抽兵 `< 20` 抛错
- 目标为同势力城 = 增援，否则 = 出征（抵达时结算战斗）
- 返回：`{ armyId, eta }`

### `BATCH_DISPATCH` `{ cityIds, toId, ratio }`
多城向同一目标调兵（合兵 / 合攻）。

- 在外军队上限放宽为 `直辖城数 + 3`，超出的城跳过并在日志注明
- 单城抽兵 <20 时该城跳过（不抛错，只要有一城发出就算成功）
- 全部城都发不出时抛错
- 选将调用 `pickHeroForCity`，跳过已在外的武将
- 返回：`{ sent, count, skipped }`

---

## 内政

### `BUILD` `{ cityId, key }`
开工一个建筑。

- `key` ∈ `BUILDING_KEYS`（16 种）
- 校验：工程位（`State.buildSlots`，府衙 3 级起 2 个）、等级上限、前置（`BUILDINGS[key].req`）、钱/建材/铁
- 立即扣资源，工程进 `c.buildQueue`
- 返回：`{ key, turns }`

### `BUILD` `{ cityId, key }`
在直辖城起一项工程。

- 工程位满 → 抛「工程已满（府衙 3 级可并行）」
- **同一建筑已在队列中 → 抛「已在工程队列中」**（否则完成后 `to` 相同，白扣一份料）
- 钱/建材/铁不足、前置未达、已到上限 → 抛对应原因

### `CANCEL_BUILD` `{ cityId, index }`
撤项，退还半数物料（钱/建材/铁）。

### `SET_POLICY` `{ cityId, policy }`
委任太守方针。`policy` ∈ `POLICY_KEYS` 或 `null`（罢委任 = 亲理）。
设了方针后每月 `Viceroy.run` 会自动营造 + 征兵，玩家手动操作仍可叠加。
营造会**把工程位填满**（府衙 3 级 = 2 项）；空着的工程位不许因预留金空转，只有已在施工时才留 150 钱周转；同一建筑不会重复入队。

### `LEGION_CREATE` `{ heroId }`
委任一名本方在世武将为都督，开一处军区（上限 4 处）。若该将所在城是直辖城，自动作为首城。

- 返回：`{ id, heroId, cityIds }`

### `LEGION_ASSIGN` `{ id, cityIds }`
设置军区辖城。城必须是你直辖，且不能同时属于两个军区（会抛错）。

### `LEGION_ORDER` `{ id, stance?, targetFid?, policy? }`
玩家号令。三个字段都可单独更新。

- `stance` ∈ `defend`（守土，不出兵）/ `expand`（拓边，只打已交战与在野）/ `strike`（征讨）
- `strike` 必须给 `targetFid`，**下号令即宣战**（这是玩家授权的战争）
- `policy` 决定军区城的营建顺序与征兵比例，缺省 `balanced`

### `LEGION_DELETE` `{ id }`
裁撤军区，诸城收归亲理。

### `SET_DEMESNE` `{ cityId, releaseId? }`
收归直辖：把**本方势力但非你直辖**的城纳入直辖。

- 直辖未满：直接收归
- 直辖已满：必须给 `releaseId`（交出一座现有直辖城），被交出的城 `grantedTo=null`、方针与补给线清空，改由属下代管
- 首府若被交出，自动迁到新收归的城
- 直辖上限见 `cityCap(player)` = 官阶 `maxCities` + 路线修正（忠臣 −1 / 自立 +2）+ 好感修正，下限 2
- 返回：`{ cityId, released, demesne, cap }`

### `SET_POLICY_ALL` `{ policy }`
一键方针：所有直辖城设同一方针（`null` = 全部收归亲理）。

- 视图入口：城池页顶部「一键理政条」
- 设完之后每月自动，无需再逐城点
- 全部城已是此制时抛「诸城已是此制」
- 返回：`{ changed, total }`

### `BATCH_BUILD` `{ key }`
一键同造：所有能造的直辖城各起同一项建筑（逐城留 150 钱周转，卡住的城跳过不整体失败）。

- 视图入口：城池页「一键理政条 · 同造」那一行
- 全都没法开工时抛错，消息里带被卡城数
- 返回：`{ done, skip, key }`

### `BATCH_PACIFY` `{}`
一键安抚：只对**士族满意度 < 45** 且不在 3 回合冷却内的直辖城设宴（`Clans.pacify`）。

- 逐城扣除 200 钱 / 120 粮，钱粮不足的城计入 `held` 跳过，不整体失败
- 全都没得动时抛错（视图直接弹原因）
- 返回：`{ done, held }`

### `SET_RALLY` `{ cityId, toId, ratio, fill }`
持续调兵（补给线）。

- `toId = null` → 取消
- `toId === cityId` → 抛错
- `ratio` clamp 0.1–1（每月送走本城兵力的比例）
- `fill` clamp 0.8–2.5（补至目标兵额的倍数）
- 目标可以是敌方城（持续进攻）
- 实际送兵量 = `min(驻军 × ratio, 驻军 − 保护下限, 目标剩余容量)`，见 `Rally.detail()`

---

## 士族

### `CLAN_ACTION` `{ cityId, action }`
`action` ∈ `pacify`（安抚，200 钱 + 120 粮）| `recruit`（征辟，500 钱换在野武将）| `suppress`（打压，免费，可能立刻引发叛乱）。

- 每城每 3 回合限一次（`c.clanActionTurn`）
- 城无士族时抛错

---

## 定向登用（人物页 · 在野名士）

三档都从「你的主城」扣钱粮，目标是 `factionId === 'free'` 的武将；成功率见 `Relations.recruitChance`：

```
p = 档位基础(0.12 / 0.28 / 0.55)
  + 私交×0.5%  + 名望/800  + 魅力/400
  + (100−野心)×0.2%  − 智×0.15%
clamp 3%–92%
```

| 命令 | 花费 | 基础率 | 目标冷却 |
|---|---|---|---|
| `VISIT_HERO` 拜访 | 60 钱 | 12% | 2 月 |
| `GIFT_HERO` 送礼 | 260 钱 + 120 粮 | 28% | 4 月 |
| `BESEECH_HERO` 三顾 | 900 钱 | 55% | 6 月，且同一时间只许一人 |

- 成功：入麾下（`cityId` = 你的主城），`忠诚 = 45 + 私交/2`，私交至少 20
- 失败：钱粮不退，私交 +3（连续三次失败后不再涨）；三顾失败另扣名望 3
- 士族面板「征辟」走同一套成功率（基础率 55%），失败仍加士族好感

## 人情账（城池面板 · 人物页）

四个命令共用一条校验链：将存在且健在 → 属你势力 → 在你直辖城 → 冷却 → 资源。
冷却记在 `hero.cd[命令]` 上，**各命令互不阻塞**。

### `REWARD_HERO` `{ heroId }`
赏赐。花费 `80 × (1 + 官阶)` 钱（从此将所在城扣），`忠诚 +6 / 私交 +10 / 积怨 -1`，同将 3 回合冷却。

### `PROMOTE_HERO` `{ heroId, cityId }`
提拔为守将。战功 -5，`私交 +14 / 忠诚 +4`，原守将 `忠诚 -6`；同城 6 回合冷却（`city.promoteTurn`）。
已在任、战功不足、冷却中均抛错。

### `PUNISH_HERO` `{ heroId }`
责罚（**只能罚守将**）。`忠诚 -10 / 积怨 +1`，本城治安 +3，同城其他将 `私交 -3`；同将 5 回合冷却。

### `CONSOLE_HERO` `{ heroId }`
抚慰。需有积怨，粮 -60，`积怨 -1 / 私交 +5`；同将 3 回合冷却。

> 派生影响：守将忠诚 → 守城战力 `0.90 + 忠诚/500`；主将忠诚 → 建军士气；守将私交 → 直辖城产出 `+私交/1000`。
> 忠诚 < 30 且野心 > 60 → 次月预警，3 月内未安抚则按 6%（忠诚<20 时 10%）掷骰叛变：带城投敌或落草，**武将不会消失**。

---

## 科技

### `RESEARCH` `{ key }`
研习或排入队列。

- `key` ∈ `TECH_KEYS`（40 项）
- 前置必须已研成；不能重复研或在队
- 当前无项目 → 立即开工；已有 → 入队（上限 `TechSys.MAX_QUEUE` = 3）
- 返回：`{ queued, position? }`

### `UNSCHEDULE_TECH` `{ key }`
把某项移出研习队列（不影响正在研的那项）。

---

## 仕途

### `SET_ROUTE` `{ route }`
切换忠臣 / 权臣。

- `independent` 不能走这里（必须 `DECLARE_INDEPENDENCE`）
- 已自立 → 不可回头
- 转权臣需官阶 ≥2（太守）
- 好感：转忠臣 +6，转权臣 −8

### `DECLARE_INDEPENDENCE`
无参数。举兵自立。

- 前置：官阶 ≥ 刺史（`INDEPENDENCE.minRank`）、直辖城 ≥ 2、声望 ≥ 150
- 效果：新建势力「<玩家名>军」，直辖城全部转入，城内武将改属，科技树继承，
  原势力立刻敌对，路线锁定 `independent`，好感归零，上命清空
- 不可撤销

### `FULFILL_MISSION`
无参数。如约完成上贡 / 输兵类上命。

- 征讨类不能这样交差（要去打城，攻占时由 `Mission.onCapture` 自动复命）
- 资源按各直辖城占比分摊扣除
- 无上命时抛错

### `DECLINE_MISSION`
无参数。抗命：好感 −25，战功 −12，进入 3 回合冷却。

### `LEVY_TROOPS` `{ fromCityId, toCityId }`
权臣专属：从同势力**非直辖城**抽 40% 兵力到自己直辖城。

- 需路线 `dominant` 且官阶 ≥3（刺史）
- 两城须同势力；`from` 不能是直辖城；`to` 必须是直辖城
- 与 `SKIM_TAX` 共用 2 回合冷却（`player.domActionTurn`）
- 代价：好感 −4，源城士气 −6

### `SKIM_TAX` `{ cityId }`
权臣专属：截留同势力非直辖城 45% 的钱入私库。冷却与代价同上。

---

## 外交

分层由 `Diplo.layer(G)` 决定：县长–刺史 `personal`、州牧–将军 `petition`、三公 / 自立 `direct`。
所有外交命令都受「同一目标国 3 回合冷却」与「花直辖城的钱」两条约束。

### `SEND_ENVOY` `{ fid }`
遣使修好：300 钱，两国关系 +6，好感 −2。

### `SECRET_PACT` `{ fid }`
私通密约：800 钱，12 月内该势力不攻你直辖城；30% 被告发（好感 −15、关系 −10）。
存于 `player.pacts = [{ fid, until }]`，`Diplo.hasPact` 是 AI 出兵的唯二闸门之一。

### `ASK_AID` `{ fid, cityId? }`
求援：1000 钱 + 关系 ≥20，对方从最强城抽 40% 兵走 `mission: 'aid'` 赴你首城（抵达并入守军）。好感 −5。

### `BUY_GRAIN` `{ fid, cityId? }`
借粮：600 钱 + 关系 ≥10，入粮 `300 + 60 × 对方城数`（不超过目标城粮仓上限）。好感 −3。

### `BRIBE_SUPERIOR`
行贿上级：500 钱 → 好感 +12；15% 被检举（好感 −6、声望 −5）。自立后不可用。

### `DEFECT` `{ fid }`
带直辖城投靠（不可撤销）：直辖城 `owner` 改、城内武将转籍、官阶重置 1 级、战功清零、`route` 回 `loyal`、
清空密约与冷却，原势力与新主即刻开战。交战中的势力无从投靠。

### `PETITION` `{ fid, action }`
action ∈ `war | peace | ally | intrigue`。州牧起的「上表言事」：花提议的钱与好感，
再由 `Diplo.respond()` 按好感 / 实力对比 / 共同敌人 / 君主侵略性算采纳率（0.05–0.95）。
被拒好感再 −4。`direct` 层用同一命令时直接办成。

### `PEACE_ACCEPT` `{ fid }`
接受对方求和：纳钱 `min(对方国库, 400)` 入私库，停战 12 月。

### `PEACE_COUNTER` `{ fid, demands }`
向请和者提条件。`demands = { gold, mat, iron, troop }`，各项 0–1 的百分比。

- 负担分 `0.55·钱 + 0.15·建材 + 0.10·铁料 + 0.45·输兵`，超过对方容忍度即谈崩
- 成交：交割资源（钱出对方国库、建材/铁料按各城比例抽、兵从对方最强城抽走并向我首府行军），并停战
- 谈崩：报价作废，战事照旧（**无法求和**）
- 返回：`{ accepted, got? }`

### `PEACE_REFUSE` `{ fid }`
拒绝求和。无任何代价，战事继续。

### `DECLARE_WAR` / `SUE_FOR_PEACE` / `FORM_ALLIANCE` / `BREAK_ALLIANCE` / `CALL_TO_ARMS` `{ fid }`
三公或自立之主的「代君行令」。前置：`Diplo.layer(G) === 'direct'`、目标国存在且未覆灭、冷却已过、钱够。
- 花费：宣战 500 / 求和 300 / 结盟 1000 / 解盟 0 / 请盟出兵 500
- 代价：好感 −5，`player.usurp +1`；满 5 次触发猜忌（好感 −25，计数清零）
- 结盟硬条件：关系 ≥40、无 `grudge`、双方盟友都 <2
- `CALL_TO_ARMS` 要求 `status === 'ally'`，盟友抽 40% 兵以 `mission: 'aid'` 赴你最危急的直辖城

### 无命令的自动行为

- `DISPATCH` / `BATCH_DISPATCH` 打非交战势力 → `guardAttack()` 直接判为背刺：自动 `declareWar({backstab:true})`，好感 −20、声望 −15
- 停战 / 结盟期内的在途攻军抵达时自动班师（`Army.arrive`），不触发 `Combat.resolve`

---

## 新增命令的步骤

1. 在 `js/state/store.js` 的 `COMMANDS` 里加一个 `NAME(G, payload) {}`
2. 所有校验用 `throw new Error('中文原因')`
3. 改完草稿后，涉及玩家势力的动作要写 `State.log`
4. 在 `tools/verify.js` 的「命令校验」段加一条非法用例（必须抛错）+ 一条合法用例
5. 在 `js/view/ui.js` 里绑定按钮，`try/catch` 弹 `e.message`
6. 更新本文档
