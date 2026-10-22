# 架构说明

零依赖、零构建的单页策略游戏。这份文档描述**代码怎么组织、状态怎么流转、哪些地方不能乱改**。
设计意图与数值公式见 [../DESIGN.md](../DESIGN.md)。

---

## 1. 分层

```
index.html          入口：按固定顺序用 <script> 加载全部源码，没有打包器
│
├─ js/core/         纯工具，不依赖任何游戏概念
│    rng.js         种子随机（mulberry32），同种子同结果
│    util.js        clamp / dist / 日季节表 SEASON / 地形表 TERRAIN
│    bus.js         事件总线：系统层 emit，视图层 on
│
├─ js/data/         纯数据 + 纯函数，不含状态。改数值只动这里
│    troops.js      兵种、克制表、耗粮
│    ranks.js       官阶 7 级、三路线、自立门槛
│    buildings.js   建筑 16 种、造价与工期公式
│    techs.js       科技 40 项（4 分支 × 10 层）、乘数聚合
│    policies.js    太守方针 5 种、士族姓氏池
│    missions.js    上命模板（上贡 / 输兵 / 征讨）
│    cities-190.js  70 郡坐标与初始等级
│    heroes-190.js  134 名武将、特技表
│    factions-190.js  21 势力与初始领城
│    scenarios.js   剧本注册表（多剧本平行）
│
├─ js/state/        状态的唯一来源
│    state.js       状态树形状、构造、只读查询、胜负判定、旧档迁移
│    store.js       命令层：dispatch(type, payload) → reducer(draft) → 替换 G
│    save.js        localStorage 存档（每剧本一个槽位）
│
├─ js/systems/      规则实现。只接收 G（草稿），不碰 DOM
│    economy.js     每月产出/消耗/饥荒/治安/人口
│    recruit.js     征兵校验与扣费（玩家 / 太守 / AI 共用）
│    build.js       工程队列
│    tech-system.js 科研点累积、排队、乘数刷新
│    clans.js       士族情绪漂移与叛乱
│    viceroy.js     太守按方针自动营造 + 征兵
│    rally.js       持续调兵（补给线）
│    favor.js       上级好感、赏赐、削权、权臣权柄
│    mission.js     上命派发与结算
│    combat.js      多轮攻城结算、战力公式、胜率预估
│    army.js        行军、抵达、攻占
│    rank.js        战功分封、晋升
│    ai.js          各势力决策（含玩家势力的非直辖城）
│    turn.js        回合流水线，**唯一**的编排点
│
├─ js/view/         DOM / Canvas，只读状态
│    map.js         地形网格程序生成 + 底图预渲染
│    renderer.js    Canvas 绘制、摄像机、命中检测
│    ui.js          侧栏、官阶台、全部交互与命令下发
│
└─ js/main.js       启动：渲染循环（requestAnimationFrame）
```

**依赖方向是单向的**：

```
core ← data ← state ← systems ← (view, main)
```

`view/**` 和 `main.js` 可以读 `state`/`systems`，反向绝对不允许。
`systems/**` 里出现 `document` 就是 bug。

---

## 2. 脚本加载顺序

`index.html` 里 `<script>` 的顺序就是执行顺序。没有模块系统，所有顶层 `const`/`function` 共享一个全局作用域，所以：

- **不能有重名的顶层标识符**
- 顶层代码只允许"定义"，不允许"执行"（唯一的例外是 `main.js` 注册 `DOMContentLoaded`）
- 顺序按上面的分层排列，`store.js` 必须在所有 `systems` 之后（它引用 `COMMANDS` → 各系统）

`tools/harness.js` 会**直接解析 index.html 的 script 标签**来装载，所以新增文件只要加进 index.html，测试就自动覆盖，不会漏。

---

## 3. 状态树

`State.create()` 产出的 `G` 是唯一真相。存档就是这个对象的 JSON。

```
G.meta      { scenarioId, scenarioName, seed, turn, year, month, startedAt }
G.player    { heroId, name, factionId, rank, merit, reputation, loyalty, route,
              favor, mission, missionCooldown, domActionTurn, demesne[], homeCityId }
G.factions  { [fid]: { id, name, color, rulerId, aggression, kind, treasury,
                       tech:{ rp, done{}, current, queue[] }, bonus, dead?, momentum? } }
G.cities    { [cid]: City }
G.heroes    { [hid]: { id, name, wu, tong, zhi, zheng, mei, skill,
                       factionId, cityId, loyalty, alive } }
G.armies    { [aid]: { id, factionId, heroId, troops{}, from, to, x, y,
                       eta, totalEta, morale, mission } }
G.log       [ { turn, year, month, kind, text } ]   // kind: turn|battle|good|bad|note
G.stats     { won, lost, citiesTaken, citiesLost, battles }
G.over      null | { result:'win'|'lose', text }
```

### City

```
id name x y terrain region
pop basePop                 当前丁口 / 户籍基数
buildings{farm market wall lumber quarry ironworks stable barracks drill
          office academy granary clinic beacon shipyard customs}
farm market wall wallMax     buildings 的镜像（见 §6）
owner grantedTo governor     grantedTo === 'PLAYER' 就是玩家的直辖城
food gold mat iron          城库
order morale
garrison{inf cav arc nvy siege}
buildQueue[ {key,to,left,total} ]
policy                      太守方针，null = 亲理
rallyTo rallyRatio rallyFill  持续调兵（rallyKeep 为历史遗留，已不使用）
clanActionTurn              士族操作冷却
clans[ {name,sat,inf,mood} ]
unrest                      新附未安剩余月数
```

**`owner` 与 `grantedTo` 是两件事**：

