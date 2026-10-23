// 人情账：武将忠诚漂移与叛变（设计见 docs/HERO.md §1）
// 规则全在 HERO.md §1.3 / §1.6，这里只实现，不改公式口径。
const Relations = {

  /** 回合流水线第 8.6 步：漂移 + 叛变 */
  drift(G, stamp) {
    const busy = Relations._busyHeroes(G);
    const deltas = {};
    for (const f of Object.values(G.factions)) {
      if (f.kind === 'free' || f.dead) continue;
      deltas[f.id] = Relations._cityDelta(G, f);
    }

    for (const h of Object.values(G.heroes)) {
      if (!h.alive || h.id === PLAYER_HERO_ID) continue;
      if (h.factionId === 'free') { h.idle = 0; continue; }

      const mine = h.factionId === G.player.factionId;
      const delta = deltas[h.factionId] || 0;

      let drift = 0;
      if (delta > 0) drift += 0.4;          // 势力在赢
      else if (delta < 0) drift -= 0.6;     // 势力在输
      drift -= (h.ambition == null ? 40 : h.ambition) / 200;
      drift += (h.bond || 0) / 300;
      drift -= (h.grievance || 0) * 0.5;

      const c = Relations._cityOf(G, h);
      if (c && (State.bld(c, 'academy') >= 3 || c.order >= 80)) drift += 0.5;

      if ((h.idle || 0) >= 6) {
        drift -= 1.0;
        // 第一次踩线提示一次，之后静默（避免每月刷屏）
        if (mine && h.idle === 6) State.log(G, 'note', `${h.name}久不任用，心怀怨望。`);
      }

      h.loyalty = U.clamp((h.loyalty == null ? 70 : h.loyalty) + drift, 0, 100);

      // 私交与忠诚互相牵引（只对玩家势力有意义）
      if (mine) h.bond = U.clamp((h.bond || 0) + (h.loyalty - (h.bond || 0)) * 0.10, 0, 100);

      h.idle = busy.has(h.id) ? 0 : (h.idle || 0) + 1;
    }

    Relations._revolt(G, stamp);
  },

  /** 本势力城数较 6 回合前的增减（"在赢 / 在输"） */
  _cityDelta(G, f) {
    const n = State.factionCities(G, f.id).length;
    f._hist = (f._hist || []).filter(x => x.turn > G.meta.turn - 7);
    const old = f._hist.find(x => x.turn === G.meta.turn - 6);
    const out = old ? n - old.n : 0;
    const cur = f._hist.find(x => x.turn === G.meta.turn);
    if (cur) cur.n = n; else f._hist.push({ turn: G.meta.turn, n });
    return out;
  },

  /** 闲着 = 既非任一城守将，也不在任何在外军里 */
  _busyHeroes(G) {
    const s = new Set();
    for (const c of Object.values(G.cities)) if (c.governor) s.add(c.governor);
    for (const a of Object.values(G.armies)) if (a.heroId) s.add(a.heroId);
    return s;
  },

  _cityOf(G, h) {
    if (h.cityId && G.cities[h.cityId]) return G.cities[h.cityId];
    for (const c of Object.values(G.cities)) if (c.governor === h.id) return c;
    return null;
  },

  _governedCity(G, h) {
    for (const c of Object.values(G.cities)) {
      if (c.governor === h.id && c.owner === h.factionId) return c;
    }
    return null;
  },

  /** 叛变状态机：预警 → 3 回合干预窗口 → 掷骰 */
  _revolt(G, stamp) {
    const turn = G.meta.turn;
    for (const h of Object.values(G.heroes)) {
      if (!h.alive || h.id === PLAYER_HERO_ID) continue;
      if (h.factionId === 'free') continue;

      const mine = h.factionId === G.player.factionId;
      const risky = (h.loyalty || 0) < 30 && (h.ambition || 0) > 60;

      if (!risky) { h.warnTurn = 0; continue; }

      // 首次满足条件：先预警一个月，本月一定不叛
      if (!h.warnTurn) {
        h.warnTurn = turn;
        if (mine) State.log(G, 'bad', `${h.name}心怀异志，恐生变故。`);
        continue;
      }

      // 预警后 3 回合内安抚过 → 本次不叛（安抚只算一次）
      if (h.lastAct && h.lastAct >= h.warnTurn && turn - h.warnTurn <= 3) {
        h.warnTurn = 0;
        if (mine) State.log(G, 'good', `${h.name}感念恩遇，暂且按下异心。`);
        continue;
      }

      if (!RNG.chance((h.loyalty || 0) < 20 ? 0.10 : 0.06)) continue;
      Relations._defect(G, h, stamp);
    }
  },

  /** 叛变结算：能带城就带城投敌，否则落草。武将永不消失（只能换主子） */
  _defect(G, h, stamp) {
    const oldFid = h.factionId;
    const mine = oldFid === G.player.factionId;
    const oldName = (G.factions[oldFid] || {}).name || '旧主';
    const city = Relations._governedCity(G, h);
    h.warnTurn = 0;

    if (!city) {
      h.factionId = 'free';
      h.cityId = null;
      h.loyalty = 30;
      State.log(G, mine ? 'bad' : 'note', `${h.name}弃${oldName}而去，浪迹江湖。`);
      return;
    }

    const cands = State.neighbors(G, city.id, 260)
      .filter(nb => nb.owner !== oldFid && nb.owner !== 'free'
        && G.factions[nb.owner] && !G.factions[nb.owner].dead);
    if (!cands.length) {
      city.governor = null;
      h.factionId = 'free';
      h.cityId = city.id;
      h.loyalty = 30;
      State.log(G, mine ? 'bad' : 'note', `${h.name}据${city.name}自守，不复听命于${oldName}。`);
      return;
    }

    // 投奔与旧主关系最差（最恨旧主）的接壤势力
    cands.sort((a, b) => Diplo.relationOf(G, oldFid, a.owner) - Diplo.relationOf(G, oldFid, b.owner));
    const toFid = cands[0].owner;
    const toName = (G.factions[toFid] || {}).name || '他国';

    const wasDemesne = city.grantedTo === PLAYER_HERO_ID;
    city.owner = toFid;
    city.grantedTo = null;
    city.order = U.clamp(city.order - 12, 0, 100);
    city.morale = U.clamp((city.morale || 55) - 10, 0, 100);

    // 城内同势力武将一并易主（随城而降）
    for (const o of Object.values(G.heroes)) {
      if (o.id === PLAYER_HERO_ID || o.factionId !== oldFid) continue;
      if (o.cityId === city.id) { o.factionId = toFid; o.loyalty = U.clamp((o.loyalty || 50) - 5, 0, 100); }
    }
    h.factionId = toFid;
    h.cityId = city.id;
    city.governor = h.id;
    h.loyalty = 55;

    if (wasDemesne) {
      G.player.demesne = G.player.demesne.filter(id => id !== city.id);
      State.dropLegionCity(G, city.id);
      if (G.player.homeCityId === city.id) {
        G.player.homeCityId = G.player.demesne[0] || G.player.homeCityId;
      }
    }

    State.log(G, mine ? 'bad' : 'note',
      `${h.name}举${city.name}降${toName}，${mine ? '你痛失一城' : `${oldName}失一城`}。`);
  },
};

