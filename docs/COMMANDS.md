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

### `CANCEL_BUILD` `{ cityId, index }`
撤项，退还半数物料（钱/建材/铁）。

### `SET_POLICY` `{ cityId, policy }`
委任太守方针。`policy` ∈ `POLICY_KEYS` 或 `null`（罢委任 = 亲理）。
设了方针后每月 `Viceroy.run` 会自动营造 + 征兵，玩家手动操作仍可叠加。

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

## 新增命令的步骤

1. 在 `js/state/store.js` 的 `COMMANDS` 里加一个 `NAME(G, payload) {}`
2. 所有校验用 `throw new Error('中文原因')`
3. 改完草稿后，涉及玩家势力的动作要写 `State.log`
4. 在 `tools/verify.js` 的「命令校验」段加一条非法用例（必须抛错）+ 一条合法用例
5. 在 `js/view/ui.js` 里绑定按钮，`try/catch` 弹 `e.message`
6. 更新本文档
