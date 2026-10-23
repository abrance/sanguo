# 内容扩展指南

数值与文案基本都在 `js/data/` 里，改内容通常不需要碰逻辑。
每一条都给出**最小改动**和**容易踩的坑**。

改完请跑 `node tools/verify.js`。

---

## 加一个建筑

1. `js/data/buildings.js` 的 `BUILDINGS` 里加一项：

```js
workshop: {
  id: 'workshop', name: '工坊', cat: '工', max: 5,
  cost: { gold: 120, mat: 80, iron: 20 }, turns: 2,
  desc: '造作器物，兼修军械。',
  effect: lv => `建材 +${lv * 5}，攻城 +${lv * 2}%`,
  // req: (c, G) => ({ ok: ..., why: '不可建的原因' }),   // 可选前置
},
```

2. 若它要影响产出/战力，两处接线：

- 产出：`js/systems/economy.js` 的 `produce()` 里读 `State.bld(c, 'workshop')`
- 战力：`js/systems/combat.js` 的 `power()` 里加系数（用 `opts` 传，不要在这里读 city）

3. 若它要参与 AI / 太守的营造顺序，加进 `js/data/policies.js` 对应方针的 `buildOrder`，
   以及 `js/systems/ai.js` 的 `_buildOrder()`。

**坑**

- `BUILDINGS` 的 key 必须同时存在于 `City.buildings` 初始对象里（`js/state/state.js` 的 `create()`），
  否则 `State.bld()` 返回 0，建筑永远升不上去。旧存档由 `State.migrate()` 补。
- `max` 不要超过 6，UI 单行宽度按两位数排版。
- `cost` 是 **1 级基准价**，实际价 = `cost × 目标等级^1.12 × 科技建造系数`。
- 新建筑若要解锁兵种，记得改 `State.troopCapByType()`，否则兵种兵额仍是 0。

---

## 加一个科技

`js/data/techs.js` 的 `TECHS` 里加一项，`req` 写同分支上一层：

```js
agr11: { id: 'agr11', name: '代田新法', branch: '农', tier: 11, cost: 900, req: ['agr10'],
         desc: '……', eff: { food: 0.10 } },
```

`eff` 支持这些键（都是**加算比例**，最终乘数 = 1 + Σ）：

| 键 | 作用点 |
|---|---|
| `food` `gold` `mat` `iron` | 产出（`economy.js`） |
| `pop` | 户籍上限（`State.popMaxOf`） |
| `granary` | 仓廪上限（`State.foodCapOf`） |
| `troopCap` | 兵额（`State.troopCapBreakdown`） |
| `atk` `def` `cav` `arc` `inf` `siege` | 战力（`Combat.power`） |
| `speed` | 行军速度（暂未接线，留作扩展） |
| `buildCost` | 建造费（`Build.costOf`，用负值表示折扣） |
| `morale` | 士气（暂未接线） |

**坑**

- `TECH_TIERS` 常量要和实际最大 tier 一致，否则 UI 的分支进度 `n/10` 会错。
- `tools/verify.js` 会校验「前置链连成 10 层」，加了 11 层需要同步放宽那条断言。
- 满树乘数会叠加，加项前先看 `verify.js` 里「满树乘数在合理区间」的上下限（粮/钱 1.5–4）。

---

## 加一个兵种

1. `js/data/troops.js` 加进 `TROOPS`，并把 key 加进 `TROOP_KEYS`
2. 若要克制关系，改 `COUNTER`
3. `State.troopCapByType()` 给新兵种分配兵额比例
4. `State._initGarrison()` 初始化时给个初始值（否则开局是 `undefined`）
5. `js/data/policies.js` 不用改（`Recruit.autoFill` 的 `order` 里加 key）
6. `js/systems/combat.js` 的 `byType` 特技映射表按需加

**坑**：UI 里兵种缩写（`TROOPS[k].short`）是单字，超过一个字会挤破按钮。

---

## 加一个武将 / 城池 / 势力

### 武将
`js/data/scenarios/taodong190/heroes.js` 的 `TAODONG190_HERO_ROWS` 加一行（紧凑数组）：

```js
['newhero', '姓名', 武, 统, 智, 政, 魅, '特技key', '势力id'],
```

特技 key 必须在 `TAODONG190_HERO_SKILLS` 里，否则 `skillOf(G, hero)` 返回空对象（不报错，但没效果）。

### 城池
`js/data/scenarios/taodong190/cities.js` 的 `TAODONG190_CITY_ROWS`：

```js
['newcity', '城名', x, y, 'plain', '州名', pop, farm, market, wall],
```

坐标范围 `0-2400 × 0-1800`（世界尺寸在 `js/view/map.js` 的 `GameMap.W/H`）。
相邻关系**不是显式配置的**，由 `State.neighbors(cityId, 235)` 按像素距离算 ——
所以城的坐标决定了它和谁接壤。加城后务必检查新城的邻居是否合理。

