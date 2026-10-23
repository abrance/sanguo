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
│    treasures.js   宝物 20 件（5 类）+ 开局宝物落城表
│    policies.js    太守方针 5 种、士族姓氏池
│    missions.js    上命模板（上贡 / 输兵 / 征讨）
│    scenarios.js   剧本注册表 + 跨剧本共用的在野伪势力定义
│    scenarios/<剧本id>/     剧本专属数据，顶层符号必须带剧本 id 前缀
│      taodong190/cities.js    70 郡坐标与初始等级
│      taodong190/heroes.js    134 名武将、特技表
│      taodong190/factions.js  21 势力与初始领城
│    diplo.js       外交状态文案、行动与提案定义
│
├─ js/state/        状态的唯一来源
│    state.js       状态树形状、构造、只读查询、胜负判定、旧档迁移
│    store.js       命令层：dispatch(type, payload) → reducer(draft) → 替换 G
│    save.js        localStorage 多槽位存档 + 导出/导入
│
├─ js/systems/      规则实现。只接收 G（草稿），不碰 DOM
│    economy.js     每月产出/消耗/饥荒/治安/人口
│    recruit.js     征兵校验与扣费（玩家 / 太守 / AI 共用）
│    build.js       工程队列
│    tech-system.js 科研点累积、排队、乘数刷新
│    clans.js       士族情绪漂移与叛乱
│    relations.js   人情账：武将忠诚漂移 / 闲置 / 叛变（含带城投敌）
│    viceroy.js     太守按方针自动营造 + 征兵
│    rally.js       持续调兵（补给线）
│    diplo.js       关系漂移 / 状态机 / canAttack 闸门 / AI 议和宣战结盟
│    favor.js       上级好感、赏赐、削权、权臣权柄
│    mission.js     上命派发与结算
│    combat.js      攻城逐轮推进（begin/step/conclude）+ 12 个战法 + 战力公式 + 胜率预估
│    army.js        行军、抵达、攻占
│    rank.js        战功分封、晋升
│    ai.js          各势力决策（含玩家势力的非直辖城）
│    turn.js        回合流水线，**唯一**的编排点
│
├─ js/view/         DOM / Canvas，只读状态
│    map.js         地形网格程序生成 + 底图预渲染
│    renderer.js    Canvas 绘制、摄像机、命中检测
│    ui.js          核心：视图状态、地图交互、主渲染 UI.render、按钮绑定
│    panels/        侧栏各面板，按域拆分（见下）
│      start.js     起始界面 + 天赋选择
│      rank.js      官阶台
│      peace.js     求和裁决弹窗
│      diplo.js     外交面板与行动
│      city.js      城池面板（概览 / 营造 / 士族 / 人物 / 施政）
│      army.js      军务面板
│      tech.js      科技面板
│      log.js       纪事面板
│      legion.js    军区面板（一将统辖多城）
│      end.js       结局弹窗（天下一统 / 势力覆亡）
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
- 顶层代码只允许"定义"，不允许"执行"（两个例外：`main.js` 注册 `DOMContentLoaded`；
  `ui.js` 末尾的 `Object.assign(UI, UI_CITY, …)` 把面板装配进同一个 `UI` 命名空间，
  这样面板能拆文件而调用点仍是 `UI.xxx`，不用改 142 处引用）
- 顺序按上面的分层排列，`store.js` 必须在所有 `systems` 之后（它引用 `COMMANDS` → 各系统）

`tools/harness.js` 会**直接解析 index.html 的 script 标签**来装载，所以新增文件只要加进 index.html，测试就自动覆盖，不会漏。
`node tools/verify.js` 的静态检查还会反向核对：磁盘上的 `js/**` 有没有漏进 index.html（孤儿文件），以及顶层标识符有没有重名。

### 新增剧本

1. 建 `js/data/scenarios/<剧本id>/{cities,heroes,factions}.js`
2. 顶层符号一律带剧本 id 前缀：`TAODONG190_CITY_ROWS`、`TAODONG190_HERO_ROWS`、`TAODONG190_FACTION_ROWS`
   —— 全局作用域没有模块隔离，不带前缀第二个剧本就撞名（静态检查会报）
