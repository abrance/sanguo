// 规则型 AI：征税 → 营造 → 征兵 → 集结 → 多路出兵
const AI = {

  /** 按侵略性决定营造优先级 */
  _buildOrder(f) {
    if (f.aggression > 0.55) return ['barracks', 'farm', 'drill', 'stable', 'wall', 'ironworks', 'academy', 'office'];
    if (f.aggression > 0.35) return ['farm', 'market', 'barracks', 'wall', 'office', 'academy', 'drill', 'granary'];
    return ['farm', 'market', 'academy', 'office', 'granary', 'wall', 'barracks', 'customs'];
  },

  run(G, stamp) {
    for (const f of Object.values(G.factions)) {
      if (f.kind === 'free') continue;
      if (f.dead) continue;

      f.momentum = State.momentum(G, f.id);

      if (f.id === G.player.factionId) {
        AI._support(G, f, stamp);
        continue;
      }

      const cities = State.factionCities(G, f.id);
      if (!cities.length) continue;

      AI._tax(G, f, cities);
      AI._build(G, f, cities);
      AI._recruit(G, f, cities, stamp);
      AI._mass(G, f, cities, stamp);
      AI._attack(G, f, cities, stamp);
    }
  },

  /**
   * 玩家所属势力：与 AI 势力同样发展扩张（否则全图只有你这家长不大），
   * 但玩家直辖的城池不参与，避免把玩家自己的兵调走。
   */
  _support(G, f, stamp) {
    const all = State.factionCities(G, f.id);
    const mine = new Set(State.demesne(G).map(c => c.id));
    const managed = all.filter(c => !mine.has(c.id));
    if (!managed.length) return;

    AI._tax(G, f, managed);
    AI._build(G, f, managed);
    AI._recruit(G, f, managed, stamp);
    AI._mass(G, f, managed, stamp, mine);
    AI._attack(G, f, managed, stamp, mine);
  },

  _tax(G, f, cities) {
    for (const c of cities) {
      const up = c.gold * 0.12;
      c.gold -= up;
      f.treasury += up;
    }
    f.treasury = Math.min(f.treasury, cities.length * 1100);
  },

  /** 营造：按优先级挑一个能负担的项目，府库不足时补贴 */
  _build(G, f, cities) {
    const order = AI._buildOrder(f);
    for (const c of cities) {
      if (!Build.queueFree(c)) continue;
      if (c.mat < 40 && c.iron < 10) continue;

      for (const key of order) {
        const chk = Build.reqCheck(G, c, key);
        if (!chk.ok) continue;
        const cost = Build.costOf(G, c, key);

        // 府库补贴（只补钱，建材铁料靠本地）
        if (c.gold < cost.gold) {
          const take = Math.min(f.treasury, cost.gold - c.gold);
          c.gold += take;
          f.treasury -= take;
        }
        if (c.gold < cost.gold || c.mat < cost.mat || c.iron < cost.iron) continue;

        try { Build.start(G, c, key, true); } catch (e) { }
        break;
      }
    }
  },

  _recruit(G, f, cities, stamp) {
    const ratio = 0.45 + f.aggression * 0.30;
    for (const c of cities) {
      const cap = State.troopCapOf(G, c);
      const cur = troopTotal(c.garrison);
      const target = cap * ratio;
      if (cur >= target * 0.97) continue;
      const want = Math.min(Math.round(target - cur), Math.round(c.pop * 1.6));
      if (want < 20) continue;

      // 府库补贴
      const before = c.gold;
      const added = Recruit.autoFill(G, c, want, true);
      if (added > 0) {
        const spent = before - c.gold;
        // 若本次把城库花光，府库回补一部分
        if (c.gold < 60) {
          const take = Math.min(f.treasury, 120);
          c.gold += take;
          f.treasury -= take;
        }
      }
    }
  },

  /** 集中兵力：向好打的前线城市输送，形成局部优势 */
  _mass(G, f, cities, stamp, exclude, filter) {
    if (cities.length < 2) return;
    if (!RNG.chance(0.16 + f.aggression * 0.20 + (f.momentum - 1) * 0.35)) return;

    let best = null;
    for (const c of cities) {
      const plan = Army.previewDispatch(c, 0.70);
      if (troopTotal(plan) < 150) continue;
      for (const nb of State.neighbors(G, c.id, 235)) {
        if (nb.owner === f.id) continue;
        if (filter && !filter(nb)) continue;
        const edge = Combat.attackScore(G, plan, c.governor, c.terrain) - Combat.defenseScore(G, nb);
        if (!best || edge > best.edge) best = { edge, staging: c, target: nb };
      }
    }
    if (!best) return;
    const staging = best.staging;

    // 集结上限：堆到兵额 1.6 倍就打住，否则一城养不起（会成片断粮）
    const stagingCap = State.troopCapOf(G, staging);
    let inbound = 0;
    for (const a of Object.values(G.armies)) {
      if (a.to === staging.id && a.factionId === f.id) inbound += troopTotal(a.troops);
    }
    if (troopTotal(staging.garrison) + inbound > stagingCap * 1.15) return;

    const donors = cities
      .filter(c => c.id !== staging.id)
      .filter(c => !exclude || !exclude.has(c.id))
      .filter(c => U.dist(c.x, c.y, staging.x, staging.y) <= 460)
      .map(c => ({ c, t: troopTotal(c.garrison) - State.troopCapOf(G, c) * 0.35 }))
      .filter(o => o.t > 120)
      .sort((a, b) => b.t - a.t)
      .slice(0, 3);

    for (const { c: src } of donors) {
      const troops = Army.takeFromGarrison(src.garrison, 0.60);
      if (troopTotal(troops) < 100) {
        for (const k of TROOP_KEYS) src.garrison[k] += troops[k] || 0;
        continue;
      }
      Army.create(G, {
        factionId: f.id, heroId: null, from: src.id, to: staging.id,
        troops, mission: 'reinforce',
      });
    }
  },

  _attack(G, f, cities, stamp, exclude, filter) {
    const maxArmies = Math.max(1, Math.ceil(cities.length / 2));
    let outgoing = Object.values(G.armies).filter(a => a.factionId === f.id).length;
    if (outgoing >= maxArmies) return;

    const chances = (outgoing === 0 ? 0.10 + f.aggression * 0.30 : 0.04 + f.aggression * 0.15)
      + (f.momentum - 1) * 0.25;
    if (!RNG.chance(chances)) return;

    const sources = cities
      .map(c => ({ c, score: Combat.attackScore(G, c.garrison, c.governor, c.terrain) }))
      .sort((a, b) => b.score - a.score);

    for (const { c: from } of sources) {
      if (outgoing >= maxArmies) break;
      if (exclude && exclude.has(from.id)) continue;
      if (troopTotal(from.garrison) < 180) continue;

      const plan = Army.previewDispatch(from, 0.80);
      if (troopTotal(plan) < 120) continue;

      const overstacked = troopTotal(from.garrison) > State.troopCapOf(G, from) * 1.25;

      let picked = null;
      for (const nb of State.neighbors(G, from.id, 235)) {
        if (nb.owner === f.id) continue;
        if (filter && !filter(nb)) continue;
        if (!Diplo.canAttack(G, f.id, nb.owner)) continue;
        if (nb.grantedTo === PLAYER_HERO_ID && Diplo.hasPact(G, f.id)) continue;
        if (nb.owner === G.player.factionId && G.meta.turn < 36) continue;
        if (nb.grantedTo === PLAYER_HERO_ID && G.meta.turn < 54) continue;

        const pred = Combat.predict(G, plan, from.governor, nb, f.id, State.bld(from, 'drill'));
        if (!pred.win && !overstacked) continue;
        if (pred.remain < troopTotal(plan) * (overstacked ? 0.15 : 0.45)) continue;

        const d = U.dist(from.x, from.y, nb.x, nb.y);
        if (!picked || d < picked.d) picked = { nb, d };
      }
      if (!picked) continue;

      const troops = Army.takeFromGarrison(from.garrison, 0.80);
      let heroId = from.governor;
      if (!heroId || !G.heroes[heroId]) {
        const cand = Object.values(G.heroes).find(h => h.factionId === f.id && h.cityId === from.id);
        heroId = cand ? cand.id : null;
      }

      const a = Army.create(G, {
        factionId: f.id, heroId, from: from.id, to: picked.nb.id,
        troops, mission: 'attack',
      });
      outgoing++;

      if (picked.nb.owner === G.player.factionId || picked.nb.grantedTo === PLAYER_HERO_ID) {
        State.log(G, 'bad',
          `${f.name}${heroId && G.heroes[heroId] ? G.heroes[heroId].name : '兵马'}自${from.name}发兵${U.num(troopTotal(troops))}，直指${picked.nb.name}！约${a.eta}月可至。`);
      }
    }
  },
};
