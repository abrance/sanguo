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
    // ② 不紧急：该打就打（单路打不下会自动转成合攻）
    const attacked = AIWar.attack(G, f, plan, stamp, opts);
    // ③ 预判威胁：邻国兵力足以压过来就先补防（不阻塞进攻，只花剩余盈余）
    if (plan.exposed && plan.exposed.length) {
      AIWar.defend(G, f, plan, stamp, plan.exposed.map(e => ({
        cityId: e.cityId, eta: 3, troops: Math.round(e.pressure * 0.8),
      })));
    }
    // ④ 已经在挨打的，补兵
    if (plan.threatened.length) AIWar.defend(G, f, plan, stamp, plan.threatened);
    if (attacked) return;
    // ⑤ 都打不动 → 向后集结，等下个月
    AIWar.mass(G, f, plan, stamp, opts);
  },

  /**
   * 从后方、无威胁的城向受威胁城输兵。
   * 每座目标城最多派一路（挑最近且能覆盖需求的捐兵城），每势力每月最多 2 路 ——
   * 以前会对每个目标把所有有盈余的城都抽一遍，结果 4 座城的势力每月造 7-9 支援军，
   * 两成兵力常年漂在路上，城里反而空着。
   */
  defend(G, f, plan, stamp, list) {
    const T = AI.TUNE;
    const targets = [...(list || plan.threatened)].sort((a, b) => a.eta - b.eta);
    let sent = 0;
    const inbound = AIWar._inboundReinforce(G, f);

    for (const th of targets) {
      if (sent >= T.maxReinforce || inbound > T.maxReinforceInTransit) break;
      const dst = G.cities[th.cityId];
      if (!dst) continue;

      const need = Math.round(th.troops * 1.2 - plan.garrison(dst));
      if (need < T.minSpare) continue;
      const capDst = State.troopCapOf(G, dst);
      if (plan.garrison(dst) > capDst * 0.85 && th.troops < plan.garrison(dst) * 0.8) continue;

      // 一座城只挑一个捐兵城：距离近的优先，能覆盖需求更好
      const donors = plan.cities
        .filter(c => c.id !== dst.id && !plan.incoming[c.id])
        .map(c => ({ c, spare: plan.spareOf(c), d: U.dist(c.x, c.y, dst.x, dst.y) }))
        .filter(o => o.spare >= T.minSpare)
        .sort((a, b) => (a.d - b.d));

      const pick = donors.find(o => o.spare >= need) || donors[0];
      if (!pick) continue;

      const take = Math.min(pick.spare, need);
      if (take < T.minSpare) continue;
      const ratio = take / Math.max(1, plan.garrison(pick.c));
      const troops = Army.takeFromGarrison(pick.c.garrison, ratio);
      const size = troopTotal(troops);
      if (size < T.minSpare) {
        for (const k in troops) pick.c.garrison[k] = (pick.c.garrison[k] || 0) + troops[k];
        continue;
      }
      Army.create(G, {
        factionId: f.id, heroId: null, from: pick.c.id, to: dst.id,
        troops, mission: 'reinforce',
      });
      sent++;
    }
    return sent;
  },

  /** 本势力在途援军数与兵力（用来限制"兵常年漂在路上"） */
  _inboundReinforce(G, f) {
    let n = 0;
    for (const a of Object.values(G.armies)) {
      if (a.factionId === f.id && a.mission === 'reinforce') n++;
    }
    return n;
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
    const maxRoutes = force ? Math.max(2, plan.cities.length) : plan.maxRoutes;
    const hit = new Set();    // 同一目标本月只派一路：两路同攻一座城是在浪费兵
    const used = new Set();   // 同一座城本月只出一路：第二路的胜算按剩余兵力算就不准了

    for (const t of plan.targets) {
      if (routed >= maxRoutes) break;
      if (hit.has(t.to) || used.has(t.from)) continue;

      const from = G.cities[t.from];
      const dst = G.cities[t.to];
      if (!from || !dst) continue;

      // 先算出「这一路实际能走多少兵」，再拿这个数去预测 ——
      // 顺序反了就会出现「按计划的大军算胜算、实际只发出预算剩下的那点兵」，
      // 于是预测赢的仗大量打输（实测败仗率一度到 53%）
      const spare = plan.spareOf(from);
      if (spare < T.minArmy) continue;
      const cap = State.troopCapOf(G, from);
      const floor = force ? cap * T.reserveForce : 0;
      const take = Math.max(0, Math.min(spare, budget, plan.garrison(from) - floor));
      if (take < T.minArmy) continue;

      const ratio = take / Math.max(1, plan.garrison(from));
      const troops = Army.previewDispatch(from, ratio);
      const size = troopTotal(troops);
      if (size < T.minArmy) continue;

      if (!force) {
        if (budget < T.minArmy) break;
        const eta = Army.estimateEta(from, dst, troops, Army.speedMul(G, f.id));
        const grow = 1 + Math.min(0.30, 0.10 * eta);
        const pred = Combat.predict(G, troops, from.governor,
          { ...dst, garrison: State.scaleTroops(dst.garrison, grow) }, f.id, State.bld(from, 'drill'));
        if (!pred.win) continue;
        // 攻军至少走一个月，守军这期间会补兵/增援：险胜等于送，留足余量
        if (pred.remain < size * T.attackMargin) continue;
      }

      const actual = Army.takeFromGarrison(from.garrison, ratio);
      const sentSize = troopTotal(actual);
      if (sentSize < T.minArmy) {
        for (const k in actual) from.garrison[k] = (from.garrison[k] || 0) + actual[k];
        continue;
      }

      const a = Army.create(G, {
        factionId: f.id, heroId: AIWar._pickHero(G, f, from),
        from: from.id, to: dst.id, troops: actual, mission: 'attack',
      });
      f._offense = f._offense || [];
      f._offense.push({ armyId: a.id, cityId: dst.id, turn: G.meta.turn });

      budget -= sentSize;
      routed++;
      hit.add(t.to);
      used.add(t.from);
    }

    // 会攻：一路打不下来，就凑两三路约定同月抵达（Army.advance 会把它们合成一战）
    if (!force && routed === 0 && budget >= T.minArmy * 2) {
      const cd = f._convergeTurn || 0;
      if (G.meta.turn - cd >= T.convergeCooldown) {
        const spent2 = AIWar._converge(G, f, plan, budget);
        if (spent2 > 0) { f._convergeTurn = G.meta.turn; return true; }
      }
    }
    return routed > 0;
  },

  /**
   * 合攻：从 2-3 座城同时压向同一座城。
   * 关键在于「同步抵达」—— 用 Army.create 的 delay 把慢的一路等齐，否则第一支先撞死，
   * 第二支到的时候城已经是自己的，只会变成合兵。
   */
  _converge(G, f, plan, budget) {
    const T = AI.TUNE;
    const tried = new Set();
    const agro = troops => TROOP_KEYS.reduce((s, k) => s + (troops[k] || 0), 0);

    for (const t of plan.targets) {
      if (t.pred.win) continue;          // 单路能赢就不必合攻
      if (tried.has(t.to)) continue;
      tried.add(t.to);

      const dst = G.cities[t.to];
      const leadFrom = G.cities[t.from];
      if (!dst || !leadFrom) continue;
      // 城墙太厚别指望合攻：两三路凑起来也啃不动，只会白送
      if (State.bld(dst, 'wall') > T.convergeMaxWall) continue;

      const leadEta = Army.estimateEta(leadFrom, dst, t.troops, Army.speedMul(G, f.id));
      const sources = plan.cities
        .filter(c => c.id !== t.from && !plan.incoming[c.id])
        .filter(c => plan.spareOf(c) >= T.minSpare)
        .filter(c => U.dist(c.x, c.y, dst.x, dst.y) <= 460)
        // 只挑抵达月数相差不超过 1 的：delay 越久，预测越容易过期（守军会补兵）
        .filter(c => Math.abs(Army.estimateEta(c, dst, Army.previewDispatch(c, 1), Army.speedMul(G, f.id)) - leadEta) <= 1)
        .sort((a, b) => U.dist(a.x, a.y, dst.x, dst.y) - U.dist(b.x, b.y, dst.x, dst.y))
        .slice(0, 2);
      if (!sources.length) continue;

      // 逐路累加，直到预测能赢
      const sum = { ...t.troops };
      const picks = [{ from: t.from, size: t.size }];
      let total = t.size, win = false;
      for (const src of sources) {
        const ratio = plan.spareOf(src) / Math.max(1, plan.garrison(src));
        const troops = Army.previewDispatch(src, ratio);
        const size = troopTotal(troops);
        for (const k of TROOP_KEYS) sum[k] = (sum[k] || 0) + (troops[k] || 0);
        total += size;
        picks.push({ from: src.id, size });
        // 守军在合攻凑齐的这几个月里会补兵：按兵额 80% 与每月 +10% 取大者预估
        const etaC = Army.estimateEta(leadFrom, dst, sum, Army.speedMul(G, f.id));
        const growC = 1 + Math.min(0.30, 0.10 * etaC);
        const pred = Combat.predict(G, sum, leadFrom.governor,
          { ...dst, garrison: State.scaleTroops(dst.garrison, growC) }, f.id, State.bld(leadFrom, 'drill'));
        // 留足余量：合攻要好几个月才凑齐，守军中途可能补兵，险胜等于送
        if (pred.win && pred.remain >= agro(sum) * 0.6) { win = true; break; }
      }
      if (!win || total < T.minArmy * 2) continue;
      if (total > budget) continue;      // 一次合攻吃掉过半兵力就别干

      // 同步抵达：先按实际成军的 eta 造好，再把慢的一路等齐
      // （用 estimateEta 预估值算 delay 会因为取整差 1 个月，几路就错开成单独送死）
      const made = [];
      let spent = 0;
      for (const p of picks) {
        const from = G.cities[p.from];
        if (!from) continue;
        const live = plan.spareOf(from);
        if (live < T.minArmy) continue;
        const take = Math.min(live, p.size);
        const ratio = take / Math.max(1, plan.garrison(from));
        const troops = Army.takeFromGarrison(from.garrison, ratio);
        const size = troopTotal(troops);
        if (size < T.minArmy) {
          for (const k in troops) from.garrison[k] = (from.garrison[k] || 0) + troops[k];
          continue;
        }
        const a = Army.create(G, {
          factionId: f.id, heroId: AIWar._pickHero(G, f, from),
          from: from.id, to: dst.id, troops, mission: 'attack',
        });
        f._offense = f._offense || [];
        f._offense.push({ armyId: a.id, cityId: dst.id, turn: G.meta.turn });
        made.push(a);
        spent += size;
      }

      if (made.length >= 2) {
        const maxEta = Math.max(...made.map(a => a.eta));
        for (const a of made) a.delay = Math.max(0, maxEta - a.eta);
        return spent;
      }
      // 只凑出一路：撤销，别送
      for (const a of made) {
        const from = G.cities[a.from];
        if (from) for (const k of TROOP_KEYS) from.garrison[k] = (from.garrison[k] || 0) + (a.troops[k] || 0);
        if (a.heroId && G.heroes[a.heroId]) G.heroes[a.heroId].cityId = a.from;
        f._offense = (f._offense || []).filter(rec => rec.armyId !== a.id);
        delete G.armies[a.id];
      }
      return 0;

      // 只发出一路：把这一路撤回来（合攻没成型就别浪费）

    }
    return 0;
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

    // 在途援军太多就别再抽了：以前每月都往同一座城送，结果全势力两成兵力常年漂在路上，
    // 城池反而一直空着（外交求助时连 200 兵都拿不出来）
    let inboundAll = 0;
    for (const a of Object.values(G.armies)) {
      if (a.factionId === f.id && a.mission === 'reinforce') inboundAll += troopTotal(a.troops);
    }
    if (inboundAll > plan.totalTroops * 0.25) return false;

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
      .slice(0, 2);

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