3. 在 `SCENARIOS` 里登记，`cityRows / heroRows / factionRows / heroSkills` 指向上面三份
   查剧本数据一律走 `getScenario(id)`、`heroSkill(G, key)`、`skillOf(G, hero)`，别在系统/视图层直连剧本符号
4. 三个文件加进 index.html

---

## 3. 状态树

`State.create()` 产出的 `G` 是唯一真相。存档就是这个对象的 JSON。

```
G.meta      { scenarioId, scenarioName, seed, turn, year, month, startedAt }
G.player    { heroId, name, factionId, rank, merit, reputation, loyalty, route,
              favor, mission, missionCooldown, domActionTurn, demesne[], homeCityId,
              legions[] }   // 军区，见 §4.2
G.factions  { [fid]: { id, name, color, rulerId, aggression, kind, treasury,
                       tech:{ rp, done{}, current, queue[] }, bonus, dead?, momentum? } }
G.cities    { [cid]: City }
G.heroes    { [hid]: { id, name, wu, tong, zhi, zheng, mei, skill,
                       factionId, cityId, loyalty, alive } }
G.armies    { [aid]: { id, factionId, heroId, troops{}, from, to, x, y,
                       eta, totalEta, morale, mission } }
G.log       [ { turn, year, month, kind, text } ]   // kind: turn|battle|good|bad|note
G.peaceOffers [ { fid, turn } ]   // 待玩家裁决的求和报价，见 §4.1
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
rallyTo rallyRatio rallyFill  持续调兵
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
 0  Combat.finishOpen 收尾玩家的挂起战斗（必须在月份推进之前，否则白送守军一个月）
 1  Army.advance      行军推进 / 抵达结算（战斗或合兵）
 2  Build.advance     工程队列推进
 3  Economy.produce   产出、消耗、饥荒、治安、人口、城防
 4  Clans.drift       士族情绪漂移 / 叛乱判定
 5  TechSys.advance   科研点累积 → 推进当前项 → 接队列
 6  Viceroy.run       太守按方针自动营造（一次填满工程位）+ 征兵（跳过军区城）
 6.5 Legion.run       军区：营建 / 征兵 / 集结 / 出兵（受 stance 号令约束）
 7  Rally.run         持续调兵
 8  Favor.monthly     好感漂移 / 赏赐 / 削权
 9  Mission.tick      上命派发与逾期（含量外交类结果）
9.2 Relations.drift  人情账：忠诚漂移 / 闲置计数 / 叛变（预警 → 3 月干预窗口 → 掷骰）
 9.5 Diplo.advance   停战到期 / 每 6 回合重算边界 / 关系漂移 / AI 外交
10  Rank.monthly      声望自然增长 + 晋升检查
11  AI.run            各势力决策（玩家势力的非直辖城也走这里）—— 细节见 [AI.md](AI.md)
12  _playerFate       直辖城全失 → 流失投奔
13  _cleanupFactions  势力覆灭清理（无城即亡，残军清空）
14  State.checkEnd    胜负判定
```

顺序有意义，改之前先想清楚：
`Viceroy` 在 `Rally` 之前 → 太守当月募的兵当月经能送出；
`Army` 在 `Economy` 之前 → 当月攻下的城当月就开始产出；
`Clans` 在 `Economy` 之后 → 士族影响的是**下个月**的产出系数；
`Relations` 在 `Mission` 之后 → 上命结算完才判断人心，且叛变发生在当月经济算完之后。

### 4.1 求和裁决

AI 判定打不过就想停战，但**只有对方是玩家时挂报价，不自动成交**：

```
Diplo.ai → 判定 losing → 目标是最强敌国
   ├─ 目标非玩家 → 立刻 makePeace（AI 之间照旧自动谈）
   └─ 目标是玩家 → Diplo.offerPeace(G, fid) 塞进 G.peaceOffers → 局面停在"交战"
                     玩家在回合末弹窗三选一：
                       PEACE_ACCEPT  接受 → 纳钱 min(国库,400) + 停战 12 月
                       PEACE_COUNTER 提条件（钱/建材/铁料/输兵的百分比）→ 对方当场裁定
                                     负担分 ≤ 对方容忍度 → 交割资源 + 停战；否则作罢、战事照旧
                       PEACE_REFUSE  不接受 → 无任何代价，战事照旧
```