- `owner` = 城池属于哪个势力（领土）
- `grantedTo === 'PLAYER'` = 这座城由玩家直辖（可建设、可征兵）

直辖城一定是本方势力城，但本方势力城不一定是直辖城。**所有"玩家能否操作"的判断都看 `grantedTo`，不看 `owner`。**

---

## 4. 数据流

### 命令（唯一的状态写入口）

```js
Store.dispatch('RECRUIT', { cityId, troop, amount })
  → 深拷贝草稿 const draft = U.clone(G)
  → COMMANDS.RECRUIT(draft, payload)     // 只改草稿；非法就 throw
  → G = draft                            // 整体替换
  → Bus.emit('state', G)                 // 视图重绘
```

好处：状态替换是原子的、命令可日志化回放、将来接后端只换运输层。
**不要在任何地方直接改 `Store.get()` 的返回值。**

### 回合流水线（`Turn.advance`）

```
 1  Army.advance      行军推进 / 抵达结算（战斗或合兵）
 2  Build.advance     工程队列推进
 3  Economy.produce   产出、消耗、饥荒、治安、人口、城防
 4  Clans.drift       士族情绪漂移 / 叛乱判定
 5  TechSys.advance   科研点累积 → 推进当前项 → 接队列
 6  Viceroy.run       太守按方针自动营造 + 征兵
 7  Rally.run         持续调兵
 8  Favor.monthly     好感漂移 / 赏赐 / 削权
 9  Mission.tick      上命派发与逾期
10  Rank.monthly      声望自然增长 + 晋升检查
11  AI.run            各势力决策（玩家势力的非直辖城也走这里）
12  _playerFate       直辖城全失 → 流失投奔
13  _cleanupFactions  势力覆灭清理
14  State.checkEnd    胜负判定
```

顺序有意义，改之前先想清楚：
`Viceroy` 在 `Rally` 之前 → 太守当月募的兵当月经能送出；
`Army` 在 `Economy` 之前 → 当月攻下的城当月就开始产出；
`Clans` 在 `Economy` 之后 → 士族影响的是**下个月**的产出系数。

### 视图

`main.js` 每帧调用 `Renderer.draw(G, dt)`；`Bus.on('state')` 触发 `UI.render(G)`。
渲染只读，不写状态。地图交互（拖拽/缩放/点选）在 `ui.js` 里，`renderer.js` 只负责画和命中检测。

坐标系：世界 `2400 × 1800`，摄像机 `{x, y, zoom}` 记录**屏幕中心**对应的世界坐标。
`toScreen` / `toWorld` 是唯一的换算入口。

---

## 5. 必须守住的不变量

改代码时若破坏以下任一条，`node tools/verify.js` 会报错。

1. **兵额只有一个来源** —— `State.troopCapBreakdown()` 算出各项系数，`State.troopCapOf()` 只返回它的 `.total`。
   任何地方都不许另写一份兵额公式（历史上就因此让 UI 和校验对不上）。

2. **建筑等级以 `c.buildings` 为准** —— `c.farm / c.market / c.wallMax` 是镜像字段，由 `State.syncDerived(c)` 同步。
   改建筑等级后必须调 `syncDerived`。**不要直接写 `c.farm = 5`。**

3. **玩家势力乘数缓存在 `faction.bonus`** —— 由 `TechSys.refresh(G)` 生成，战斗和经济直接读它。
   研成科技、自立建国、读档迁移后都要 refresh。

4. **城池归属看 `grantedTo`，领土看 `owner`** —— 见 §3。

5. **同一（源城 → 目标城）同时只有一支补给线在途** —— 见 `Rally.run`。
   否则每回合都会刷出新军队。

6. **`predict()` 与 `resolve()` 用同一套战力公式** —— `Combat.power`。
   `predict` 只是把随机项去掉，别让它和真实结算分叉。

7. **随机只走 `RNG`** —— 不用 `Math.random()`，否则同种子不可复现，平衡测试失效。

---

## 6. UI 与逻辑的分工

- 数值展示要**复用逻辑层的函数**：城池面板的兵额拆解直接调 `State.troopCapBreakdown`，
  补给线的"本次送出多少"直接调 `Rally.detail`。不要在视图里重算一遍公式。
- 按钮的禁用原因来自逻辑层的校验函数（`Recruit.check` / `Build.canBuild`），
  这样"为什么不能点"和"点了为什么报错"永远一致。
- 日志由系统层通过 `State.log(G, kind, text)` 写入；只有涉及玩家势力的战斗写完整战报，
  第三方势力之间压缩成一行摘要（避免刷屏）。

---

## 7. 存档与迁移

`Save.save(G)` 直接 `JSON.stringify({v, at, G})`，key 为 `sanguo.save.<scenarioId>`。
因为 G 是纯数据（无函数、无循环引用），序列化天然安全。

`State.migrate(G)` 负责旧档兼容：缺字段补默认值、旧字段转换（如 `popMax` → `basePop`）、
重建 `buildings`、`clans`、`tech.queue`。**新增字段时务必在这里补一行**，否则老存档会算出 NaN。

---

## 8. 已知的取舍

| 取舍 | 代价 |
|---|---|
| 无打包器，全局作用域 | 文件多了容易撞名；靠命名约定 + verify 兜底 |
| 命令用 `JSON` 深拷贝整棵 G | 单次 dispatch 是 O(状态大小)（70 城规模下 ≈1ms，可接受）；换成服务端后要改增量 |
| 战斗是单次多轮结算，不是战棋 | 战场上没有走位与地形微操 |
| 城镇坐标手工近似 | 只保证相邻关系合理，不是真实地理投影 |
| AI 是规则型，没有搜索 | 中后期容易被玩家用人海 + 城墙磨死，但不会犯低级错误 |
