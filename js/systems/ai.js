// AI 编排层：每个势力每月走一遍「评估 → 内政 → 军事」
//
// 分工（改代码前先看这里）：
//   AI.assess  —— 把局势压成一个可读对象：威胁 / 留守下限 / 可抽兵力 / 带胜算的目标 / 预算
//   AIEcon     —— 税 → 募兵 → 营造（ai-econ.js，按战时/平时改比例与顺序）
//   AIWar      —— 防守 > 进攻 > 集结，三选一（ai-war.js，不再同月互相抽兵）
//
// 设计口径见 docs/AI.md。调平衡优先改 AI.TUNE 与两张表（buildOrder / ratioFor），
// 不要在流程里塞零散判断 —— 以前就是那样长成一团的。
const AI = {

  /** 全部旋钮集中一处 */
  TUNE: {
    commitRatio: 0.75,      // 单回合最多抽走全势力在册兵力的比例
    reservePeace: 0.30,     // 非前线城留守（占现有兵力）
    reserveFront: 0.40,     // 前线城（邻接敌国）留守（占现有兵力）
    reserveThreat: 0.90,    // 已有敌军在途指向此城：按现有兵力保留
    reserveForce: 0.15,     // 硬底：任何情况下留在城里不低于兵额的 15%
    threatEta: 2,           // 几回合内会挨打 → 本月转守
    maxRoutesPeace: 1,      // 平时每月最多开几路（其余精力用于集结）
    maxRoutesWar: 8,        // 战时每月最多开几路（仍受 commitRatio 与留守下限限制）
    avoidMonths: 6,         // 打不下来的目标冷落几个月
    minSpare: 120,          // 可抽兵少于这个数就不折腾
    minArmy: 150,           // 成军下限（与其送人头不如囤着）
    frontRange: 235,        // 判定「前线」与「邻接目标」的半径
  },

  run(G, stamp) {
    for (const f of Object.values(G.factions)) {
      if (f.kind === 'free' || f.dead) continue;

      f.momentum = State.momentum(G, f.id);

      let cities = State.factionCities(G, f.id);
      if (!cities.length) continue;

      // 玩家直辖城不归 AI 调度（与 Diplo.sendAid 的同一条不变量）
      let exclude = null;
      if (f.id === G.player.factionId) {
        exclude = new Set(State.demesne(G).map(c => c.id));
        cities = cities.filter(c => !exclude.has(c.id));
        if (!cities.length) continue;
      }

      AI._settleOffense(G, f);
      const plan = AI.assess(G, f, cities, { exclude });
      AIEcon.run(G, f, plan);
      AIWar.run(G, f, plan, stamp);
      AI._trace(G, plan);
    }
  },

  /**
   * 局势评估：所有决策都从这一个对象读数据，不再各自散布 State 查询。
   */
  assess(G, f, cities, opts = {}) {
    const T = AI.TUNE;
    const turn = G.meta.turn;
    const avoid = f._avoid || {};
    const exclude = opts.exclude || null;

    // ── 在途敌军：指向我方城的 attack 军 ──
    const incoming = {};
    for (const a of Object.values(G.armies)) {
      if (a.factionId === f.id || a.mission !== 'attack') continue;
      const to = G.cities[a.to];
      if (!to || to.owner !== f.id) continue;
      (incoming[to.id] = incoming[to.id] || []).push(a);
    }
    const threatened = Object.keys(incoming).map(id => ({
      cityId: id,
      eta: Math.min(...incoming[id].map(a => a.eta)),
      troops: incoming[id].reduce((s, a) => s + troopTotal(a.troops), 0),
      by: incoming[id][0].factionId,
    })).filter(t => t.eta <= T.threatEta);

    // ── 前线判定：邻接活着的敌国（在野城不算威胁）──
    const isFront = c => State.neighbors(G, c.id, T.frontRange).some(nb =>
      nb.owner !== f.id && nb.owner !== 'free'
      && !(G.factions[nb.owner] && G.factions[nb.owner].dead));

    const garrison = c => troopTotal(c.garrison);

    // ── 留守下限：按「现有兵力」留，而不是按兵额留 ──
    // 按兵额留会在城市只填到 6 成时把可抽兵压到 2 成，AI 于是永远打不动（旧版直接抽 80% 走，才扩张得动）
    // 现在改成「留 30-40% 现有兵力 + 兵额 15% 的硬底」，既不至于裸城，也不至于打不出手。
    const reserveOf = c => {
      const g = garrison(c);
      if (incoming[c.id]) return Math.round(g * T.reserveThreat);
      const cap = State.troopCapOf(G, c);
      const keep = isFront(c) ? T.reserveFront : T.reservePeace;
      return Math.round(Math.max(cap * T.reserveForce, g * keep));
    };
    const spareOf = c => Math.max(0, garrison(c) - reserveOf(c));

    // ── 兵力账目 ──
    let totalTroops = 0, totalCap = 0, spareTotal = 0;
    for (const c of cities) {
      totalTroops += garrison(c);
      totalCap += State.troopCapOf(G, c);
      if (!exclude || !exclude.has(c.id)) spareTotal += spareOf(c);
    }
    const myArmies = Object.values(G.armies).filter(a => a.factionId === f.id);
    for (const a of myArmies) totalTroops += troopTotal(a.troops);
    const attackArmies = myArmies.filter(a => a.mission === 'attack');
    const outgoing = attackArmies.length;
    // 已经在路上的目标不再重复派兵（以前会从另一座城再打一遍同一座城，纯送）
    const pendingTargets = new Set(attackArmies.map(a => a.to));

    const wars = Object.keys(G.factions)
      .filter(id => id !== f.id && id !== 'free'
        && !(G.factions[id] && G.factions[id].dead)
        && Diplo.statusOf(G, f.id, id) === Diplo.WAR);

    // ── 目标清单：能打的、算得出胜算的、不在冷落期的 ──
    const targets = [];
    for (const from of cities) {
      if (exclude && exclude.has(from.id)) continue;
      const spare = spareOf(from);
      if (spare < T.minSpare) continue;

      for (const nb of State.neighbors(G, from.id, T.frontRange)) {
        if (nb.owner === f.id) continue;
        if (opts.filter && !opts.filter(nb)) continue;
        if (!Diplo.canAttack(G, f.id, nb.owner)) continue;
        // 新手保护（与旧版一致）：别在第 3 年前后就把玩家按死
        if (nb.owner === G.player.factionId && turn < 36) continue;
        if (nb.grantedTo === PLAYER_HERO_ID && turn < 54) continue;
        if (nb.grantedTo === PLAYER_HERO_ID && Diplo.hasPact(G, f.id)) continue;
        if (pendingTargets.has(nb.id)) continue;
        if (avoid[nb.id] && turn < avoid[nb.id]) continue;

        const ratio = spare / Math.max(1, garrison(from));
        const troops = Army.previewDispatch(from, ratio);
        const size = troopTotal(troops);
        if (size < T.minArmy) continue;

        const drill = State.bld(from, 'drill');
        const pred = Combat.predict(G, troops, from.governor, nb, f.id, drill);
        const atk = Combat.attackScore(G, troops, from.governor, from.terrain, f.id, drill);
        const def = Combat.defenseScore(G, nb);
        targets.push({
          from: from.id, to: nb.id,
          troops, size,
          edge: atk / Math.max(1, def),      // >1 表示我方战力占优
          pred,
          dist: U.dist(from.x, from.y, nb.x, nb.y),
          owner: nb.owner,
        });
      }
    }
    // 排序要跟「实际能不能打赢」一致：先按预测结果（赢 & 剩兵多），再按战力比与距离。
    // 旧版按 edge 排序、再拿 pred 过滤，会把前面一堆打不下来的目标排在最前，结果一个月一路都出不去。
    const score = t => (t.pred.win ? t.pred.remain / Math.max(1, t.size) : -1);
    targets.sort((a, b) => (score(b) - score(a)) || (b.edge - a.edge) || (a.dist - b.dist));

    return {
      turn, faction: f, cities, exclude,
      atWar: wars.length > 0, wars,
      threatened, incoming,
      isFront, garrison, reserveOf, spareOf,
      totalTroops, totalCap, spareTotal, outgoing,
      targets,
      // 战线数随摊子大小扩张，但设上限：摊得越大越该多路推进，而不是一城一路全上
      maxRoutes: wars.length
        ? Math.min(T.maxRoutesWar, Math.max(2, Math.ceil(cities.length / 2)))
        : T.maxRoutesPeace,
      budget: Math.max(0, Math.round(totalTroops * T.commitRatio) - AI._committedTroops(G, f)),
    };
  },

  /** 本回合已投入进攻的兵力（含军区，避免 AI 与军区两边抢兵） */
  _committedTroops(G, f) {
    let n = 0;
    for (const a of Object.values(G.armies)) {
      if (a.factionId !== f.id || a.mission !== 'attack') continue;
      if (a.createdTurn !== G.meta.turn) continue;
      n += troopTotal(a.troops);
    }
    return n;
  },

  /** 结算上一轮进攻：部队没了而目标仍在敌手 → 冷落该目标几个月（别再送） */
  _settleOffense(G, f) {
    const list = f._offense || [];
    if (!list.length) { f._offense = []; return; }
    f._avoid = f._avoid || {};
    const keep = [];
    for (const rec of list) {
      if (G.armies[rec.armyId]) { keep.push(rec); continue; }   // 还在路上
      const city = G.cities[rec.cityId];
      if (city && city.owner !== f.id) {
        f._avoid[rec.cityId] = Math.max(f._avoid[rec.cityId] || 0, G.meta.turn + AI.TUNE.avoidMonths);
      }
    }
    f._offense = keep;
  },

  /** 决策可观测：G.meta.aiTrace 打开时，把每月每势力的判断理由留痕 */
  _trace(G, plan) {
    if (!G.meta.aiTrace) return;
    const f = plan.faction;
    const tgt = plan.targets[0];
    const nm = id => (G.cities[id] ? G.cities[id].name : id);
    (G.aiTrace = G.aiTrace || []).push({
      turn: G.meta.turn, fid: f.id,
      atWar: plan.atWar, wars: plan.wars.length,
      threatened: plan.threatened.map(t => `${nm(t.cityId)}(${t.eta}月/${U.num(t.troops)})`),
      spareTotal: Math.round(plan.spareTotal), budget: Math.round(plan.budget),
      routes: plan.outgoing,
      best: tgt
        ? `${nm(tgt.from)}→${nm(tgt.to)} 胜${Math.round((1 - tgt.pred.atkLossPct) * 100)}%`
        : '无',
      posture: plan.threatened.length ? 'defend' : (plan.targets.length ? 'attack' : 'mass'),
    });
    if (G.aiTrace.length > 400) G.aiTrace.splice(0, G.aiTrace.length - 400);
  },

  // ─────── 兼容旧入口（军区 legion.js 传 filter / force） ───────
  _mass(G, f, cities, stamp, exclude, filter, force) {
    const plan = AI.assess(G, f, cities, { exclude, filter });
    AIWar.mass(G, f, plan, stamp, { force });
  },

  _attack(G, f, cities, stamp, exclude, filter, force) {
    const plan = AI.assess(G, f, cities, { exclude, filter });
    AIWar.attack(G, f, plan, stamp, { force });
  },
};
