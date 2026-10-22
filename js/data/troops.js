// 兵种体系：步 / 骑 / 弓 / 水 / 器
// atk/def 为单兵基础战力；food 每月每兵耗粮；cost 征兵每兵钱；popCost 每兵耗人口
const TROOPS = {
  inf: {
    id: 'inf', name: '步兵', short: '步',
    atk: 10, def: 11, food: 0.15, cost: 0.25, popCost: 0.12,
    speed: 1.00, color: '#8a8378',
    desc: '廉价坚韧，守城主力。克弓兵。',
  },
  cav: {
    id: 'cav', name: '骑兵', short: '骑',
    atk: 17, def: 7, food: 0.28, cost: 0.55, popCost: 0.15,
    speed: 1.55, color: '#a8642f',
    desc: '机动突击，平原极强。克步兵，怕弓兵。',
  },
  arc: {
    id: 'arc', name: '弓兵', short: '弓',
    atk: 13, def: 7, food: 0.15, cost: 0.35, popCost: 0.12,
    speed: 1.00, color: '#6f8a5c',
    desc: '远程压制，林地山地加成。克骑兵，怕步兵。',
  },
  nvy: {
    id: 'nvy', name: '水军', short: '水',
    atk: 11, def: 10, food: 0.20, cost: 0.45, popCost: 0.125,
    speed: 1.20, color: '#3f7590',
    desc: '仅江河城池可造。沿水路移动快，陆战平庸。',
  },
  siege: {
    id: 'siege', name: '器械', short: '器',
    atk: 6, def: 4, food: 0.22, cost: 0.70, popCost: 0.155,
    speed: 0.55, color: '#8a7a5c',
    desc: '攻城时对城墙伤害 ×5，野战几乎无用。',
  },
};

const TROOP_KEYS = ['inf', 'cav', 'arc', 'nvy', 'siege'];

// 克制关系：优 → 劣（×1.30），逆向 ×0.80
const COUNTER = {
  cav: 'inf',
  inf: 'arc',
  arc: 'cav',
};

function counterMul(mine, theirs) {
  if (COUNTER[mine] === theirs) return 1.30;
  if (COUNTER[theirs] === mine) return 0.80;
  return 1.00;
}

// 空兵表
function emptyTroops() {
  return { inf: 0, cav: 0, arc: 0, nvy: 0, siege: 0 };
}

// 兵力合计（器械不计入「人头」士气，但计入战力）
function troopTotal(t) {
  return (t.inf || 0) + (t.cav || 0) + (t.arc || 0) + (t.nvy || 0) + (t.siege || 0);
}

// 每月耗粮
function troopFood(t) {
  let f = 0;
  for (const k of TROOP_KEYS) f += (t[k] || 0) * TROOPS[k].food;
  return f;
}

// 行军基础速度（像素/月）
const ARMY_SPEED_BASE = 150;
