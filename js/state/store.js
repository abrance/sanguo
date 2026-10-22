// 命令层：所有状态变更通过 dispatch(type, payload) → reducer(draft) 完成。
// reducer 在状态草稿上操作，成功后整体替换 —— 便于回放、调试与将来接后端。

const COMMANDS = {

  END_TURN(G) {
    if (G.over) throw new Error('战局已终');
    Turn.advance(G);
  },

  // ───────── 军事 ─────────
  RECRUIT(G, { cityId, troop, amount }) {
    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城，无权征兵');
    const cost = Recruit.add(G, c, troop, amount, false);
    return { amount, cost };
  },

  DISPATCH(G, { fromId, toId, ratio }) {
    if (G.over) throw new Error('战局已终');
    const from = G.cities[fromId];
    const to = G.cities[toId];
    if (!from || !to) throw new Error('城池不存在');
    if (from.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城，无权调兵');
    if (fromId === toId) throw new Error('目标即出发地');

    const mine = Object.values(G.armies).filter(a => a.factionId === G.player.factionId).length;
    if (mine >= State.demesne(G).length + 1) throw new Error('在外军队已多，待其归建');

    const troops = Army.takeFromGarrison(from.garrison, U.clamp(ratio, 0.05, 1));
    const total = troopTotal(troops);
    if (total < 20) throw new Error('兵力不足 20，无法出征');

    const heroId = pickHeroForCity(G, fromId);

    const a = Army.create(G, {
      factionId: G.player.factionId, heroId,
      from: fromId, to: toId, troops, mission: 'attack',
    });

    const targetTag = to.owner === G.player.factionId ? '增援' : '出征';
    State.log(G, 'note',
      `${targetTag}：${from.name}发兵${U.num(total)}（${ArmyCompose(troops)}）向${to.name}，约${a.eta}月抵达。`);
    return { armyId: a.id, eta: a.eta };
  },

  /** 一键补兵至兵额的一定比例 */
  FILL_TROOPS(G, { cityId, ratio }) {
    if (G.over) throw new Error('战局已终');
    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城，无权征兵');

    const cap = State.troopCapOf(G, c);
    const r = U.clamp(ratio == null ? 1 : ratio, 0.2, 1);
    const target = Math.round(cap * r * 0.98);
    const cur = troopTotal(c.garrison);
    const want = target - cur;
    if (want < 10) throw new Error(`已接近兵额 ${target}，无需补兵`);

    const added = Recruit.autoFill(G, c, want, true);
    if (added <= 0) throw new Error('钱或人口不足，无法补兵');
    State.log(G, 'good', `${c.name}补兵 ${U.num(added)}（${U.num(cur)} → ${U.num(troopTotal(c.garrison))}）。`);
    return { added };
  },

  /** 批量补兵 */
  BATCH_FILL(G, { cityIds }) {
    if (G.over) throw new Error('战局已终');
    if (!cityIds || !cityIds.length) throw new Error('未选城池');
    const ok = [];
    for (const id of cityIds) {
      const c = G.cities[id];
      if (!c || c.grantedTo !== PLAYER_HERO_ID) continue;
      const cap = State.troopCapOf(G, c);
      const want = Math.round(cap * 0.98) - troopTotal(c.garrison);
      if (want < 10) continue;
      const added = Recruit.autoFill(G, c, want, true);
      if (added > 0) ok.push({ id, name: c.name, added });
    }
    if (!ok.length) throw new Error('所选城池已满员，或钱粮不足');
    const total = ok.reduce((s, r) => s + r.added, 0);
    State.log(G, 'good',
      `批量补兵：${ok.length} 城共募 ${U.num(total)}（${ok.map(r => r.name).join('、')}）。`);
    return { total, cities: ok.length };
  },

  /** 批量调兵至同一目标城 */
  BATCH_DISPATCH(G, { cityIds, toId, ratio }) {
    if (G.over) throw new Error('战局已终');
    const to = G.cities[toId];
    if (!to) throw new Error('目标城池不存在');
    if (!cityIds || !cityIds.length) throw new Error('未选城池');

    const r = U.clamp(ratio == null ? 0.7 : ratio, 0.1, 1);
    const limit = State.demesne(G).length + 3;
    let sent = 0, count = 0, skipped = 0;

    for (const id of cityIds) {
      if (id === toId) continue;
      const from = G.cities[id];
      if (!from || from.grantedTo !== PLAYER_HERO_ID) continue;

      const airborne = Object.values(G.armies).filter(a => a.factionId === G.player.factionId).length;
      if (airborne >= limit) { skipped++; continue; }

      const troops = Army.takeFromGarrison(from.garrison, r);
      const t = troopTotal(troops);
      if (t < 20) {
        for (const k of TROOP_KEYS) from.garrison[k] += troops[k] || 0;
        continue;
      }
      Army.create(G, {
        factionId: G.player.factionId, heroId: pickHeroForCity(G, id),
        from: id, to: toId, troops, mission: 'attack',
      });
      sent += t; count++;
    }

    if (!count) throw new Error('所选城池兵力不足，或在外军队已满');
    const tag = to.owner === G.player.factionId ? '合兵' : '合攻';
    State.log(G, 'note',
      `${tag}：${count} 路共 ${U.num(sent)} 向${to.name}${skipped ? `（${skipped} 城因在外军队过多未发）` : ''}。`);
    return { sent, count, skipped };
  },

  // ───────── 内政 ─────────
  BUILD(G, { cityId, key }) {
    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城，无权兴建');
    const turns = Build.start(G, c, key, false);
    return { key, turns };
  },

  CANCEL_BUILD(G, { cityId, index }) {
    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城');
    const job = c.buildQueue[index];
    if (!job) throw new Error('无此项工程');
    // 退还半数已投入资源
    const cost = buildCost(job.key, job.to - 1, 1);
    c.gold += Math.round(cost.gold * 0.5);
    c.mat += Math.round(cost.mat * 0.5);
    c.iron += Math.round(cost.iron * 0.5);
    c.buildQueue.splice(index, 1);
    State.log(G, 'note', `${c.name}罢${BUILDINGS[job.key].name}之役，退还半数物料。`);
  },

  SET_POLICY(G, { cityId, policy }) {
    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城');
    if (policy && !POLICIES[policy]) throw new Error('无此方针');
    c.policy = policy || null;
    State.log(G, 'note',
      policy ? `${c.name}委任太守，行「${POLICIES[policy].name}」之政。` : `${c.name}罢太守委任，收归亲理。`);
  },

  // ───────── 补给线 ─────────
  SET_RALLY(G, { cityId, toId, ratio, fill }) {
    if (G.over) throw new Error('战局已终');
    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城');

    if (!toId) {
      c.rallyTo = null;
      State.log(G, 'note', `${c.name}罢持续调兵。`);
      return;
    }
    const to = G.cities[toId];
    if (!to) throw new Error('目标城池不存在');
    if (toId === cityId) throw new Error('目标即本城');

    c.rallyTo = toId;
    if (ratio != null) c.rallyRatio = U.clamp(ratio, 0.1, 1);
    if (fill != null) c.rallyFill = U.clamp(fill, 0.8, 2.5);

    State.log(G, 'note',
      `${c.name}设持续调兵：每月送走本城 ${Math.round(c.rallyRatio * 100)}%，补至${to.name}兵额 ${Math.round((c.rallyFill || 1.2) * 100)}%。`);
  },

  // ───────── 士族 ─────────
  CLAN_ACTION(G, { cityId, action }) {
    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.grantedTo !== PLAYER_HERO_ID) throw new Error('非你直辖之城');
    if (!c.clans || !c.clans.length) throw new Error('此城无大族');

    const turn = G.meta.turn;
    if (c.clanActionTurn && turn - c.clanActionTurn < 3) {
      throw new Error(`士族新定，尚需 ${3 - (turn - c.clanActionTurn)} 月方可再动`);
    }

    if (action === 'pacify') Clans.pacify(G, c);
    else if (action === 'recruit') Clans.recruit(G, c);
    else if (action === 'suppress') Clans.suppress(G, c);
    else throw new Error('无此手段');

    c.clanActionTurn = turn;
  },

  // ───────── 仕途 ─────────
  SET_ROUTE(G, { route }) {
    const p = G.player;
    if (G.over) throw new Error('战局已终');
    const r = ROUTES[route];
    if (!r) throw new Error('无此路线');
    if (route === 'independent') throw new Error('自立须行「举兵自立」');
    if (p.route === 'independent') throw new Error('既已自立，无从回头');
    if (p.route === route) throw new Error(`已行${r.name}之路`);
    if (route === 'dominant' && p.rank < 2) throw new Error('官未至太守，无揽权之望');

    p.route = route;
    p.favor = U.clamp(p.favor + (route === 'loyal' ? 6 : -8), 0, 100);
    State.log(G, 'note',
      `改行${r.name}之路。（直辖城上限 ${cityCap(p)}）`);
  },

  DECLARE_INDEPENDENCE(G) {
    const p = G.player;
    if (G.over) throw new Error('战局已终');
    if (p.route === 'independent') throw new Error('你已自立');
    if (p.rank < INDEPENDENCE.minRank) {
      throw new Error(`官未至${rankOf(INDEPENDENCE.minRank).name}，无人望自立`);
    }
    if (p.demesne.length < INDEPENDENCE.minCities) {
      throw new Error(`需至少 ${INDEPENDENCE.minCities} 座直辖城（现 ${p.demesne.length}）`);
    }
    if (p.reputation < INDEPENDENCE.minReputation) {
      throw new Error(`声望不足（需 ${INDEPENDENCE.minReputation}，现 ${Math.round(p.reputation)}）`);
    }

    const oldFid = p.factionId;
    const oldFaction = G.factions[oldFid];
    const newFid = 'indep_' + G.meta.turn;
    const palette = ['#b03a2e', '#7d3c98', '#1f6f5c', '#b9770e', '#2e5f8a', '#7a5a2e'];

    G.factions[newFid] = {
      id: newFid,
      name: p.name + '军',
      color: palette[G.meta.turn % palette.length],
      rulerId: PLAYER_HERO_ID,
      aggression: 0.7,
      kind: 'player',
      dead: false,
      treasury: 0,
      momentum: 1,
      tech: { rp: 0, done: Object.assign({}, oldFaction.tech.done), current: null },
      bonus: null,
    };

    for (const id of p.demesne) {
      const c = G.cities[id];
      if (c) c.owner = newFid;
    }
    for (const h of Object.values(G.heroes)) {
      if (h.factionId !== oldFid) continue;
      if (h.cityId && p.demesne.indexOf(h.cityId) >= 0) h.factionId = newFid;
    }
    G.heroes[PLAYER_HERO_ID].factionId = newFid;

    p.factionId = newFid;
    p.route = 'independent';
    p.favor = 0;
    p.mission = null;
    p.missionCooldown = 0;

    TechSys.refresh(G);
    Turn._cleanupFactions(G);

    State.log(G, 'good',
      `【自立】${p.name}不受${oldFaction.name}节制，据 ${p.demesne.length} 城举兵，号「${G.factions[newFid].name}」。`);
    if (State.factionCities(G, oldFid).length > 0) {
      State.log(G, 'bad', `${oldFaction.name}闻讯震怒，即日兴兵来讨。`);
    } else {
      State.log(G, 'note', `${oldFaction.name}仅余你治下之城，自立之后名存实亡。`);
    }
  },

  // ───────── 上命 ─────────
  FULFILL_MISSION(G) {
    if (G.over) throw new Error('战局已终');
    Mission.fulfil(G);
  },

  DECLINE_MISSION(G) {
    if (G.over) throw new Error('战局已终');
    Mission.decline(G);
  },

  // ───────── 权臣权柄 ─────────
  LEVY_TROOPS(G, { fromCityId, toCityId }) {
    if (G.over) throw new Error('战局已终');
    return Favor.levyTroops(G, fromCityId, toCityId);
  },

  SKIM_TAX(G, { cityId }) {
    if (G.over) throw new Error('战局已终');
    return Favor.skimTax(G, cityId);
  },

  // ───────── 科技 ─────────
  RESEARCH(G, { key }) {
    if (!TECHS[key]) throw new Error('无此科技');
    const r = TechSys.start(G, G.player.factionId, key);
    TechSys.refresh(G);
    return r;
  },

  UNSCHEDULE_TECH(G, { key }) {
    TechSys.cancelQueued(G, G.player.factionId, key);
  },
};

