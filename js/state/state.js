// 状态层：构造初始局面 + 只读查询。
// 所有写操作走 Store.dispatch(command) → reducer，不在这里改状态。

const PLAYER_HERO_ID = 'PLAYER';

/** 名望档位（顶栏与事件选项的「以名望服人」共用） */
function repTitle(v) {
  if (v >= 280) return '天下归心';
  if (v >= 150) return '海内知名';
  if (v >= 60) return '一方名士';
  return '无名之辈';
}

/** 纪事上限：存 500 条，界面只画最近 400 条（多了 DOM 太重） */
const LOG_MAX = 500;
const LOG_VIEW = 400;

/** 旧档补齐用的默认值表：新增状态字段只改这里 */
const META_DEFAULTS = { rngState: null, uidSeq: null };
const PLAYER_DEFAULTS = {
  favor: 60, mission: null, missionCooldown: 0, domActionTurn: 0, route: 'loyal',
  talent: null, pacts: [], diploCooldown: {}, usurp: 0, legions: [], beseech: null,
};
const FACTION_DEFAULTS = {};
const CITY_DEFAULTS = {
  mat: 100, iron: 40, food: 0, gold: 0,
  order: 70, morale: 70, unrest: 0,
  policy: null, rallyTo: null, rallyRatio: 0.5, rallyFill: 1.2,
  clanActionTurn: 0, buildQueue: [], promoteTurn: 0,
};
/** 人情账新字段（docs/HERO.md §1.2）。ambition 由公式算，这里只是兜底值 */
const HERO_DEFAULTS = {
  ambition: 40, bond: 0, grievance: 0, idle: 0, lastAct: 0, warnTurn: 0, cd: {},
  visits: {},                 // 定向登用：{ visit/gift/beseech: 上次回合, fails: 连败次数 }
};

