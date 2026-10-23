// AI 军事：防守 > 进攻 > 集结，一个月只做其中一件
// 旧版 _mass 与 _attack 同月各抽一次兵，互相拆台；现在共用 plan 里的兵力账目。
const AIWar = {

  run(G, f, plan, stamp, opts = {}) {
    // 只有「真要被打穿」才算紧急：像旧版那样一见敌军就整月不动，多线战时等于永久停摆
    const severe = plan.threatened.filter(t => {
      const city = G.cities[t.cityId];
      return t.eta <= 1 || (city && t.troops >= plan.garrison(city) * 1.1);
    });

    // ① 紧急 → 回防，本月不出击
    if (severe.length && !opts.force) {
      AIWar.defend(G, f, plan, stamp, severe);
      return;
    }
    // ② 不紧急：该打就打
    if (AIWar.attack(G, f, plan, stamp, opts)) return;
    // ③ 打不动 → 先给受威胁城输兵，再向后集结
    if (plan.threatened.length) AIWar.defend(G, f, plan, stamp, plan.threatened);
    AIWar.mass(G, f, plan, stamp, opts);
  },

  /** 从后方、无威胁的城向受威胁城输兵；只在"能改变局面"时才送 */
  defend(G, f, plan, stamp, list) {
    const T = AI.TUNE;
    const targets = [...(list || plan.threatened)].sort((a, b) => a.eta - b.eta);

    for (const th of targets) {
      const dst = G.cities[th.cityId];
      if (!dst) continue;
      let need = Math.round(th.troops * 1.2 - plan.garrison(dst));
      if (need < 120) continue;

      const donors = plan.cities
        .filter(c => c.id !== dst.id && !plan.incoming[c.id])
        .map(c => ({ c, spare: plan.spareOf(c) }))
        .filter(o => o.spare >= T.minSpare)
        .sort((a, b) => (U.dist(a.c.x, a.c.y, dst.x, dst.y) - U.dist(b.c.x, b.c.y, dst.x, dst.y)));

      for (const { c: src, spare } of donors) {
        if (need < T.minSpare) break;
        const take = Math.min(spare, need);
        if (take < T.minSpare) continue;
        const ratio = take / Math.max(1, plan.garrison(src));
        const troops = Army.takeFromGarrison(src.garrison, ratio);
        const size = troopTotal(troops);
        if (size < T.minSpare) {
          for (const k in troops) src.garrison[k] = (src.garrison[k] || 0) + troops[k];
          continue;
        }
        Army.create(G, {
          factionId: f.id, heroId: null, from: src.id, to: dst.id,
          troops, mission: 'reinforce',
        });
        need -= size;
      }
    }
  },

  /**
   * 出兵：按 plan.targets（已按战力比排序）挑最多 maxRoutes 路。
   * 预算 = 兵力 × commitRatio − 本回合已投入（军区与 AI 共用这一笔账）。
   */
  attack(G, f, plan, stamp, opts = {}) {
    const T = AI.TUNE;
    const force = !!opts.force;
    let budget = force ? Infinity : Math.max(0, plan.budget);
    let routed = 0;
    let spent = 0;
    const maxRoutes = force ? Math.max(2, plan.cities.length) : plan.maxRoutes;
    const hit = new Set();    // 同一目标本月只派一路：两路同攻一座城是在浪费兵
    const used = new Set();   // 同一座城本月只出一路：第二路的胜算按剩余兵力算就不准了

    for (const t of plan.targets) {
      if (routed >= maxRoutes) break;
      if (hit.has(t.to) || used.has(t.from)) continue;
      if (!force) {
        if (budget < T.minArmy) break;
        // 平时只打"能赢且能留下四成兵"的目标；force 是玩家号令，照打
        if (!t.pred.win) continue;
        if (t.pred.remain < t.size * 0.45) continue;
      }
      const from = G.cities[t.from];
      if (!from) continue;

      // 用实时驻军重算可抽（前一路已经抽走一部分）
      const spare = plan.spareOf(from);
      if (spare < T.minArmy) continue;
      const cap = State.troopCapOf(G, from);
      const floor = force ? cap * T.reserveForce : 0;
      const take = Math.max(0, Math.min(spare, budget, plan.garrison(from) - floor));
      if (take < T.minArmy) continue;

      const ratio = take / Math.max(1, plan.garrison(from));
      const troops = Army.takeFromGarrison(from.garrison, ratio);
      const size = troopTotal(troops);
      if (size < T.minArmy) {
        for (const k in troops) from.garrison[k] = (from.garrison[k] || 0) + troops[k];
        continue;
      }

      const a = Army.create(G, {
        factionId: f.id, heroId: AIWar._pickHero(G, f, from),
        from: from.id, to: t.to, troops, mission: 'attack',
      });
      f._offense = f._offense || [];
      f._offense.push({ armyId: a.id, cityId: t.to, turn: G.meta.turn });

      budget -= size;
      spent += size;
      routed++;
      hit.add(t.to);
      used.add(t.from);
    }
    return routed > 0;
  },

  /** 集结：把后方盈余兵送到"目标最划算"的前线城市，攒够了下个月再打 */
  mass(G, f, plan, stamp, opts = {}) {
    const T = AI.TUNE;
    if (plan.cities.length < 2) return false;
    if (!opts.force && !RNG.chance(0.16 + f.aggression * 0.20 + (f.momentum - 1) * 0.35)) return false;

    const best = plan.targets[0];
    if (!best) return false;
    const staging = G.cities[best.from];
    if (!staging) return false;

    // 集结上限：堆到兵额 1.15 倍就打住（再多养不起）
    const cap = State.troopCapOf(G, staging);
    let inbound = 0;
    for (const a of Object.values(G.armies)) {
      if (a.to === staging.id && a.factionId === f.id) inbound += troopTotal(a.troops);
    }
    if (plan.garrison(staging) + inbound > cap * 1.15) return false;

    const donors = plan.cities
      .filter(c => c.id !== staging.id)
      .filter(c => !plan.exclude || !plan.exclude.has(c.id))
      .filter(c => U.dist(c.x, c.y, staging.x, staging.y) <= 460)
      .map(c => ({ c, spare: plan.spareOf(c) }))
      .filter(o => o.spare > T.minSpare)
      .sort((a, b) => b.spare - a.spare)
      .slice(0, 3);

    let sent = 0;
    for (const { c: src, spare } of donors) {
      const ratio = Math.min(spare, plan.garrison(src) * 0.6) / Math.max(1, plan.garrison(src));
      const troops = Army.takeFromGarrison(src.garrison, ratio);
      const size = troopTotal(troops);
      if (size < T.minSpare) {
        for (const k in troops) src.garrison[k] = (src.garrison[k] || 0) + troops[k];
        continue;
      }
      Army.create(G, {
        factionId: f.id, heroId: null, from: src.id, to: staging.id,
        troops, mission: 'reinforce',
      });
      sent++;
    }
    return sent > 0;
  },

  /** 选将：优先本城闲着的将，其次统率最高者；都不在就空将出征 */
  _pickHero(G, f, city) {
    if (city.governor && G.heroes[city.governor] && city.governor !== PLAYER_HERO_ID) {
      return city.governor;
    }
    const cand = Object.values(G.heroes)
      .filter(h => h.alive && h.factionId === f.id && h.cityId === city.id && h.id !== PLAYER_HERO_ID)
      .sort((a, b) => b.tong - a.tong)[0];
    return cand ? cand.id : null;
  },
};
