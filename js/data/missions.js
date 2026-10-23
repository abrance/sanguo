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
  envoy: {
    id: 'envoy',
    weight: 12,
    title: '奉命出使',
    make(G) {
      const target = Diplo.envoyTarget(G);
      if (!target) return null;
      const x = Diplo.pair(G, G.player.factionId, target);
      return {
        type: 'envoy',
        targetFid: target,
        targetRel: Math.min(60, Math.round(x.rel + 20)),
        expireTurn: G.meta.turn + 8,
        rewardMerit: 20,
        rewardFavor: 8,
      };
    },
    desc(m, G) {
      const f = G.factions[m.targetFid];
      return `使${f ? f.name : '邻邦'}与我方和好（关系提至 ${m.targetRel}）`;
    },
  },

  intrigue: {
    id: 'intrigue',
    weight: 10,
    minRank: 4,   // 离间要以国家名义上表，官未至州牧做不了（见 Diplo.layer）
    title: '奉命离间',
    make(G) {
      const pick = Diplo.intrigueTarget(G);
      if (!pick) return null;
      const x = Diplo.pair(G, pick.a, pick.b);
      return {
        type: 'intrigue',
        aFid: pick.a,
        bFid: pick.b,
        targetRel: Math.round(x.rel) - 15,
        expireTurn: G.meta.turn + 8,
        rewardMerit: 24,
        rewardFavor: 10,
      };
    },
    desc(m, G) {
      const a = G.factions[m.aFid], b = G.factions[m.bFid];
      return `离间${a ? a.name : '?'}与${b ? b.name : '?'}（关系压至 ${m.targetRel} 以下）`;
    },
  },
};

/** 选征讨目标：与直辖城相邻、且正在交战的最弱敌城 */
function pickExpeditionTarget(G) {
  const seen = new Set();
  let best = null;
  for (const c of State.demesne(G)) {
    for (const nb of State.neighbors(G, c.id, 235)) {
      if (nb.owner === G.player.factionId) continue;
      if (!Diplo.canAttack(G, G.player.factionId, nb.owner)) continue;
      if (seen.has(nb.id)) continue;
      seen.add(nb.id);
      const score = Combat.defenseScore(G, nb) / Math.max(1, nb.pop);
      if (!best || score < best.score) best = { id: nb.id, score };
    }
  }
  return best ? best.id : null;
}

const MISSION_LIST = ['tribute', 'levy', 'expedition', 'envoy', 'intrigue'];

/** 按权重抽一个类型（minRank 未达的类型不发，避免下派做不了的活） */
function pickMissionType(G) {
  const rank = G && G.player ? G.player.rank : 99;
  const pool = MISSION_LIST.filter(k => (MISSION_TYPES[k].minRank || 0) <= rank);
  const total = pool.reduce((s, k) => s + MISSION_TYPES[k].weight, 0);
  let r = RNG.next() * total;
  for (const k of pool) {
    r -= MISSION_TYPES[k].weight;
    if (r <= 0) return k;
  }
  return 'tribute';
}