const State = {

  // ───────── 构造 ─────────
  create(opts) {
    const sc = getScenario(opts.scenarioId);
    const seed = opts.seed || Date.now();
    RNG.seed(seed);

    const G = {
      meta: {
        scenarioId: sc.id,
        scenarioName: sc.name,
        seed,
        turn: 1,
        year: sc.year,
        month: sc.month,
        startedAt: Date.now(),
      },
      player: {
        heroId: PLAYER_HERO_ID,
        name: opts.playerName || '无名',
        factionId: opts.factionId,
        rank: 1,
        merit: 0,
        reputation: 0,
        loyalty: 80,
        route: 'loyal',
        favor: 62,
        talent: opts.talent || null,
        mission: null,
        missionCooldown: 0,
        domActionTurn: 0,
        demesne: [],
        homeCityId: opts.cityId,
        diploCooldown: {},
        pacts: [],
        usurp: 0,
        legions: [],
      },
      factions: {},
      cities: {},
      heroes: {},
      armies: {},
      diplo: {},
      log: [],
      stats: { won: 0, lost: 0, citiesTaken: 0, citiesLost: 0, battles: 0 },
      over: null,
    };

    // 势力
    for (const [id, name, color, rulerId, aggression, cityIds] of sc.factionRows) {
      G.factions[id] = {
        id, name, color, rulerId, aggression,
        kind: 'npc',
        treasury: 800 + cityIds.length * 120,
        tech: { rp: 0, done: {}, current: null },
        bonus: null,
      };
    }
    G.factions.free = {
      id: 'free', name: '在野', color: FREE_FACTION.color, rulerId: null,
      aggression: 0, kind: 'free', treasury: 0,
      tech: { rp: 0, done: {}, current: null }, bonus: null,
    };

    // 城池
    let cityIdx = 0;
    for (const [id, name, x, y, terrain, region, pop, farm, market, wall] of sc.cityRows) {
      const garr = State._initGarrison(pop, terrain);
      const buildings = {
        farm, market, wall,
        lumber: 1,
        quarry: 0,
        ironworks: 0,
        stable: (terrain === 'marsh' || terrain === 'mountain') ? 0 : 1,
        barracks: 1,
        drill: 0,
        office: 1,
        academy: 0,
        granary: 1,
        clinic: 0,
        beacon: 0,
        shipyard: 0,
        customs: 0,
      };
      const c = {
        id, name, x, y, terrain, region,
        pop, basePop: pop,
        buildings,
        farm, market, wall,   // 镜像字段
        wallMax: wall,
        owner: 'free',
        grantedTo: null,
        governor: null,
        food: 600 + farm * 130,
        gold: 320 + market * 90,
        mat: 120 + farm * 40,
        iron: 40 + market * 12,
        order: 55,
        morale: 50,
        garrison: garr,
        buildQueue: [],
        policy: null,
        rallyTo: null,
        rallyRatio: 0.5,
        rallyFill: 1.2,
        clanActionTurn: 0,
        clans: State._initClans(cityIdx++),
      };
      State.syncDerived(c);
      G.cities[id] = c;
    }

    // 势力领土归属
    for (const [id, , , , , cityIds] of sc.factionRows) {
      for (const cid of cityIds) {
        if (G.cities[cid]) G.cities[cid].owner = id;
      }
    }

    // 武将
    for (const [id, name, wu, tong, zhi, zheng, mei, skill, fid] of sc.heroRows) {
      G.heroes[id] = {
        id, name, wu, tong, zhi, zheng, mei, skill,
        factionId: fid,
        cityId: null,
        loyalty: fid === 'free' ? 0 : RNG.between(60, 95),
        ambition: State._ambitionOf({ id, wu, tong, zhi, zheng, mei }, RNG.between(-8, 8)),
        bond: fid === 'free' ? 0 : (fid === opts.factionId ? 30 : 5),
        grievance: 0,
        idle: 0,
        lastAct: 0,
        warnTurn: 0,
        cd: {},
        alive: true,
      };
    }

    // 玩家武将化
    G.heroes[PLAYER_HERO_ID] = {
      id: PLAYER_HERO_ID,
      name: G.player.name,
      wu: 62, tong: 64, zhi: 66, zheng: 60, mei: 62,
      skill: '',
      factionId: G.player.factionId,
      cityId: opts.cityId,
      loyalty: 100,
      ambition: State._ambitionOf({ zhi: 66, wu: 62, mei: 62 }, 0),
      bond: 100,
      grievance: 0,
      idle: 0,
      lastAct: 0,
      warnTurn: 0,
      cd: {},
      alive: true,
    };

    // 分配武将驻城
    for (const fid of Object.keys(G.factions)) {
      if (fid === 'free') continue;
      const hs = Object.values(G.heroes).filter(h => h.factionId === fid);
      const cs = Object.values(G.cities).filter(c => c.owner === fid);
      if (!cs.length) continue;
      hs.forEach((h, i) => {
        const c = cs[i % cs.length];
        h.cityId = c.id;
        const cur = c.governor ? G.heroes[c.governor] : null;
        if (!cur || h.tong > cur.tong) c.governor = h.id;
      });
    }

    // 玩家：接管起始城，守备补到兵额六成
    const startCity = G.cities[opts.cityId];
    startCity.owner = opts.factionId;
    startCity.grantedTo = PLAYER_HERO_ID;
    startCity.governor = PLAYER_HERO_ID;
    G.player.demesne = [opts.cityId];
    G.player.homeCityId = opts.cityId;

    TechSys.refresh(G);
    Diplo.init(G);

    const startCap = Math.round(State.troopCapOf(G, startCity) * 0.60);
    const curTroops = troopTotal(startCity.garrison);
    if (curTroops < startCap) {
      const add = startCap - curTroops;
      startCity.garrison.inf += Math.round(add * 0.62);
      startCity.garrison.arc += Math.round(add * 0.26);
      startCity.garrison.cav += Math.round(add * 0.12);
    }

    State.log(G, 'turn',
      `【${G.meta.year}年${G.meta.month}月】${G.factions[G.player.factionId].name} · ${startCity.name}城主 ${G.player.name}，开局。`);

    // 构造过程本身消耗了随机数，游标按构造结束时的位置记档
    G.meta.rngState = RNG.getState();
    G.meta.uidSeq = U._n || 0;
    return G;
  },

  _initClans(idx) {
    const n = RNG.between(2, 3);
    const out = [];
    const start = (Math.abs(idx) * 7) % CLAN_NAMES.length;
    for (let i = 0; i < n; i++) {
      const name = CLAN_NAMES[(start + i * 13) % CLAN_NAMES.length];
      out.push({
        name,
        sat: RNG.between(44, 72),
        inf: RNG.between(22, 62),
        mood: 0,
      });
    }
    return out;
  },

  _initGarrison(pop, terrain) {
    let base = U.clamp(pop * 3.2, 600, 2400);
    if (terrain === 'mountain' || terrain === 'desert') base *= 1.15;
    base = Math.round(base);
    return {
      inf: Math.round(base * 0.58),
      cav: Math.round(base * 0.15),
      arc: Math.round(base * 0.27),
      nvy: 0,
      siege: 0,
    };
  },

  // ───────── 建筑 ─────────
  bld(c, key) {
    return (c && c.buildings && c.buildings[key]) || 0;
  },

  /** 把 buildings 同步到镜像字段（farm/market/wall 供旧代码直接读取） */
  syncDerived(c) {
    if (!c.buildings) {
      c.buildings = { farm: c.farm || 1, market: c.market || 1, wall: c.wall || 1 };
    }
    c.farm = State.bld(c, 'farm') || 1;
    c.market = State.bld(c, 'market') || 1;
    c.wallMax = State.bld(c, 'wall') || 1;
    if (c.wall == null || c.wall > c.wallMax) c.wall = c.wallMax;
    if (c.basePop == null) c.basePop = c.pop;
    if (!Array.isArray(c.buildQueue)) c.buildQueue = [];
    if (!Array.isArray(c.clans)) c.clans = [];
    if (c.policy === undefined) c.policy = null;
    if (c.unrest == null) c.unrest = 0;
    if (c.rallyTo === undefined) c.rallyTo = null;
    if (c.rallyRatio == null) c.rallyRatio = 0.5;
    if (c.rallyFill == null) c.rallyFill = 1.2;
  },

  /** 建筑槽位：府衙 3 级起可并行 2 个工程 */
  buildSlots(c) {
    return State.bld(c, 'office') >= 3 ? 2 : 1;
  },

  wallMaxOf(c) { return State.bld(c, 'wall') || 1; },

  popMaxOf(G, c) {
    const b = G.factions[c.owner] && G.factions[c.owner].bonus;
    const techPop = b ? b.pop : 1;
    const office = 1 + State.bld(c, 'office') * 0.06;
    const quarry = Math.max(0.6, 1 - State.bld(c, 'quarry') * 0.02);
    return Math.round((c.basePop || c.pop) * 1.45 * office * quarry * techPop);
  },

  foodCapOf(G, c) {
    const b = G.factions[c.owner] && G.factions[c.owner].bonus;
    const techG = b ? b.granary : 1;
    const tal = c.grantedTo === PLAYER_HERO_ID ? talentOf(G) : {};
    return Math.round((800 + State.bld(c, 'farm') * 400 + State.bld(c, 'granary') * 250)
      * techG * (tal.granary || 1));
  },

  /** 士族平均满意度（0-100） */
  clanSat(c) {
    if (!c.clans || !c.clans.length) return 55;
    let s = 0;
    for (const cl of c.clans) s += cl.sat;
    return s / c.clans.length;
  },

  /** 士族对钱粮的乘数 */
  clanEconMul(c) {
    return 0.72 + State.clanSat(c) / 180;   // 55 → 1.03，100 → 1.28
  },

  /** 士族对兵额/战力的乘数 */
  clanMilMul(c) {
    return 0.85 + State.clanSat(c) / 300;   // 55 → 1.03，100 → 1.18
  },

  // ───────── 兵额 ─────────
  /** 兵额上限的完整拆解（UI 与校验共用同一份推导，避免两套公式打架） */
  troopCapBreakdown(G, c) {
    const f = G.factions[c.owner];
    const b = f && f.bonus;
    const farm = State.bld(c, 'farm');
    const hukou = State.popMaxOf(G, c);          // 户籍基数（民力），不受征兵影响
    const popBase = hukou * (1.9 + farm * 0.9);
    const orderMul = 0.6 + c.order / 150;
    const barracksMul = 1 + State.bld(c, 'barracks') * 0.08;
    const drillMul = 1 + State.bld(c, 'drill') * 0.01;
    const clanMul = State.clanMilMul(c);
    const techMul = b ? b.troopCap : 1;
    const momentumMul = State.momentum(G, c.owner);
    const total = Math.round(popBase * orderMul * barracksMul * drillMul * clanMul * techMul * momentumMul);
    return {
      farm,
      pop: c.pop,
      hukou,
      order: c.order,
      popBase, orderMul, barracksMul, drillMul, clanMul, techMul, momentumMul,
      barracks: State.bld(c, 'barracks'),
      drill: State.bld(c, 'drill'),
      clanSat: State.clanSat(c),
      total,
    };
  },

  /** 兵额上限（总兵力） */
  troopCapOf(G, c) {
    return State.troopCapBreakdown(G, c).total;
  },

  /** 兵种兵额：骑兵受马场限，水军受船坞限，器械受冶铁限 */
  troopCapByType(G, c) {
    const total = State.troopCapOf(G, c);
    const stable = State.bld(c, 'stable');
    const shipyard = State.bld(c, 'shipyard');
    const iron = State.bld(c, 'ironworks');
    const tal = c.grantedTo === PLAYER_HERO_ID ? talentOf(G) : {};
    return {
      inf: Math.round(total * 0.62),
      arc: Math.round(total * 0.26),
      cav: stable > 0 ? Math.round(total * 0.15 * (1 + stable * 0.12) * (tal.cav || 1)) : 0,
      nvy: shipyard > 0 ? Math.round(total * 0.20 * (1 + shipyard * 0.15)) : 0,
      siege: Math.round(total * 0.08 * (1 + iron * 0.10)),
    };
  },

  // ───────── 查询 ─────────
  city(G, id) { return G.cities[id]; },
  hero(G, id) { return G.heroes[id]; },
  faction(G, id) { return G.factions[id]; },
  isPlayerCity(G, c) { return !!c && c.grantedTo === PLAYER_HERO_ID; },

  // ───────── 军区（一将统辖多城，全托管但听玩家号令） ─────────
  legions(G) { return G.player.legions || (G.player.legions = []); },

  /** 城不再直辖（交出 / 削权 / 失守）：一并从军区辖城摘掉，否则军区还当它是自己的 */
  dropLegionCity(G, cityId) {
    for (const lg of State.legions(G)) {
      const i = (lg.cityIds || []).indexOf(cityId);
      if (i >= 0) lg.cityIds.splice(i, 1);
    }
  },

  legionOf(G, cityId) {
    for (const lg of State.legions(G)) {
      if (lg.cityIds && lg.cityIds.indexOf(cityId) >= 0) return lg;
    }
    return null;
  },

  /** 军区里的城（顺带滤掉已不再直辖的） */
  legionCities(G, lg) {
    return (lg.cityIds || []).map(id => G.cities[id]).filter(c => c && c.grantedTo === PLAYER_HERO_ID);
  },

  /** 都督加成：统率 → 守城战力，政略 → 产出。同一城只吃一个军区 */
  legionMul(G, c) {
    const lg = State.legionOf(G, c.id);
    if (!lg) return null;
    const h = G.heroes[lg.heroId];
    if (!h || !h.alive) return null;
    return { atk: 1 + h.tong / 400, eco: 1 + h.zheng / 500, hero: h };
  },

  demesne(G) {
    return G.player.demesne.map(id => G.cities[id]).filter(Boolean);
  },

  factionCities(G, fid) {
    return Object.values(G.cities).filter(c => c.owner === fid);
  },

  factionTroops(G, fid) {
    let t = 0;
    for (const c of State.factionCities(G, fid)) t += troopTotal(c.garrison);
    for (const a of Object.values(G.armies)) if (a.factionId === fid) t += troopTotal(a.troops);
    return t;
  },

  playerFood(G) {
    return Math.round(State.demesne(G).reduce((s, c) => s + c.food, 0));
  },
  playerGold(G) {
    return Math.round(State.demesne(G).reduce((s, c) => s + c.gold, 0));
  },
  playerMat(G) {
    return Math.round(State.demesne(G).reduce((s, c) => s + c.mat, 0));
  },
  playerIron(G) {
    return Math.round(State.demesne(G).reduce((s, c) => s + c.iron, 0));
  },
  playerTroops(G) {
    let t = 0;
    for (const c of State.demesne(G)) t += troopTotal(c.garrison);
    for (const a of Object.values(G.armies)) if (a.factionId === G.player.factionId) t += troopTotal(a.troops);
    return t;
  },

  playerRP(G) {
    const f = G.factions[G.player.factionId];
    return f ? Math.floor(f.tech.rp) : 0;
  },

  /** 势力月度科研产出（与研发推进口径一致） */
  playerRPIncome(G) {
    return TechSys.rate(G, G.player.factionId);
  },

  /** 各势力的治所（人口 + 城墙加权最高者）—— 规则层与视图层共用这一份口径 */
  capitals(G) {
    const best = {};
    for (const c of Object.values(G.cities)) {
      if (!c.owner || c.owner === 'free') continue;
      const w = c.pop + c.wall * 60;
      if (!best[c.owner] || w > best[c.owner].w) best[c.owner] = { w, id: c.id };
    }
    return new Set(Object.values(best).map(b => b.id));
  },

  /** 城池档次：2 都城（势力治所）/ 1 郡城 / 0 县城 —— 名望与渲染共用 */
  cityLevel(G, c, capitals) {
    const caps = capitals || State.capitals(G);
    if (caps.has(c.id)) return 2;
    if ((c.wallMax || 1) >= 3 || c.pop >= 140) return 1;
    return 0;
  },

  neighbors(G, cityId, maxDist = 230) {
    const c = G.cities[cityId];
    if (!c) return [];
    return Object.values(G.cities)
      .filter(o => o.id !== cityId && U.dist(c.x, c.y, o.x, o.y) <= maxDist)
      .sort((a, b) => U.dist(c.x, c.y, a.x, a.y) - U.dist(c.x, c.y, b.x, b.y));
  },

  isRiverCity(G, c) {
    if (c.terrain === 'marsh') return true;
    return Object.values(G.cities).some(o =>
      o.id !== c.id && o.terrain === 'marsh' && U.dist(c.x, c.y, o.x, o.y) < 200);
  },

  momentum(G, fid) {
    const total = Object.keys(G.cities).length || 1;
    const share = State.factionCities(G, fid).length / total;
    return 1 + Math.max(0, share - 0.15) * 1.1;
  },

  log(G, kind, text, data) {
    const e = { turn: G.meta.turn, year: G.meta.year, month: G.meta.month, kind, text };
    if (data) e.data = data;   // 结构化附带信息（如战报详情），视图层可选消费
    G.log.push(e);
    if (G.log.length > LOG_MAX) G.log.splice(0, G.log.length - LOG_MAX);
  },

  // ───────── 旧存档迁移 ─────────
  /** 新增状态字段时只需往这三张表加一行；迁移无需再手写 if */
  migrate(G, fromVersion) {
    if (!G || !G.cities) return G;

    for (const c of Object.values(G.cities)) {
      if (!c.buildings) {
        c.buildings = {
          farm: c.farm || 1,
          market: c.market || 1,
          wall: Math.max(1, Math.round(c.wallMax || c.wall || 1)),
          lumber: 1, quarry: 0, ironworks: 0,
          stable: (c.terrain === 'marsh' || c.terrain === 'mountain') ? 0 : 1,
          barracks: 1, drill: 0, office: 1, academy: 0,
          granary: 1, clinic: 0, beacon: 0, shipyard: 0, customs: 0,
        };
      }
      delete c.foodCap;                        // 已废弃：粮上限改为函数现算
      if (c.popMax != null && c.basePop == null) c.basePop = c.pop;
      State._fillDefaults(c, CITY_DEFAULTS);
      if (!c.clans || !c.clans.length) c.clans = State._initClans(0);
      State.syncDerived(c);
    }

    for (const f of Object.values(G.factions)) {
      if (!f.tech) f.tech = { rp: 0, done: {}, current: null, queue: [] };
      if (!Array.isArray(f.tech.queue)) f.tech.queue = [];
      State._fillDefaults(f, FACTION_DEFAULTS);
    }

    // 武将：旧档没有 ambition 时按同一公式补（用 id 哈希代替 RNG，保证同档多次迁移一致）
    for (const h of Object.values(G.heroes || {})) {
      if (h.ambition == null) h.ambition = State._ambitionOf(h, State._idJitter(h.id));
      State._fillDefaults(h, HERO_DEFAULTS);
    }

    State._fillDefaults(G.player, PLAYER_DEFAULTS);
    State._fillDefaults(G.meta, META_DEFAULTS);

    if (!G.diplo) Diplo.init(G);
    Diplo.ensure(G);
    TechSys.refresh(G);
    return G;
  },

  /** 野心：智勇高、人缘差的将更有野心（docs/HERO.md §1.2） */
  _ambitionOf(h, jitter) {
    const raw = (h.zhi || 0) * 0.45 + (h.wu || 0) * 0.35 - (h.mei || 0) * 0.30 + (jitter || 0);
    return U.clamp(Math.round(raw), 5, 95);
  },

  /** 由 id 得到稳定的 [-8, 8] 抖动：旧档迁移不能依赖已被消耗的 RNG 状态 */
  _idJitter(id) {
    const s = String(id || '');
    let x = 0;
    for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) % 997;
    return (x % 17) - 8;
  },

  /** 只补 null / undefined，不覆盖已有值（含 false、0） */
  _fillDefaults(obj, defaults) {
    for (const k in defaults) {
      if (obj[k] == null) obj[k] = typeof defaults[k] === 'object' ? U.clone(defaults[k]) : defaults[k];
    }
  },

  // ───────── 胜负判定 ─────────
  checkEnd(G) {
    if (G.over) return G.over;

    const total = Object.keys(G.cities).length;
    const myFid = G.player.factionId;

    const myCities = State.factionCities(G, myFid);
    const myArmies = Object.values(G.armies).filter(a => a.factionId === myFid);
    if (myCities.length === 0 && myArmies.length === 0) {
      G.over = { result: 'lose', text: '你失去了所有城池，势力覆灭。乱世不留无名之辈。' };
      State.log(G, 'bad', '【败】城池尽失，势力覆亡。');
      return G.over;
    }

    if (myCities.length === total) {
      G.over = {
        result: 'win',
        text: `${G.factions[myFid].name}一统天下。${G.player.name}以${rankOf(G.player.rank).name}之身，位列开国元勋。`,
      };
      State.log(G, 'good', '【胜】天下一统。');
      return G.over;
    }

    return null;
  },
};
