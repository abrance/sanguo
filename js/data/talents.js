// 玩家天赋：开局选一项，只作用于玩家直辖城 / 玩家军队 / 玩家外交
// 数值全部走 talentOf()，各系统调用点自己判断归属，不引入全局乘数
const TALENTS = {
  merchant: {
    id: 'merchant', name: '商人', icon: '钱',
    desc: '钱币产出 +25%，外交花费 -25%',
    gold: 1.25, diploCost: 0.75,
  },
  cavalry: {
    id: 'cavalry', name: '骑兵', icon: '骑',
    desc: '行军速度 +30%，骑兵兵额 +40%',
    speed: 1.30, cav: 1.40,
  },
  farmer: {
    id: 'farmer', name: '农夫', icon: '粮',
    desc: '粮产 +25%，仓廪上限 +30%',
    food: 1.25, granary: 1.30,
  },
  general: {
    id: 'general', name: '将才', icon: '将',
    desc: '我军战力 +12%，出征士气 +10',
    atk: 1.12, def: 1.12, armyMorale: 10,
  },
  artisan: {
    id: 'artisan', name: '工匠', icon: '工',
    desc: '营造工期 -25%，建材铁料 +20%',
    buildFactor: 1.33, mat: 1.20, iron: 1.20,
  },
  diplomat: {
    id: 'diplomat', name: '纵横家', icon: '纵',
    desc: '外交花费 -40%，关系回暖更快',
    diploCost: 0.60, relUp: 1.6,
  },
};

const TALENT_KEYS = Object.keys(TALENTS);

/** 玩家天赋数值；没选过（旧存档）返回空对象，所有乘数按 1 处理 */
function talentOf(G) {
  const id = G && G.player && G.player.talent;
  return (id && TALENTS[id]) || {};
}

/** UI 用：天赋名称 */
function talentName(G) {
  const t = talentOf(G);
  return t.name || '无';
}