// ───────── 定向登用（docs/HERO.md §3） ─────────
// 三档：拜访 / 送礼 / 三顾。成功率全透明，界面直接列出每一项。
Relations.TIERS = {
  visit:   { id: 'visit',   name: '拜访', gold: 60,  food: 0,   base: 0.12, cd: 2 },
  gift:    { id: 'gift',    name: '送礼', gold: 260, food: 120, base: 0.28, cd: 4 },
  beseech: { id: 'beseech', name: '三顾', gold: 900, food: 0,   base: 0.55, cd: 6 },
};

/** 在野将的招募成功率（返回分项，便于界面逐条显示） */
Relations.recruitChance = function (G, hero, tierKey) {
  const tier = Relations.TIERS[tierKey];
  if (!tier) return { p: 0, parts: [] };
  const p = G.player;
  const bond = hero.bond || 0;
  const rep = p.reputation || 0;
  const ambition = hero.ambition == null ? 40 : hero.ambition;
  const parts = [
    ['基础', tier.base],
    ['私交', bond * 0.005],
    ['名望', rep / 800],
    ['魅力', (p.mei || 0) / 400],
    ['野心低', (100 - ambition) * 0.002],
    ['智谋', -hero.zhi * 0.0015],
  ];
  const sum = parts.reduce((s, x) => s + x[1], 0);
  const fails = (hero.visits && hero.visits.fails) || 0;
  return {
    p: U.clamp(sum, 0.03, 0.92),
    parts,
    burnt: fails >= 3,        // 连续三次失败后不再涨私交
  };
};

