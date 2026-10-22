// 战斗结算：多轮攻城 + 文字战报
const Combat = {

  /** 计算单方战力 */
  power(G, troops, heroId, opts) {
    const total = troopTotal(troops);
    if (total <= 0) return 0;

    const tkey = opts.terrain || 'plain';
    const T = TERRAIN[tkey] || TERRAIN.plain;
    const isDef = !!opts.isDefender;

    const enemy = opts.enemyTroops || {};

    let p = 0;
    for (const k of TROOP_KEYS) {
      const n = troops[k] || 0;
      if (!n) continue;
      const base = isDef ? TROOPS[k].def : TROOPS[k].atk;
      const typeTerrain = T[k] == null ? 1 : T[k];

      // 克制加权：按敌方兵种构成
      let counterW = 1;
      let acc = 0, wsum = 0;
      for (const ek of TROOP_KEYS) {
        const en = enemy[ek] || 0;
        if (!en) continue;
        acc += en * counterMul(k, ek);
        wsum += en;
      }
      if (wsum > 0) counterW = acc / wsum;

      p += n * base * typeTerrain * counterW;
    }

    p *= isDef ? T.defMod : T.atkMod;

    // 士气
    const morale = opts.morale == null ? 55 : opts.morale;
    p *= 0.85 + morale / 250;

    // 武将
    const h = heroId ? G.heroes[heroId] : null;
    if (h) {
      p *= 1 + h.tong / 200;
      const sk = skillOf(h);
      if (sk.atk) p *= sk.atk;
      if (isDef && sk.def) p *= sk.def;
      if (isDef && sk.defenseCity) p *= sk.defenseCity;
      const byType = { tuji: 'cav', shenyi: 'arc', xianzhen: 'inf', shuijun: 'nvy' };
      for (const skey in byType) {
        if (!sk[skey]) continue;
        const share = (troops[byType[skey]] || 0) / total;
        p *= 1 + (sk[skey] - 1) * share;
      }
    }

    // 势力科技
    const f = opts.factionId ? G.factions[opts.factionId] : null;
    const b = f && f.bonus;
    if (b) {
      p *= isDef ? b.def : b.atk;
      const share = k => (troops[k] || 0) / total;
      if (b.cav) p *= 1 + (b.cav - 1) * share('cav');
      if (b.arc) p *= 1 + (b.arc - 1) * share('arc');
      if (b.siege) p *= 1 + (b.siege - 1) * share('siege');
    }

    // 校场操练
    if (opts.drill) p *= 1 + opts.drill * 0.03;

    // 守城：城墙加成（攻城器械削弱）
    if (isDef && opts.wall) {
      const siegeShare = (troops.siege || 0) / total;
      const wallEff = opts.wall * (1 - siegeShare * 0.85);
      p *= 1 + wallEff * 0.22;
    }

    return p;
  },

  _applyLosses(troops, pct) {
    let lost = 0;
    for (const k of TROOP_KEYS) {
      const n = troops[k] || 0;
      if (!n) continue;
      const l = Math.min(n, Math.round(n * pct));
      troops[k] = n - l;
      lost += l;
    }
    return lost;
  },

  compose(troops) {
    const parts = [];
    for (const k of TROOP_KEYS) {
      const n = troops[k] || 0;
      if (n > 0) parts.push(`${TROOPS[k].short}${U.num(n)}`);
    }
    return parts.join('·') || '空';
  },

  /**
   * 结算一次攻城战（多轮）
   * 返回 { captured, atkLoss, defLoss, atkRemain, defRemain, rounds, lines }
   */
  resolve(G, army, city, stamp) {
    const atkHero = G.heroes[army.heroId];
    const defHero = city.governor ? G.heroes[city.governor] : null;

    const atkStart = troopTotal(army.troops);
    const defStart = troopTotal(city.garrison);
    const atkMorale = army.morale == null ? 60 : army.morale;
    const defMorale = city.morale == null ? 55 : (city.morale + (city.order - 55) * 0.3);
    const atkOrigin = G.cities[army.from];
    const atkDrill = atkOrigin ? State.bld(atkOrigin, 'drill') : 0;
    const defDrill = State.bld(city, 'drill');

    const atkName = (G.factions[army.factionId] || {}).name || '我军';
    const defName = (G.factions[city.owner] || {}).name || '守军';
    const atkLead = atkHero ? atkHero.name : '无名之将';
    const defLead = defHero ? defHero.name : '守将';

    const lines = [];
    lines.push(`【${city.name}之战】${atkName}${atkLead}率${Combat.compose(army.troops)}攻${city.name}，${defName}${defLead}以${Combat.compose(city.garrison)}拒守。`);

    if (atkHero && atkHero.skill && HERO_SKILLS[atkHero.skill]) {
      lines.push(`${atkLead}「${HERO_SKILLS[atkHero.skill].name}」既发，${atkName}士气大振。`);
    }
    if (city.terrain !== 'plain') {
      lines.push(`战场${TERRAIN[city.terrain].name}，${
        city.terrain === 'mountain' || city.terrain === 'hill' ? '居高临下，守军据险'
        : city.terrain === 'forest' ? '林木遮蔽，弓矢难及远'
        : city.terrain === 'marsh' ? '地势泥泞，铁骑难驰'
        : '荒沙漫漫，水源难继'}。`);
    }
    if ((army.troops.siege || 0) > 0) lines.push('云梯撞车并进，城墙震荡。');
    else if ((army.troops.cav || 0) > atkStart * 0.25) lines.push('铁骑当先，直冲城门。');

    let atkLoss = 0, defLoss = 0, rounds = 0, captured = false;
    const MAX_ROUNDS = 6;

    while (rounds < MAX_ROUNDS) {
      rounds++;
      const AP = Combat.power(G, army.troops, army.heroId, {
        terrain: city.terrain, isDefender: false,
        enemyTroops: city.garrison, morale: Math.max(20, atkMorale - rounds * 2),
        factionId: army.factionId, drill: atkDrill,
      });
      const DP = Combat.power(G, city.garrison, city.governor, {
        terrain: city.terrain, isDefender: true,
        enemyTroops: army.troops, morale: defMorale, wall: city.wall,
        factionId: city.owner, drill: defDrill,
      });

      const share = AP / Math.max(1, AP + DP);

      const atkPct = U.clamp((1 - share) * 0.58 * RNG.jitter(1, 0.20), 0.02, 0.70);
      const defPct = U.clamp(share * 0.90 * RNG.jitter(1, 0.20), 0.02, 0.88);

      const al = Combat._applyLosses(army.troops, atkPct);
      const dl = Combat._applyLosses(city.garrison, defPct);
      atkLoss += al; defLoss += dl;

      // 回合叙述
      const atkR = troopTotal(army.troops), defR = troopTotal(city.garrison);
      if (rounds === 1) {
        lines.push(`初战：攻方折 ${U.num(al)}，守方折 ${U.num(dl)}。`);
      } else if (dl > al * 1.5) {
        lines.push(`第${rounds}合：守军阵脚渐乱，再折 ${U.num(dl)}。`);
      } else if (al > dl * 1.5) {
        lines.push(`第${rounds}合：攻军受挫，折 ${U.num(al)}。`);
      } else {
        lines.push(`第${rounds}合：两军互有杀伤（攻折 ${U.num(al)}，守折 ${U.num(dl)}）。`);
      }

      if (defR <= Math.max(6, defStart * 0.10)) {
        captured = atkR > 0;
        break;
      }
      if (atkR < 25 || atkR <= atkStart * 0.32) break;
    }

    const atkRemain = troopTotal(army.troops);
    const defRemain = troopTotal(city.garrison);

    // 城墙受损
    const siegeShare = (army.troops.siege || 0) / Math.max(1, atkStart);
    city.wall = Math.max(0, city.wall - (0.20 + siegeShare * 1.8) * rounds);
    city.order = U.clamp(city.order - 3 * rounds, 0, 100);

    // 医馆回收伤兵（攻方出发城）
    const clinic = atkOrigin ? State.bld(atkOrigin, 'clinic') : 0;
    let salvaged = 0;
    if (clinic > 0 && atkLoss > 0) {
      salvaged = Math.round(atkLoss * clinic * 0.05);
      if (salvaged > 0) {
        const kinds = TROOP_KEYS.filter(k => (army.troops[k] || 0) > 0);
        const key = kinds.length ? kinds[0] : 'inf';
        army.troops[key] += salvaged;
      }
    }

    lines.push(`攻方折损 ${U.num(atkLoss)}，余 ${U.num(troopTotal(army.troops))}；守方折损 ${U.num(defLoss)}，余 ${U.num(troopTotal(city.garrison))}。`);
    if (salvaged > 0) lines.push(`${atkOrigin.name}医馆收治伤卒 ${U.num(salvaged)} 人，复归行伍。`);

    if (captured) lines.push(`城门破。${city.name}陷落。`);
    else if (atkRemain <= 0) lines.push('攻军尽没，片甲不还。');
    else lines.push('守军力战不退，攻军退去。');

    // 只有涉及玩家势力才写完整战报；其余压缩成一行，避免刷屏
    const mine = army.factionId === G.player.factionId || city.owner === G.player.factionId;
    if (mine) {
      for (const l of lines) State.log(G, 'battle', l);
    } else {
      State.log(G, 'note',
        `【${city.name}】${atkName}${atkLead}攻${defName}，${captured ? '城破' : '不克'}（攻折 ${U.num(atkLoss)}，守折 ${U.num(defLoss)}）。`);
    }
    G.stats.battles++;

    return { captured, atkLoss, defLoss, atkRemain, defRemain, rounds, lines };
  },

  /** 无随机预估：不跑 RNG，直接按期望伤害推演。AI 与 UI 提示共用。 */
  predict(G, atkTroops, atkHeroId, city, atkFactionId, atkDrill) {
    const a = { ...emptyTroops(), ...atkTroops };
    const d = { ...emptyTroops(), ...city.garrison };
    const atkStart = troopTotal(a);
    const defStart = troopTotal(d);
    const defDrill = State.bld(city, 'drill');
    if (atkStart <= 0) return { win: false, remain: 0, atkLossPct: 1, rounds: 0 };
    if (defStart <= 0) return { win: true, remain: atkStart, atkLossPct: 0, rounds: 0 };

    let rounds = 0;
    while (rounds < 6) {
      rounds++;
      const AP = Combat.power(G, a, atkHeroId, {
        terrain: city.terrain, isDefender: false,
        enemyTroops: d, morale: Math.max(20, 58 - rounds * 2),
        factionId: atkFactionId, drill: atkDrill, wall: 0,
      });
      const DP = Combat.power(G, d, city.governor, {
        terrain: city.terrain, isDefender: true,
        enemyTroops: a, morale: city.morale || 55, wall: city.wall,
        factionId: city.owner, drill: defDrill,
      });
      const share = AP / Math.max(1, AP + DP);
      Combat._applyLosses(a, U.clamp((1 - share) * 0.58, 0.02, 0.70));
      Combat._applyLosses(d, U.clamp(share * 0.90, 0.02, 0.88));

      const ar = troopTotal(a), dr = troopTotal(d);
      if (dr <= Math.max(6, defStart * 0.10)) {
        return { win: ar > 0, remain: ar, atkLossPct: 1 - ar / atkStart, rounds };
      }
      if (ar < 25 || ar <= atkStart * 0.32) {
        return { win: false, remain: ar, atkLossPct: 1 - ar / atkStart, rounds };
      }
    }
    return { win: false, remain: troopTotal(a), atkLossPct: 1 - troopTotal(a) / atkStart, rounds };
  },

  defenseScore(G, city) {
    return Combat.power(G, city.garrison, city.governor, {
      terrain: city.terrain, isDefender: true,
      enemyTroops: { inf: 1 }, morale: city.morale || 55, wall: city.wall,
      factionId: city.owner, drill: State.bld(city, 'drill'),
    });
  },

  attackScore(G, troops, heroId, terrain, factionId, drill) {
    return Combat.power(G, troops, heroId, {
      terrain: terrain || 'plain', isDefender: false,
      enemyTroops: { inf: 1 }, morale: 60,
      factionId, drill,
    });
  },
};