`Diplo.pruneOffers` 每回合清掉失效报价（势力已亡 / 已非交战）。

### 4.2 军区（一将统辖多城）

玩家嫌逐城点太累时，把若干直辖城交给一名武将托管：

```js
G.player.legions = [{ id, heroId, cityIds[], policy, stance, targetFid, stats:{attacks,taken} }]
```

- `Legion.run` 每月对这些城跑：营建（方针 `buildOrder`）、征兵（方针 `recruitRatio`）、士气回复；
  非「守土」号令时再复用 `AI._mass / AI._attack`，用 `filter` 把号令套上去
- 号令 `stance`：
  - `defend` 守土 —— 只营建征兵，不出兵
  - `expand` 拓边 —— 只打已交战势力与在野，**不主动开新战线**
  - `strike` 征讨 —— 只打 `targetFid`；下号令即宣战（玩家授权的战争）
- 战果：军区派出的军队带 `a.legionId`，出兵时 `stats.attacks++`，该军队克城时 `stats.taken++`
- 征讨目标一旦停战/覆灭，军区自动转「守土」并在纪事里说明，不会一直空转
- 都督加成：`State.legionMul` = 统率 → 守城战力 `1 + tong/400`，政略 → 产出 `1 + zheng/500`
- 同一城只归一个军区；`Viceroy.run` 会跳过军区城，避免两套指令打架
- 玩家当家的势力（`rulerId === PLAYER_HERO_ID`）不跑 `Diplo.ai`：宣战/结盟/求和一律玩家决断
- 臣属时君主仍会自己罢兵；若此时正有一条等玩家裁决的求和报价，会作废并写明"已因停战作废"，不静默消失

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

7. **能不能开战只问 `Diplo.canAttack(G, a, b)`** —— AI 选目标、`guardAttack()`、`Army.arrive` 都只认它。
   不要在别处另写 `status === 'war'` 判断；在野（`'free'`）之城永远可攻。

8. **外交关系是成对的** —— `G.diplo` 的 key 由 `Diplo.key(a,b)` 规范化（字典序拼接），
   任何地方都不要自己拼 `a + '|' + b`，否则 A→B 与 B→A 会变成两份数据。

7. **随机只走 `RNG`** —— 不用 `Math.random()`，否则同种子不可复现，平衡测试失效。
   同种子可复现还依赖两处游标入档：`G.meta.rngState`（RNG 序列位置）与 `G.meta.uidSeq`（`U.uid` 计数器），
   由 `Store` 在每次命令成功后写回、开局/读档时恢复。**别把新的模块级可变状态留在 `G` 之外。**

8. **玩家命令的入口校验只有两处** —— `dispatch` 统一拦终局（`G.over`，白名单见 `OVER_SAFE`），
   城池权限统一走 `mustOwnCity(G, cityId)`。新命令直接调它，不要另写 `c.grantedTo !== PLAYER_HERO_ID`。

9. **视图层不写状态** —— `js/view/**` 里不能出现 `G.xxx = …`。连「清空纪事」也走 `dispatch('CLEAR_LOG')`。
   视图只能读 `Store.get()`，改状态一律 `dispatch`。

10. **样式值只有一个来源** —— 颜色/字号/圆角只从 `style.css` 的 `:root` token 或数据层自带配色
   （地形 `TERRAIN[].color`、势力 `f.color`、科技分支 `BRANCH_COLOR`）来。
   `js/view/**` 与 `index.html` 里禁止裸色值与静态内联样式，详见 [STYLE.md](STYLE.md)。

---

## 6. UI 与逻辑的分工

### 视图层内部四层

| 层 | 住在哪 | 管什么 |
|---|---|---|
| 结构 | `view/**` 的模板字符串 / `index.html` | 标签与 class 名 |
| 语义类 | `style.css` 组件区（`.card .qbar .brow …`） | 这类组件长什么样 |
| 工具类 | `style.css` 工具层（`.fs-label .mt-6 .p-4 …`） | 纯间距/字号，替代内联样式 |
| 数据变量 | JS 写 `style="--w:42%"`，CSS 翻译成属性 | 数值与数据配色 |

