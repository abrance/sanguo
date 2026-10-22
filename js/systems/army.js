// 行军系统：创建、推进、抵达结算
const Army = {

  /** 军队速度（像素/月）：取最慢兵种 */
  speedOf(troops) {
    let min = Infinity;
    for (const k of TROOP_KEYS) {
      if ((troops[k] || 0) > 0) min = Math.min(min, TROOPS[k].speed);
    }
    if (!isFinite(min)) min = 1;
    return ARMY_SPEED_BASE * min;
  },

  /** 预计行军月数 */
  estimateEta(fromCity, toCity, troops) {
    const d = U.dist(fromCity.x, fromCity.y, toCity.x, toCity.y);
    return Math.max(1, Math.ceil(d / Army.speedOf(troops)));
  },

  /** 创建一支军队 */
  create(G, { factionId, heroId, from, to, troops, mission }) {
    const fc = G.cities[from];
    const tc = G.cities[to];
    const eta = Army.estimateEta(fc, tc, troops);
    const id = U.uid('army');
    const a = {
      id, factionId, heroId,
      troops: { ...emptyTroops(), ...troops },
      from, to,
      x: fc.x, y: fc.y,
      eta, totalEta: eta,
      morale: 60,
      mission: mission || 'attack',
    };
    G.armies[id] = a;

    // 武将随军
    if (heroId && G.heroes[heroId]) {
      G.heroes[heroId].cityId = null;
    }
    return a;
  },

  /** 从驻军中按比例抽调 */
  takeFromGarrison(garrison, ratio) {
    const out = emptyTroops();
    for (const k of TROOP_KEYS) {
      const n = garrison[k] || 0;
      const take = Math.floor(n * ratio);
      out[k] = take;
      garrison[k] = n - take;
    }
    return out;
  },

  /** 预览：按比例抽调后的兵表（不改动驻军） */
  previewDispatch(city, ratio) {
    const out = emptyTroops();
    for (const k of TROOP_KEYS) out[k] = Math.floor((city.garrison[k] || 0) * ratio);
    return out;
  },

  /** 每回合推进 */
  advance(G, stamp) {
    const arrived = [];

    for (const a of Object.values(G.armies)) {
      a.eta -= 1;
      const prog = U.clamp(1 - a.eta / a.totalEta, 0, 1);
      const from = G.cities[a.from];
      const to = G.cities[a.to];
      if (from && to) {
        a.x = U.lerp(from.x, to.x, prog);
        a.y = U.lerp(from.y, to.y, prog);
      }
      a.morale = Math.max(20, a.morale - 1);

      if (a.eta <= 0) arrived.push(a);
    }

    for (const a of arrived) {
      Army.arrive(G, a, stamp);
    }
  },

  /** 抵达处理 */
  arrive(G, a, stamp) {
    const target = G.cities[a.to];
    if (!target) { delete G.armies[a.id]; return; }

    // 友军城：并入驻军
    if (target.owner === a.factionId) {
      for (const k of TROOP_KEYS) target.garrison[k] = (target.garrison[k] || 0) + (a.troops[k] || 0);
      if (a.heroId && G.heroes[a.heroId]) G.heroes[a.heroId].cityId = target.id;
      const h = G.heroes[a.heroId];
      // 守将择优
      const cur = target.governor ? G.heroes[target.governor] : null;
      if (a.heroId && (!cur || (h && h.tong > cur.tong))) target.governor = a.heroId;
      if (a.factionId === G.player.factionId)
        State.log(G, 'note', `${h ? h.name : '我军'}入${target.name}，合兵。`);
      delete G.armies[a.id];
      return;
    }

    // 敌军城：开战
    const rep = Combat.resolve(G, a, target, stamp);

    if (rep.captured) {
      Army._capture(G, a, target, rep, stamp);
      return;
    }

    // 未克：撤回出发地
    if (troopTotal(a.troops) <= 0) {
      if (a.heroId && G.heroes[a.heroId]) {
        // 武将在乱军中寻得生路，退回出发城
        const home = G.cities[a.from];
        G.heroes[a.heroId].cityId = home && home.owner === a.factionId ? home.id : null;
      }
      if (a.factionId === G.player.factionId)
        State.log(G, 'bad', `${G.heroes[a.heroId] ? G.heroes[a.heroId].name : '我军'}全军覆没于${target.name}城下。`);
      delete G.armies[a.id];
      return;
    }

    const home = G.cities[a.from];
    if (home && home.owner === a.factionId) {
      const d = U.dist(target.x, target.y, home.x, home.y);
      a.to = a.from;
      a.eta = Math.max(1, Math.ceil(d / Army.speedOf(a.troops)));
      a.totalEta = a.eta;
      a.mission = 'return';
    } else {
      delete G.armies[a.id];
      if (a.heroId && G.heroes[a.heroId]) G.heroes[a.heroId].cityId = null;
    }
  },

  /** 攻克城池 */
  _capture(G, a, city, rep, stamp) {
    const oldOwner = city.owner;
    const attackerFaction = a.factionId;

    // 守将或被俘、或逃
    if (city.governor && city.governor !== PLAYER_HERO_ID) {
      const gh = G.heroes[city.governor];
      if (gh) {
        if (RNG.chance(0.35)) {
          gh.alive = false;
          if (attackerFaction === G.player.factionId || oldOwner === G.player.factionId)
            State.log(G, 'bad', `${gh.name}战死${city.name}。`);
        } else {
          gh.cityId = null;
        }
      }
    }
    city.governor = null;

    // 易主
    city.owner = attackerFaction;
    city.grantedTo = null;
    city.order = U.clamp(city.order - 10, 5, 100);
    city.morale = 40;
    if (Array.isArray(city.clans)) {
      for (const cl of city.clans) cl.sat = U.clamp(cl.sat - 25, 0, 100);
      city.unrest = 3;   // 新附未安：士族离心期
    }

    // 攻方余部尽数入城驻守
    city.garrison = { ...emptyTroops(), ...a.troops };
    city.wall = Math.max(0.5, city.wall);

    // 武将入驻
    if (a.heroId && G.heroes[a.heroId]) {
      G.heroes[a.heroId].cityId = city.id;
      city.governor = a.heroId;
    }

    delete G.armies[a.id];

    // 玩家相关
    if (attackerFaction === G.player.factionId) {
      G.stats.citiesTaken++;
      G.player.merit += 25;
      G.player.reputation += 8;
      State.log(G, 'good', `我军克${city.name}。战功 +25，声望 +8。`);
      Rank.onCapture(G, city, stamp);
      Mission.onCapture(G, city.id);
    }

    if (oldOwner === G.player.factionId) {
      // 玩家势力丢城
      const idx = G.player.demesne.indexOf(city.id);
      if (idx >= 0) {
        G.player.demesne.splice(idx, 1);
        G.stats.citiesLost++;
        State.log(G, 'bad', `我军失守：${city.name}陷落！`);
      }
    }
  },
};
