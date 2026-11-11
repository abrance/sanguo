// 军区：一名都督统辖多城（直辖城与属下治理之城皆可），每月自动营建、征兵、集结、出兵。
// 玩家不插手时它自己干活；玩家的号令通过 stance / targetFid 约束它打谁、打不打。
const Legion = {

  STANCES: {
    defend: { id: 'defend', name: '守土', desc: '不出兵，只营建、征兵、向前线输送兵力。' },
    expand: { id: 'expand', name: '拓边', desc: '只打已交战势力与在野之城，不主动开新战线。' },
    strike: { id: 'strike', name: '征讨', desc: '专打玩家指定的势力（点名即宣战）。未定目标时只在已交战势力与在野之城的范围内用兵，不替你开新战线。' },
  },

  /** 当前号令允许打的目标 */
  _targetAllowed(G, lg, city) {
    if (!city.owner || city.owner === G.player.factionId) return false;
    if (lg.stance === 'defend') return false;
    if (lg.stance === 'strike') {
      // 未定目标：按「已交战 + 在野」用兵，不自作主张开新战线
      if (!lg.targetFid) {
        return city.owner === 'free' || Diplo.canAttack(G, G.player.factionId, city.owner);
      }
      // 征讨：指定势力优先，其次已交战的势力与在野之城 ——
      // 只许打目标本身的话，隔着两家的目标永远打不到（兵锋不及，军区就空转）
      return city.owner === lg.targetFid || city.owner === 'free'
        || Diplo.canAttack(G, G.player.factionId, city.owner);
    }
    // expand：只碰已交战的势力，或在野
    return city.owner === 'free' || Diplo.canAttack(G, G.player.factionId, city.owner);
  },

  /** 征兵：补到方针比例（钱不够就按现有钱能买多少） */
  _recruit(G, c, P) {
    const cap = State.troopCapOf(G, c);
    const target = cap * P.recruitRatio;
    const cur = troopTotal(c.garrison);
    if (cur >= target * 0.97 || c.gold <= 80) return;
    const want = Math.min(Math.round(target - cur), Math.round(c.pop * 1.2));
    if (want < 20) return;
    Recruit.autoFill(G, c, want, true);
  },

  run(G, stamp) {
    const f = G.factions[G.player.factionId];
    if (!f || f.dead) return;

    for (const lg of State.legions(G)) {
      const h = G.heroes[lg.heroId];
      if (!h || !h.alive) continue;

      const cities = State.legionCities(G, lg);
      if (!cities.length) continue;

      // 征讨目标已停战或覆灭：军区转守土待命，否则会一直空转（打不了、也不打别人）
      // 未定目标（刚点下征讨、还没挑人）不走这条 —— 否则号令一秒被改回守土
      if (lg.stance === 'strike' && lg.targetFid) {
        const tf = lg.targetFid && G.factions[lg.targetFid];
        const canReach = tf && !tf.dead
          && Diplo.statusOf(G, G.player.factionId, lg.targetFid) === Diplo.WAR;
        if (!canReach) {
          State.log(G, 'note', `${h.name}军区所征之敌已不可攻，转为守土待命。`);
          lg.stance = 'defend';
          lg.targetFid = null;
        }
      }

      // 1 营建 + 征兵（沿用方针表，只是把"谁管"从城换成军区）
      //    征讨号令下先征兵再营建：先把兵攥在手里，当月就能举兵
      const P = POLICIES[lg.policy] || POLICIES.balanced;
      const strike = lg.stance === 'strike';
      for (const c of cities) {
        if (strike) Legion._recruit(G, c, P);
        Build.autoWork(G, c, P, strike ? 0 : 150);
        if (!strike) Legion._recruit(G, c, P);
        c.morale = U.clamp(c.morale + 1 + State.bld(c, 'drill') * 0.6, 0, 100);
      }

      if (lg.stance === 'defend') continue;

      // 2 集结 / 出兵：复用 AI 的决策，用 filter 把号令约束套上去
      //    征讨 = 玩家点了名的仗：不按预算与路数省，目标势力优先（合攻 / 胜算仍照算）
      const filter = city => Legion._targetAllowed(G, lg, city);
      const force = strike;
      const preferFid = strike ? lg.targetFid : null;
      AI._mass(G, f, cities, stamp, null, filter, force, preferFid);

      const before = new Set(Object.values(G.armies).map(a => a.id));
      AI._attack(G, f, cities, stamp, null, filter, force, preferFid);
      // 给本军区派出的军队打标记，战果统计与拔城归属都靠它
      for (const a of Object.values(G.armies)) {
        if (before.has(a.id) || a.factionId !== G.player.factionId || a.mission !== 'attack') continue;
        a.legionId = lg.id;
        lg.stats.attacks = (lg.stats.attacks || 0) + 1;
      }
      // 打不出去 / 没兵可出 → 在纪事里说明一次，免得玩家以为号令没生效
      if (strike && !Object.values(G.armies).some(a => a.factionId === f.id && a.mission === 'attack')) {
        if (!lg._idleAt || G.meta.turn - lg._idleAt >= 3) {
          lg._idleAt = G.meta.turn;
          const tn = lg.targetFid && G.factions[lg.targetFid] ? G.factions[lg.targetFid].name : '当前可攻之敌';
          State.log(G, 'note', `${h.name}军区奉命征讨${tn}，兵锋未及（或兵不足），先营建征兵。`);
        }
      }
    }
  },
};
