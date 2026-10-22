// 上级任务（上命）：类型模板与生成规则
// 任务对象：{ id, type, title, desc, res, amount, targetCityId,
//            expireTurn, rewardMerit, rewardFavor, done, failed }

const MISSION_TYPES = {

  tribute: {
    id: 'tribute',
    weight: 40,
    title: '催征上贡',
    make(G) {
      const n = Math.max(1, State.demesne(G).length);
      const useGold = RNG.chance(0.55);
      const amount = useGold
        ? Math.round(150 + n * 110 + G.meta.turn * 2)
        : Math.round(320 + n * 280 + G.meta.turn * 4);
      return {
        type: 'tribute',
        res: useGold ? 'gold' : 'food',
        amount,
        expireTurn: G.meta.turn + 6,
        rewardMerit: 22,
        rewardFavor: 10,
      };
    },
    desc(m, G) {
      const name = m.res === 'gold' ? '钱' : '粮';
      return `上缴${name} ${U.num(m.amount)}`;
    },
  },

  levy: {
    id: 'levy',
    weight: 20,
    title: '募兵上缴',
    make(G) {
      let troops = 0;
      for (const c of State.demesne(G)) troops += troopTotal(c.garrison);
      const amount = Math.max(80, Math.round(troops * 0.18));
      return {
        type: 'levy',
        res: 'troops',
        amount,
        expireTurn: G.meta.turn + 5,
        rewardMerit: 18,
        rewardFavor: 8,
      };
    },
    desc(m) { return `输送兵卒 ${U.num(m.amount)}`; },
  },

  expedition: {
    id: 'expedition',
    weight: 40,
    title: '奉命征讨',
    make(G) {
      const target = pickExpeditionTarget(G);
      if (!target) return null;
      return {
        type: 'expedition',
        targetCityId: target,
        expireTurn: G.meta.turn + 10,
        rewardMerit: 40,
        rewardFavor: 14,
      };
    },
    desc(m, G) {
      const c = G.cities[m.targetCityId];
      return `攻取${c ? c.name : '敌城'}（${c && G.factions[c.owner] ? G.factions[c.owner].name : ''}）`;
    },
  },
};

/** 选征讨目标：与直辖城相邻的敌方城中最弱的一座 */
function pickExpeditionTarget(G) {
  const seen = new Set();
  let best = null;
  for (const c of State.demesne(G)) {
    for (const nb of State.neighbors(G, c.id, 235)) {
      if (nb.owner === G.player.factionId) continue;
      if (seen.has(nb.id)) continue;
      seen.add(nb.id);
      const score = Combat.defenseScore(G, nb) / Math.max(1, nb.pop);
      if (!best || score < best.score) best = { id: nb.id, score };
    }
  }
  return best ? best.id : null;
}

const MISSION_LIST = ['tribute', 'levy', 'expedition'];

/** 按权重抽一个类型 */
function pickMissionType() {
  const total = MISSION_LIST.reduce((s, k) => s + MISSION_TYPES[k].weight, 0);
  let r = RNG.next() * total;
  for (const k of MISSION_LIST) {
    r -= MISSION_TYPES[k].weight;
    if (r <= 0) return k;
  }
  return 'tribute';
}
