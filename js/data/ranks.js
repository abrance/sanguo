// 官阶体系：7 阶。晋升靠战功，直辖城上限随之提高。
const RANKS = [
  { lvl: 1, name: '县长', meritNeeded: 0,    maxCities: 2,   unlock: ['内政营造', '征兵'] },
  { lvl: 2, name: '太守', meritNeeded: 60,   maxCities: 3,   unlock: ['委任太守'] },
  { lvl: 3, name: '刺史', meritNeeded: 160,  maxCities: 5,   unlock: ['征调同僚兵力', '截留他城税赋'] },
  { lvl: 4, name: '州牧', meritNeeded: 320,  maxCities: 9,   unlock: ['上表言事'] },
  { lvl: 5, name: '将军', meritNeeded: 560,  maxCities: 14,  unlock: ['不待上命即可出兵'] },
  { lvl: 6, name: '三公', meritNeeded: 900,  maxCities: 20,  unlock: ['代君行令'] },
  { lvl: 7, name: '丞相', meritNeeded: 1400, maxCities: 99,  unlock: ['录尚书事'] },
];

function rankOf(lvl) {
  return RANKS[U.clamp(lvl, 1, RANKS.length) - 1];
}

function nextRank(lvl) {
  return RANKS[lvl] || null;
}

// 三路线
const ROUTES = {
  loyal: {
    id: 'loyal', name: '忠臣',
    buff: ['每月受上级赏赐（粮 / 钱）', '晋升战功门槛 ×0.70', '同僚归心，不易被构陷'],
    debuff: ['直辖城上限 -1', '上级好感低时会被削权'],
    meritNeededMul: 0.70,
    cityCapDelta: -1,
    favorDrift: +0.8,
    subsidy: true,
    color: '#4a7a4a',
  },
  dominant: {
    id: 'dominant', name: '权臣',
    buff: ['可征调同僚城池兵力', '可截留他城税赋', '同僚不敢为敌，晋升不受阻'],
    debuff: ['君主猜忌：好感持续下滑，定期生变', '晋升战功门槛 ×1.10'],
    meritNeededMul: 1.10,
    cityCapDelta: 0,
    favorDrift: -1.2,
    subsidy: false,
    color: '#8a6a2f',
  },
  independent: {
    id: 'independent', name: '自立',
    buff: ['全权自主，不缴不贡', '直辖城上限 +2', '财政完全独立，科技自成一路'],
    debuff: ['原势力即刻宣战', '外交孤立，无人来援'],
    meritNeededMul: 1.00,
    cityCapDelta: +2,
    favorDrift: 0,
    subsidy: false,
    color: '#8a2f2f',
  },
};

// 当前战功所需晋升阈值（考虑路线修正）
function meritThreshold(player) {
  const nr = nextRank(player.rank);
  if (!nr) return Infinity;
  const route = ROUTES[player.route] || ROUTES.loyal;
  return Math.round(nr.meritNeeded * route.meritNeededMul);
}

// 当前直辖城上限（路线 + 上级好感共同修正）
function cityCap(player) {
  const r = rankOf(player.rank);
  const route = ROUTES[player.route] || ROUTES.loyal;
  let cap = r.maxCities + route.cityCapDelta;

  const favor = player.favor == null ? 60 : player.favor;
  if (favor < 30) cap -= 1;
  else if (favor > 80) cap += 1;

  return Math.max(2, cap);
}

// 自立门槛
const INDEPENDENCE = {
  minCities: 2,
  minReputation: 150,
  minRank: 3,        // 需先至刺史，才有人望自立
};