### 大势（时间窗内的既定攻打对象）
`js/data/scenarios/taodong190/ambitions.js`：

```js
// 势力id: [[目标势力id, 起回合, 止回合, 缘由, 必战?], ...]
yuanshao: [
  ['hanfu', 3, 20, '冀州殷富，绍欲取之为基业'],
  ['gongsunzan', 22, 46, '界桥之后，河北只容一家'],
],
// 宿敌对：关系每月自然 −2~−4
const TAODONG190_RIVALS = [['yuanshao', 'gongsunzan'], ...];
```

回合是绝对回合数（开局 = 1，一回合 = 一月）。`必战` 跳过"强弱"门槛，也不受 AI 相位错开限制。
没写进表的势力走随机宣战逻辑。加了新势力记得给它排一条野心，否则它多半一辈子不动兵。

### 势力
`js/data/scenarios/taodong190/factions.js` 的 `TAODONG190_FACTION_ROWS`：

```js
['newfid', '势力名', '#rrggbb', 'rulerHeroId', 侵略性0-1, ['cityId', ...]],
```

**坑**：每座城的 `owner` 由这张表最后写入，所以同一座城不能出现在两个势力里；
没被任何势力认领的城会归 `free`（在野，无法行动）。

---

## 加一个剧本

剧本 = 一套城池 + 武将 + 势力 + 初始年月。多剧本是平行的，各自独立存档。

1. 新建 `js/data/cities-<剧本>.js` / `heroes-<剧本>.js` / `factions-<剧本>.js`，
   导出 `TAODONG190_CITY_ROWS` / `TAODONG190_HERO_ROWS` / `TAODONG190_FACTION_ROWS`（**注意变量名不能和现有剧本重名**，
   因为全局作用域共享；建议直接导出到 `SCENARIOS` 里，见下）
2. 在 `js/data/scenarios.js` 的 `SCENARIOS` 注册：

```js
SCENARIOS.guandu200 = {
  id: 'guandu200', name: '官渡', subtitle: '建安五年（200）',
  year: 200, month: 1,
  cityRows: CITY_ROWS_200, heroRows: HERO_ROWS_200, factionRows: FACTION_ROWS_200,
  playable: FACTION_ROWS_200.map(r => r[0]),
  desc: '……',
};
```

3. 加进 `index.html` 的 script 列表（在 `scenarios.js` 之前）
4. 起始界面会自动列出该剧本的所有势力与城池 —— 但**当前开局界面写死了 `DEFAULT_SCENARIO`**，
   要真正支持"选剧本"，需要改 `js/view/ui.js` 的 `buildStart()` 与 `doStart()`
   （存档 key 已按 `scenarioId` 分槽，`Save.key()` 无需改）

**坑**：`State.create()` 里的初始建筑等级是写死的（`lumber:1, barnacks:1, office:1, granary:1`），
不同年代若要"更发达/更荒废"的开局，就在剧本行里加字段并在 `create()` 里读。

---

## 加一个上命类型

1. `js/data/missions.js` 的 `MISSION_TYPES` 加一项，实现：

```js
raid: {
  id: 'raid', weight: 20, title: '袭扰敌后',
  make(G) { return { type:'raid', targetCityId: ..., expireTurn: G.meta.turn + 8,
                     rewardMerit: 30, rewardFavor: 12 }; },
  desc(m, G) { return `……`; },
},
```

2. 加进 `MISSION_LIST`
3. 若是"需要玩家主动完成"的类型，在 `js/systems/mission.js` 的 `fulfil()` 里处理，
   或在事件发生处挂钩（参考 `Mission.onCapture`）
4. UI 自动按 `MISSION_TYPES[key]` 渲染；征讨类（需要打城）在 `renderRankHall` 里特判了
   `typeKey === 'expedition'`，新类型若也要隐藏"上缴"按钮，需要一并判断

---

## 改平衡的常见入口

| 想改 | 改这里 |
|---|---|
| 钱粮产出 | `js/systems/economy.js` 的 `produce()` |
| 兵额 | `js/state/state.js` 的 `troopCapBreakdown()` |
| 兵种强弱 / 克制 | `js/data/troops.js` |
| 攻城难度 | `js/systems/combat.js` 的 `power()` 里城墙系数、`resolve()` 的伤亡系数 |
| AI 好战程度 | `js/data/scenarios/taodong190/factions.js` 的侵略性 + `js/systems/ai.js` 的概率与阈值（全部列在 [AI.md](AI.md) §9） |
| 晋升速度 | `js/data/ranks.js` 的 `meritNeeded` 与 `ROUTES[*].meritNeededMul` |
| 科技快慢 | `js/systems/tech-system.js` 的 `cityRate()` + `js/data/techs.js` 的 `cost` |

改完用 `node tools/sim.js --bot --months 200` 看世界演化，用
`node tools/sim.js --months 120` 看"不作为的玩家会不会输"。
