// 建筑体系：16 种，每城独立，等级 1-6
// cost 为 1 级基准价，实际费用 = base × 目标等级^1.35
// req  为建造前置（函数形式，接收城与等级）
const BUILDINGS = {
  farm: {
    id: 'farm', name: '农田', cat: '农', max: 6,
    cost: { gold: 90, mat: 38, iron: 0 }, turns: 2,
    desc: '开垦荒地为田，直接提升粮产。',
    effect: lv => `粮产 ${Math.round(78 * lv)}/月（基准人口）`,
  },
  market: {
    id: 'market', name: '市集', cat: '商', max: 6,
    cost: { gold: 80, mat: 45, iron: 0 }, turns: 2,
    desc: '设市贸易，抽取商税。',
    effect: lv => `钱入 ${Math.round(30 * lv)}/月（基准人口）`,
  },
  wall: {
    id: 'wall', name: '城墙', cat: '军', max: 6,
    cost: { gold: 120, mat: 80, iron: 12 }, turns: 3,
    desc: '夯土包砖，守城之本。攻城战时大幅提高守方战力。',
    effect: lv => `守城战力 +${Math.round(lv * 10)}%`,
  },
  lumber: {
    id: 'lumber', name: '伐木场', cat: '工', max: 5,
    cost: { gold: 70, mat: 18, iron: 0 }, turns: 2,
    desc: '伐木烧炭，产出建材。',
    effect: lv => `建材 +${lv * 8}/月`,
  },
  quarry: {
    id: 'quarry', name: '采石场', cat: '工', max: 5,
    cost: { gold: 95, mat: 35, iron: 6 }, turns: 2,
    desc: '采石备料，建材产出更高，但占人口。',
    effect: lv => `建材 +${lv * 14}/月，人口上限 -${lv * 2}%`,
  },
  ironworks: {
    id: 'ironworks', name: '冶铁坊', cat: '工', max: 5,
    cost: { gold: 120, mat: 70, iron: 0 }, turns: 3,
    desc: '鼓风冶铁，产出铁料，也是兵器来源。',
    effect: lv => `铁 +${lv * 6}/月`,
  },
  stable: {
    id: 'stable', name: '马场', cat: '军', max: 4,
    cost: { gold: 130, mat: 65, iron: 6 }, turns: 3,
    desc: '牧马之地。无马场不可募骑兵，马场等级决定骑兵兵额。',
    effect: lv => `解锁/扩充骑兵，骑兵兵额 +${lv * 12}%`,
    req: (c) => ({ ok: c.terrain !== 'marsh' && c.terrain !== 'mountain', why: '水泽山地不宜牧马' }),
  },
  barracks: {
    id: 'barracks', name: '兵营', cat: '军', max: 6,
    cost: { gold: 100, mat: 60, iron: 8 }, turns: 2,
    desc: '驻兵之所。提升兵额上限。',
    effect: lv => `兵额上限 +${lv * 8}%`,
  },
  drill: {
    id: 'drill', name: '校场', cat: '军', max: 5,
    cost: { gold: 110, mat: 45, iron: 10 }, turns: 2,
    desc: '操练士卒。全军战力提升。',
    effect: lv => `全军战力 +${lv * 3}%，士气 +${lv * 4}`,
  },
  office: {
    id: 'office', name: '府衙', cat: '政', max: 5,
    cost: { gold: 115, mat: 60, iron: 0 }, turns: 3,
    desc: '治所。提升治安与人口上限，也是太守开府之处。',
    effect: lv => `治安上限 +${lv * 5}，人口上限 +${lv * 6}%`,
  },
  academy: {
    id: 'academy', name: '学宫', cat: '政', max: 5,
    cost: { gold: 110, mat: 40, iron: 5 }, turns: 2,
    desc: '延请儒士，产出科研点。',
    effect: lv => `科研 +${lv * 2}/月`,
  },
  granary: {
    id: 'granary', name: '粮仓', cat: '农', max: 5,
    cost: { gold: 80, mat: 45, iron: 0 }, turns: 2,
    desc: '囤粮备荒，提高仓廪上限，减轻饥荒。',
    effect: lv => `仓廪上限 +${lv * 250}，饥荒损失 -${lv * 4}%`,
  },
  clinic: {
    id: 'clinic', name: '医馆', cat: '政', max: 4,
    cost: { gold: 100, mat: 40, iron: 5 }, turns: 2,
    desc: '救治伤兵，战后回收部分伤亡；加速人口恢复。',
    effect: lv => `战后伤兵回收 ${lv * 5}%，人口增速 +${lv * 8}%`,
  },
  beacon: {
    id: 'beacon', name: '烽燧', cat: '军', max: 4,
    cost: { gold: 70, mat: 50, iron: 0 }, turns: 1,
    desc: '烽火传警。敌兵来犯提前两月示警，治安提升。',
    effect: lv => `预警提前 ${lv} 月，治安 +${lv * 2}`,
  },
  shipyard: {
    id: 'shipyard', name: '船坞', cat: '军', max: 4,
    cost: { gold: 140, mat: 85, iron: 15 }, turns: 3,
    desc: '临水之城方可建。无船坞不可募水军。',
    effect: lv => `解锁/扩充水军，水军兵额 +${lv * 15}%`,
    req: (c, G) => ({ ok: State.isRiverCity(G, c), why: '此城不临水' }),
  },
  customs: {
    id: 'customs', name: '关市', cat: '商', max: 4,
    cost: { gold: 110, mat: 45, iron: 0 }, turns: 2,
    desc: '设关征税。需市集 2 级以上。',
    effect: lv => `税收 +${lv * 10}%`,
    req: (c) => ({ ok: State.bld(c, 'market') >= 2, why: '需市集 2 级' }),
  },
};

const BUILDING_KEYS = Object.keys(BUILDINGS);

// 建造费用（升到 curLevel+1）
function buildCost(key, curLevel, costMul) {
  const d = BUILDINGS[key];
  const lv = curLevel + 1;
  const f = Math.pow(lv, 1.12);
  const m = costMul == null ? 1 : costMul;
  return {
    gold: Math.round(d.cost.gold * f * m),
    mat: Math.round(d.cost.mat * f * m),
    iron: Math.round(d.cost.iron * f * m),
  };
}

// 建造工期
function buildTurns(key, curLevel, buildFactor) {
  const d = BUILDINGS[key];
  const base = d.turns + (curLevel) * 0.6;
  const bf = buildFactor == null ? 1 : buildFactor;
  return Math.max(1, Math.round(base / bf));
}

// 建筑产出的通用系数读取
function bldValue(c, key) {
  return (c.buildings && c.buildings[key]) || 0;
}

// 建造成本上限检查用的资源名
const BUILD_RES = ['gold', 'mat', 'iron'];