/**
 * 执行一次登用（在草稿上改状态）。返回 { ok, chance }。
 * 失败：钱粮不退，私交 +3（连败三次后不再涨）；三顾失败另扣名望 -3。
 */
Relations.tryRecruit = function (G, hero, tierKey) {
  const tier = Relations.TIERS[tierKey];
  const chance = Relations.recruitChance(G, hero, tierKey);
  hero.visits = hero.visits || {};
  hero.visits[tierKey] = G.meta.turn;

  const ok = RNG.chance(chance.p);
  if (ok) {
    hero.factionId = G.player.factionId;
    hero.cityId = G.player.homeCityId;
    hero.loyalty = U.clamp(45 + (hero.bond || 0) / 2, 0, 100);
    hero.bond = Math.max(hero.bond || 0, 20);
    hero.idle = 0;
    hero.visits.fails = 0;
    State.log(G, 'good', Relations._welcomeLine(G, hero, tier.name));
    return { ok: true, chance };
  }

  hero.visits.fails = ((hero.visits.fails) || 0) + 1;
  if (hero.visits.fails <= 3) hero.bond = U.clamp((hero.bond || 0) + 3, 0, 100);
  if (tierKey === 'beseech') G.player.reputation = Math.max(0, G.player.reputation - 3);
  State.log(G, 'note',
    `${tier.name}${hero.name}不遇` + (hero.visits.fails <= 3 ? '，然其心稍感（私交 +3）。' : '，其已不堪其扰。'));
  return { ok: false, chance };
};

/** 招来的将按五维给一句模板语（不做 130 条手写独白） */
Relations._welcomeLine = function (G, hero, way) {
  const line = hero.wu >= 85 ? '愿为明公执戟前驱'
    : hero.zhi >= 85 ? '天下棋局，愿与明公共弈'
    : hero.zheng >= 80 ? '愿为明公理民治粟'
    : '蒙公不弃，敢不效死';
  return `${way}既至，${hero.name}曰：「${line}。」遂入麾下。`;
};

/** 势力内非直辖城的「征辟」也走同一套成功率（不再必成功） */
Relations.recruitFree = function (G, city) {
  const free = Object.values(G.heroes)
    .filter(h => h.alive && h.factionId === 'free')
    .sort((a, b) => (b.zhi + b.tong) - (a.zhi + a.tong));
  if (!free.length) throw new Error('在野无英才可辟');

  const h = free[0];
  const chance = Relations.recruitChance(G, h, 'beseech');
  const ok = RNG.chance(chance.p);
  if (ok) {
    h.factionId = G.player.factionId;
    h.cityId = city.id;
    h.loyalty = 78;
    h.bond = Math.max(h.bond || 0, 25);
    State.log(G, 'good', `${city.name}征辟${h.name}（统 ${h.tong} / 智 ${h.zhi}），士族归心。`);
  } else {
    State.log(G, 'note', `${city.name}欲辟${h.name}，其人婉拒；士林称之。`);
  }
  return { ok, hero: h, chance };
};