分界线就一句：**JS 传值，CSS 管属性名**。所以视图里能看到 `style="--w:42%"`，
但看不到 `style="width:42%"`；能看到 `class="c" style="--c:${f.color}"`，看不到 `color:#xxx`。

例外：`renderer.js` / `map.js` / sparkline 是 canvas 绘制，吃不到 CSS 继承，用色自带在脚本里。

`node tools/verify.js` 的「分层守护」会拦住越界：systems 碰 DOM 或调 `dispatch`、
core/data 碰 `Store`/`UI`/`Bus`、view 直接改 `G`、`style.css` 规则区裸色值、
非 `--` 开头的数据内联样式。

### 数值与文案
- 数值展示要**复用逻辑层的函数**：城池面板的兵额拆解直接调 `State.troopCapBreakdown`，
  补给线的"本次送出多少"直接调 `Rally.detail`。不要在视图里重算一遍公式。
- 按钮的禁用原因来自逻辑层的校验函数（`Recruit.check` / `Build.canBuild`），
  这样"为什么不能点"和"点了为什么报错"永远一致。
- 日志由系统层通过 `State.log(G, kind, text)` 写入；只有涉及玩家势力的战斗写完整战报，
  第三方势力之间压缩成一行摘要（避免刷屏）。

---

## 7. 存档与迁移

存档是多槽位的，键名 `sanguo.save.<scenarioId>.<slot>`：

| 槽 | 谁写 |
|---|---|
| `auto` | 每次结束回合、新开局、导入别人的档 |
| `s1<时间戳>` | 手动「存档 → 新建存档」 |
| 空串 | 旧版单槽存档（仍可读，界面标「旧档」） |

**槽列表不另存索引**：`Save.list()` 直接扫 `localStorage` 的键推出来。没有索引就没有索引与存档不同步的 bug。
每行只读存档头（`Save.head`），不为了看一眼年月把整棵树迁移一遍。

`Save.encode(G)` 直接 `JSON.stringify({v, at, G})`。因为 G 是纯数据（无函数、无循环引用），序列化天然安全。
同一个文本格式喂两条路：写 localStorage，和导出成 `.json` 文件发给别人（`Save.decode` 读回来）。

`Save.VERSION` 是**状态形状版本**（改字段语义才 +1，纯加字段不用动）。
`Save.decode` 会：拒绝高于当前版本的存档（未来档不猜）、其余一律交给 `State.migrate(G, 旧版本号)`。

`State.migrate` 负责旧档兼容：旧字段转换（`popMax` → `basePop`）、重建 `buildings` / `clans` / `tech.queue`，
其余缺字段一律由四张默认值表兜底：

```js
META_DEFAULTS / PLAYER_DEFAULTS / FACTION_DEFAULTS / CITY_DEFAULTS / HERO_DEFAULTS
```

武将的人情账字段（`ambition / bond / grievance / idle / lastAct / warnTurn / cd`）走 `HERO_DEFAULTS`；
`ambition` 由 `State._ambitionOf()` 现算，旧档用 `State._idJitter(id)` 代替 RNG，保证同一份档多次迁移结果一致。

**新增状态字段时把默认值加进对应的表就行**（`State._fillDefaults` 只补 `null`/`undefined`，不会覆盖 `false`/`0`），
别再往 migrate 里手写 `if (x == null)`。

---

## 8. 已知的取舍

| 取舍 | 代价 |
|---|---|
| 无打包器，全局作用域 | 文件多了容易撞名；靠命名约定 + verify 兜底 |
| 命令用 `JSON` 深拷贝整棵 G | 单次 dispatch 是 O(状态大小)（70 城规模下 ≈1ms，可接受）；换成服务端后要改增量 |
| 战斗是单次多轮结算，不是战棋 | 战场上没有走位与地形微操 |
| 城镇坐标手工近似 | 只保证相邻关系合理，不是真实地理投影 |
| AI 是规则型，没有搜索 | 中后期容易被玩家用人海 + 城墙磨死，但不会犯低级错误；具体阈值见 [AI.md](AI.md) |