/** 为本城挑一名尚未在外带兵的武将；无则将则返回 null */
function pickHeroForCity(G, cityId) {
  const busy = new Set(Object.values(G.armies).map(a => a.heroId).filter(Boolean));
  const cands = Object.values(G.heroes)
    .filter(h => h.factionId === G.player.factionId && h.cityId === cityId && !busy.has(h.id))
    .sort((a, b) => b.tong - a.tong);
  if (cands.length) return cands[0].id;
  if (!busy.has(PLAYER_HERO_ID)) return PLAYER_HERO_ID;
  return null;
}

function ArmyCompose(t) {
  const parts = [];
  for (const k of TROOP_KEYS) if ((t[k] || 0) > 0) parts.push(`${TROOPS[k].short}${U.num(t[k])}`);
  return parts.join('·');
}

// ───────── Store ─────────
const Store = (() => {
  let G = null;

  function init(game) {
    G = game;
    Bus.emit('state', G);
  }

  function get() { return G; }

  function dispatch(type, payload) {
    if (!G) throw new Error('尚未开局');
    const handler = COMMANDS[type];
    if (!handler) throw new Error('未知命令: ' + type);
    const draft = U.clone(G);
    const res = handler(draft, payload || {});
    G = draft;
    Bus.emit('state', G);
    Bus.emit('cmd', { type, payload, res });
    return res;
  }

  function replace(game) {
    G = game;
    Bus.emit('state', G);
  }

  return { init, get, dispatch, replace };
})();
