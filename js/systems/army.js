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

  /** 预计行军月数（mul：速度倍率，玩家骑兵天赋用） */
  estimateEta(fromCity, toCity, troops, mul) {
    const d = U.dist(fromCity.x, fromCity.y, toCity.x, toCity.y);
    return Math.max(1, Math.ceil(d / (Army.speedOf(troops) * (mul || 1))));
  },

  /** 行军速度倍率：只对玩家势力的军队生效 */
  speedMul(G, factionId) {
    if (!G || !factionId || factionId !== G.player.factionId) return 1;
    return talentOf(G).speed || 1;
  },

  /** 建军初士气：基础 60 + 主将忠诚修正 + 玩家天赋（docs/HERO.md §1.5） */
  _initialMorale(G, factionId, heroId) {
    const h = heroId ? G.heroes[heroId] : null;
    const loy = h && h.loyalty != null ? h.loyalty : 70;
    const talent = factionId === G.player.factionId ? (talentOf(G).armyMorale || 0) : 0;
    return U.clamp(60 + (loy - 70) * 0.20 + talent, 20, 100);
  },

  /** 创建一支军队 */
  create(G, { factionId, heroId, from, to, troops, mission, delay }) {
    const fc = G.cities[from];
    const tc = G.cities[to];
    // 坐骑加速（只有主将有坐骑才算）
    const mount = heroId ? 1 + State.treasureEff(G, heroId, 'speed') : 1;
    const eta = Army.estimateEta(fc, tc, troops, Army.speedMul(G, factionId) * mount);
    const id = U.uid('army');
    const a = {
      id, factionId, heroId,
      troops: { ...emptyTroops(), ...troops },
      from, to,
      x: fc.x, y: fc.y,
      eta, totalEta: eta,
      morale: Army._initialMorale(G, factionId, heroId),
      createdTurn: G.meta.turn,
      // 延迟出发（月）：AI 会攻时用它把几路军的抵达月对齐，合并成一战
      delay: delay || 0,
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
      // 交战挂起（等玩家点「继续」或放战法）：原地不动，也不参与合攻合并
      if (a.battle) continue;
      // 待发：原地不动（会攻的同步抵达就靠它）
      if (a.delay > 0) { a.delay -= 1; continue; }
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

    // 会攻：同月抵达同一座敌城的同势力攻军先合成一路再打
    // （不合并的话，第一支先撞死，第二支抵达时城已属于我方 → 只是"合兵"，等于分头送）
    const groups = new Map();
    for (const a of arrived) {
      if (a.mission !== 'attack') continue;
      const t = G.cities[a.to];
      if (!t || t.owner === a.factionId) continue;
      const k = a.factionId + '|' + a.to;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(a);
    }
    for (const list of groups.values()) {
      if (list.length >= 2) Army._mergeAttack(G, list);
    }

    for (const a of arrived) {
      if (!G.armies[a.id]) continue;   // 已被合并掉
      Army.arrive(G, a, stamp);
    }
  },

  /** 合攻：多路并一路，主将由统率最高者担任，其余将回本城待命 */
  _mergeAttack(G, list) {
    const target = G.cities[list[0].to];
    const lead = list.slice().sort((a, b) => {
      const ta = a.heroId && G.heroes[a.heroId] ? G.heroes[a.heroId].tong : -1;
      const tb = b.heroId && G.heroes[b.heroId] ? G.heroes[b.heroId].tong : -1;
      return tb - ta;
    })[0];

    let extra = 0;
    for (const a of list) {
      if (a.id === lead.id) continue;
      for (const k of TROOP_KEYS) lead.troops[k] = (lead.troops[k] || 0) + (a.troops[k] || 0);
      extra += troopTotal(a.troops);
      if (a.heroId && G.heroes[a.heroId] && a.heroId !== lead.heroId) {
        const home = G.cities[a.from];
        G.heroes[a.heroId].cityId = home && home.owner === G.player.factionId ? home.id : null;
      }
      delete G.armies[a.id];
    }

    if (lead.factionId === G.player.factionId || target.grantedTo === PLAYER_HERO_ID) {
      const leadName = lead.heroId && G.heroes[lead.heroId] ? G.heroes[lead.heroId].name : '我军';
      State.log(G, 'note',
        `${list.length} 路合攻${target.name}，${leadName}统一指挥（合兵 ${U.num(extra)}）。`);
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

    // 盟友援军（mission: aid）：并入守军，不作战
    if (a.mission === 'aid') {
      for (const k of TROOP_KEYS) target.garrison[k] = (target.garrison[k] || 0) + (a.troops[k] || 0);
      if (a.heroId && G.heroes[a.heroId] && G.heroes[a.heroId].factionId !== target.owner) {
        const home = State.factionCities(G, a.factionId)[0];
        G.heroes[a.heroId].cityId = home ? home.id : null;
      }
      if (a.factionId === G.player.factionId || target.grantedTo === PLAYER_HERO_ID) {
        const af = G.factions[a.factionId];
        State.log(G, 'note', `${af ? af.name : '友军'}援兵抵${target.name}，并入守军。`);
      }
      delete G.armies[a.id];
      return;
    }

    // 停战 / 结盟期内的在途攻军：只能班师，不得开战
    if (!Diplo.canAttack(G, a.factionId, target.owner)) {
      const home = G.cities[a.from];
      if (home && home.owner === a.factionId) {
        const d = U.dist(target.x, target.y, home.x, home.y);
        a.to = a.from;
        a.eta = Math.max(1, Math.ceil(d / (Army.speedOf(a.troops) * Army.speedMul(G, a.factionId))));
        a.totalEta = a.eta;
        a.mission = 'return';
        if (a.factionId === G.player.factionId)
          State.log(G, 'note', `与${(G.factions[target.owner] || {}).name || '守军'}已罢兵，我军自${target.name}城下班师。`);
        return;
      }
      if (a.heroId && G.heroes[a.heroId]) G.heroes[a.heroId].cityId = null;
      delete G.armies[a.id];
      return;
    }

    // 敌军城：开战
    // 玩家亲自指挥的仗逐轮推进（轮间可放一次战法），其余一次打完
    const interactive = a.factionId === G.player.factionId || target.grantedTo === PLAYER_HERO_ID;
    if (interactive) {
      Combat.begin(G, a, target, stamp);
      if (Combat.step(G, a, target, null, stamp)) {
        const rep = Combat.conclude(G, a, target, stamp);
        delete a.battle;
        Army._afterBattle(G, a, target, rep, stamp);
      }
      return;
    }

    // AI 之间的仗：让 AI 在前几轮放一个战法（玩家指挥的仗走上面的交互路径）
    const rep = Combat.resolve(G, a, target, stamp, { aiTactic: true });
    Army._afterBattle(G, a, target, rep, stamp);
  },

  /** 一场攻城打完之后的处理：下城 / 班师 / 全灭 */
  _afterBattle(G, a, target, rep, stamp) {
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
      a.eta = Math.max(1, Math.ceil(d / (Army.speedOf(a.troops) * Army.speedMul(G, a.factionId))));
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
    // 城档按「打下来之前」算：拿下之后它可能变成我的治所，名望不该因此翻倍
    const tierBefore = State.cityLevel(G, city);
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

    // 宝物：破城后每件 35% 留在本城（归新主），否则随败军撤往旧主治所
    for (const tid of Object.keys(G.treasures || {})) {
      const t = G.treasures[tid];
      if (t.cityId !== city.id || t.holder) continue;
      if (RNG.chance(0.35)) continue;
      const caps = State.capitals(G);
      const refuge = [...caps].find(id => G.cities[id] && G.cities[id].owner === oldOwner) || null;
      t.cityId = refuge;
    }

    // 玩家相关
    if (attackerFaction === G.player.factionId) {
      G.stats.citiesTaken++;
      G.player.merit += 25;
      // 名望按城档：县城 +4 / 郡城 +6 / 都城 +12（docs/HERO.md §2.1）
      const tier = tierBefore;
      const rep = tier === 2 ? 12 : tier === 1 ? 6 : 4;
      G.player.reputation += rep;
      State.log(G, 'good',
        `我军克${city.name}${tier === 2 ? '（都城）' : tier === 1 ? '（郡城）' : ''}。战功 +25，名望 +${rep}。`);
      Rank.onCapture(G, city, stamp);
      Mission.onCapture(G, city.id);
      if (a.legionId) {
        const lg = (G.player.legions || []).find(x => x.id === a.legionId);
        if (lg) lg.stats.taken = (lg.stats.taken || 0) + 1;
      }
    }

    if (oldOwner === G.player.factionId) {
      // 玩家势力丢城
      const idx = G.player.demesne.indexOf(city.id);
      if (idx >= 0) {
        G.player.demesne.splice(idx, 1);
        State.dropLegionCity(G, city.id);
        G.stats.citiesLost++;
        State.log(G, 'bad', `我军失守：${city.name}陷落！`);
      }
    }
  },
};
