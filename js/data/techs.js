// 科技树：4 分支 × 10 层 = 40 项。科研点来自学宫，按势力累积。
// eff 为加算比例，最终乘数 = 1 + Σeff
// req 自动取同分支上一层（tier - 1）
const TECHS = {
  // ── 农 ──
  agr1:  { id: 'agr1',  name: '代田法',   branch: '农', tier: 1,  cost: 24,  req: [],
           desc: '垄作法，省力增产。', eff: { food: 0.10 } },
  agr2:  { id: 'agr2',  name: '区种法',   branch: '农', tier: 2,  cost: 55,  req: ['agr1'],
           desc: '区田精耕，旱地亦丰。', eff: { food: 0.12 } },
  agr3:  { id: 'agr3',  name: '水利沟洫', branch: '农', tier: 3,  cost: 95,  req: ['agr2'],
           desc: '疏浚沟渠，灌排两便。', eff: { food: 0.08, pop: 0.10 } },
  agr4:  { id: 'agr4',  name: '常平仓',   branch: '农', tier: 4,  cost: 145, req: ['agr3'],
           desc: '丰籴歉粜，谷价不腾。', eff: { granary: 0.30 } },
  agr5:  { id: 'agr5',  name: '牛耕推广', branch: '农', tier: 5,  cost: 210, req: ['agr4'],
           desc: '牛力代人力，垦田倍增。', eff: { food: 0.15, pop: 0.05 } },
  agr6:  { id: 'agr6',  name: '深耕熟耰', branch: '农', tier: 6,  cost: 280, req: ['agr5'],
           desc: '多耕多耙，土膏脉发。', eff: { food: 0.08 } },
  agr7:  { id: 'agr7',  name: '陂塘灌溉', branch: '农', tier: 7,  cost: 360, req: ['agr6'],
           desc: '蓄水为陂，旱涝有备。', eff: { food: 0.08, pop: 0.06 } },
  agr8:  { id: 'agr8',  name: '区田法式', branch: '农', tier: 8,  cost: 460, req: ['agr7'],
           desc: '著为定式，遍行郡县。', eff: { food: 0.09 } },
  agr9:  { id: 'agr9',  name: '仓储转运', branch: '农', tier: 9,  cost: 580, req: ['agr8'],
           desc: '仓廪相望，转运不竭。', eff: { granary: 0.40, food: 0.06 } },
  agr10: { id: 'agr10', name: '井田复修', branch: '农', tier: 10, cost: 720, req: ['agr9'],
           desc: '正经界，均民力，农事大兴。', eff: { food: 0.12, pop: 0.10 } },

  // ── 工 ──
  ind1:  { id: 'ind1',  name: '冶铁术',   branch: '工', tier: 1,  cost: 28,  req: [],
           desc: '水排鼓风，铁料大增。', eff: { iron: 0.25, mat: 0.08 } },
  ind2:  { id: 'ind2',  name: '木牛流马', branch: '工', tier: 2,  cost: 65,  req: ['ind1'],
           desc: '转运之巧，行军更速。', eff: { speed: 0.15, mat: 0.10 } },
  ind3:  { id: 'ind3',  name: '云梯冲车', branch: '工', tier: 3,  cost: 105, req: ['ind2'],
           desc: '攻城之具，撞门破堞。', eff: { siege: 0.25 } },
  ind4:  { id: 'ind4',  name: '弩机改良', branch: '工', tier: 4,  cost: 155, req: ['ind3'],
           desc: '望山刻度，弩矢及远。', eff: { arc: 0.15 } },
  ind5:  { id: 'ind5',  name: '楼橹',     branch: '工', tier: 5,  cost: 225, req: ['ind4'],
           desc: '城上高楼，守御益固。', eff: { def: 0.15 } },
  ind6:  { id: 'ind6',  name: '水排鼓风', branch: '工', tier: 6,  cost: 280, req: ['ind5'],
           desc: '水力鼓风，炉温更炽。', eff: { iron: 0.20 } },
  ind7:  { id: 'ind7',  name: '石磨水碾', branch: '工', tier: 7,  cost: 360, req: ['ind6'],
           desc: '水转碾硙，谷物易治。', eff: { mat: 0.12, food: 0.06 } },
  ind8:  { id: 'ind8',  name: '连弩之法', branch: '工', tier: 8,  cost: 460, req: ['ind7'],
           desc: '一弩十矢俱发。', eff: { arc: 0.15, atk: 0.05 } },
  ind9:  { id: 'ind9',  name: '撞车改进', branch: '工', tier: 9,  cost: 580, req: ['ind8'],
           desc: '巨木为撞，城门立碎。', eff: { siege: 0.20 } },
  ind10: { id: 'ind10', name: '百炼钢',   branch: '工', tier: 10, cost: 720, req: ['ind9'],
           desc: '卅炼成钢，刃可斩铁。', eff: { atk: 0.10, def: 0.10 } },

  // ── 商 ──
  com1:  { id: 'com1',  name: '五铢钱',   branch: '商', tier: 1,  cost: 25,  req: [],
           desc: '统一币制，市易通行。', eff: { gold: 0.12 } },
  com2:  { id: 'com2',  name: '关市之征', branch: '商', tier: 2,  cost: 58,  req: ['com1'],
           desc: '设关收税，府库充盈。', eff: { gold: 0.15 } },
  com3:  { id: 'com3',  name: '盐铁官营', branch: '商', tier: 3,  cost: 98,  req: ['com2'],
           desc: '盐铁之利尽归官府。', eff: { gold: 0.20, iron: 0.15 } },
  com4:  { id: 'com4',  name: '均输平准', branch: '商', tier: 4,  cost: 150, req: ['com3'],
           desc: '物资均输，营造省费。', eff: { buildCost: -0.12 } },
  com5:  { id: 'com5',  name: '漕运',     branch: '商', tier: 5,  cost: 215, req: ['com4'],
           desc: '转粟千里，都邑不饥。', eff: { gold: 0.10, food: 0.10 } },
  com6:  { id: 'com6',  name: '钱法',     branch: '商', tier: 6,  cost: 280, req: ['com5'],
           desc: '严禁私铸，钱重物轻。', eff: { gold: 0.12 } },
  com7:  { id: 'com7',  name: '市租',     branch: '商', tier: 7,  cost: 360, req: ['com6'],
           desc: '列肆有籍，市租日增。', eff: { gold: 0.15 } },
  com8:  { id: 'com8',  name: '榷酤',     branch: '商', tier: 8,  cost: 460, req: ['com7'],
           desc: '酒榷专卖，岁入巨万。', eff: { gold: 0.18 } },
  com9:  { id: 'com9',  name: '平准均输', branch: '商', tier: 9,  cost: 580, req: ['com8'],
           desc: '贱买贵卖，商贾无所牟大利。', eff: { gold: 0.10, buildCost: -0.10 } },
  com10: { id: 'com10', name: '五均六筦', branch: '商', tier: 10, cost: 720, req: ['com9'],
           desc: '六筦尽归官营，府库之富甲天下。', eff: { gold: 0.20, food: 0.08 } },

  // ── 军 ──
  mil1:  { id: 'mil1',  name: '部曲制',   branch: '军', tier: 1,  cost: 30,  req: [],
           desc: '私兵部曲，兵额扩充。', eff: { troopCap: 0.10 } },
  mil2:  { id: 'mil2',  name: '屯田制',   branch: '军', tier: 2,  cost: 68,  req: ['mil1'],
           desc: '且耕且战，兵食自足。', eff: { food: 0.15, troopCap: 0.08 } },
  mil3:  { id: 'mil3',  name: '骑兵战术', branch: '军', tier: 3,  cost: 110, req: ['mil2'],
           desc: '骑射冲阵之法。', eff: { cav: 0.15 } },
  mil4:  { id: 'mil4',  name: '强弩之末', branch: '军', tier: 4,  cost: 160, req: ['mil3'],
           desc: '万弩齐发，当者披靡。', eff: { arc: 0.15, atk: 0.05 } },
  mil5:  { id: 'mil5',  name: '攻城术',   branch: '军', tier: 5,  cost: 235, req: ['mil4'],
           desc: '穴地破城，无所不克。', eff: { siege: 0.20, atk: 0.08 } },
  mil6:  { id: 'mil6',  name: '世兵制',   branch: '军', tier: 6,  cost: 280, req: ['mil5'],
           desc: '军户世代为兵，兵源不绝。', eff: { troopCap: 0.10 } },
  mil7:  { id: 'mil7',  name: '车骑并进', branch: '军', tier: 7,  cost: 360, req: ['mil6'],
           desc: '车为正，骑为奇。', eff: { cav: 0.12, def: 0.05 } },
  mil8:  { id: 'mil8',  name: '陷阵之法', branch: '军', tier: 8,  cost: 460, req: ['mil7'],
           desc: '先登陷阵者受上赏。', eff: { atk: 0.08, inf: 0.10 } },
  mil9:  { id: 'mil9',  name: '长围久攻', branch: '军', tier: 9,  cost: 580, req: ['mil8'],
           desc: '筑垒围城，绝其内外。', eff: { siege: 0.18, morale: 0.05 } },
  mil10: { id: 'mil10', name: '军械监制', branch: '军', tier: 10, cost: 720, req: ['mil9'],
           desc: '器械有程，工官督造。', eff: { atk: 0.08, troopCap: 0.08 } },
};

const TECH_KEYS = Object.keys(TECHS);
const TECH_BRANCHES = ['农', '工', '商', '军'];
const TECH_TIERS = 10;

const BRANCH_COLOR = {
  农: '#6f8a4a',
  工: '#8a7a4a',
  商: '#a8863a',
  军: '#8a4a4a',
};

// 每分支每层最高成本（用于 UI 汇总）
function branchTotalCost(branch) {
  return TECH_KEYS.filter(k => TECHS[k].branch === branch)
    .reduce((s, k) => s + TECHS[k].cost, 0);
}

function emptyTechAcc() {
  return { food: 0, gold: 0, mat: 0, iron: 0, pop: 0, granary: 0, troopCap: 0,
           atk: 0, def: 0, siege: 0, cav: 0, arc: 0, inf: 0, speed: 0, buildCost: 0, morale: 0 };
}

function techMultipliers(done) {
  const acc = emptyTechAcc();
  for (const k of Object.keys(done || {})) {
    const t = TECHS[k];
    if (!t || !done[k]) continue;
    for (const e in t.eff) acc[e] = (acc[e] || 0) + t.eff[e];
  }
  const m = {};
  for (const k in acc) m[k] = 1 + acc[k];
  return m;
}
