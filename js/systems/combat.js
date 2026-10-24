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
      p *= 1 + State.heroStat(G, heroId, 'tong') / 200;
      const sk = skillOf(G, h);
      if (sk.atk) p *= sk.atk;
      if (isDef && sk.def) p *= sk.def;
      if (isDef && sk.defenseCity) p *= sk.defenseCity;
      // 甲胄（守城 +）：宝物效果走 State.treasureEff，与特技叠加
      if (isDef) {
        const armor = State.treasureEff(G, heroId, 'defenseCity');
        if (armor) p *= 1 + armor;
      }
      // 守将忠诚影响守城战力（docs/HERO.md §1.5）：100 → ×1.10，0 → ×0.90
      if (isDef) p *= 0.90 + (h.loyalty == null ? 70 : h.loyalty) / 500;
      // 兵种特技：突击 / 神射 / 陷阵 / 水战（按该兵种兵力占比加权）
      const byType = { cav: 'cavalry', arc: 'archer', inf: 'infantry', nvy: 'navy' };
      for (const tk in byType) {
        const v = sk[byType[tk]];
        if (!v) continue;
        p *= 1 + (v - 1) * ((troops[tk] || 0) / total);
      }
      // 火计：攻城伤害（只对进攻方生效）
      if (!isDef && sk.siege) p *= sk.siege;
      // 扬威：士气（攻守同享）
      if (sk.morale) p *= sk.morale;
    }

    // 敌方武将的压制型特技：火计令敌防 -8%、急智令敌攻 -10%
    // ponytail: 单方战力是集总模型，把「削敌防 / 削敌攻」折算成对方战力乘数，效果方向单调正确
    const eh = opts.enemyHeroId ? G.heroes[opts.enemyHeroId] : null;
    if (eh) {
      const es = skillOf(G, eh);
      if (es.enemyDef) p *= es.enemyDef;
      if (es.enemyAtk) p *= es.enemyAtk;
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

    // 玩家天赋（只对玩家势力生效）
    if (opts.factionId && opts.factionId === G.player.factionId) {
      const tal = talentOf(G);
      if (isDef && tal.def) p *= tal.def;
      if (!isDef && tal.atk) p *= tal.atk;
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

  // ───────── 攻城：逐轮推进（战法就插在轮间，docs/HERO.md §5） ─────────

  MAX_ROUNDS: 6,

  /**
   * 战法表：一次战斗只能用一次，消耗士气。
   * 触发条件（skill）来自武将特技；没有特技的将只能用通用战法。
   */
  TACTICS: {
    huoji:    { name: '火计', cost: 12, skill: 'huoji',    atk: 1.45, wall: 0.40, desc: '火攻焚城：攻击 +45%，城墙加成减半' },
    tuji:     { name: '突击', cost: 12, skill: 'tuji',     atk: 1.35, atkLoss: 1.20, desc: '骑兵陷阵：攻击 +35%，我方伤亡 +20%' },
    shenyi:   { name: '神射', cost: 10, skill: 'shenyi',   atk: 1.30, defLoss: 1.25, desc: '弓弩压制：攻击 +30%，敌方伤亡 +25%' },
    tiebi:    { name: '铁壁', cost: 10, skill: 'tiebi',    def: 1.40, defOnly: true, desc: '坚守不出：守备 +40%（仅守城）' },
    jizhi:    { name: '急智', cost: 10, skill: 'jizhi',    def: 1.25, atk: 1.10, desc: '临机应变：守备 +25%、攻击 +10%' },
    wushuang: { name: '无双', cost: 15, skill: 'wushuang', atk: 1.50, selfMorale: -8, desc: '亲突敌阵：攻击 +50%，自身士气 -8' },
    xianzhen: { name: '陷阵', cost: 12, skill: 'xianzhen', atk: 1.30, wall: 0.60, desc: '先登破城：攻击 +30%，城墙加成减 40%' },
    shuijun:  { name: '水战', cost: 12, skill: 'shuijun',  atk: 1.45, need: 'river', desc: '水军夹击：攻击 +45%（仅临水之城）' },
    fubing:   { name: '伏兵', cost: 14, atk: 1.40, defLoss: 1.15, need: 'rough', desc: '林中山间设伏：攻击 +40%，敌方伤亡 +15%' },
    duanliang:{ name: '断粮', cost: 10, enemyMorale: -25, desc: '绝其粮道：敌方士气 -25（全场）' },
    yexi:     { name: '夜袭', cost: 15, atk: 1.20, def: 1.20, wall: 0.50, desc: '乘夜登城：双方战力 +20%，城墙加成减半' },
    mazhen:   { name: '骂阵', cost: 6, enemyMorale: -12, selfMorale: 8, desc: '辱骂挑战：敌士气 -12，己士气 +8' },
  },

  /**
   * 某一侧能用的战法（含可用性与原因）。
   * side：'atk' | 'def'，缺省按「玩家在攻方还是守方」推断（界面调用即走缺省）。
   */
  tacticsFor(G, army, city, side) {
    const isAtk = side ? side === 'atk'
      : (army.factionId === G.player.factionId
        || (city.grantedTo !== PLAYER_HERO_ID && army.factionId !== G.player.factionId));
    const heroId = isAtk ? army.heroId : city.governor;
    const hero = heroId ? G.heroes[heroId] : null;
    const sk = hero ? heroSkill(G, hero.skill) : {};
    const b = army.battle || {};
    const morale = isAtk ? (army.morale == null ? 60 : army.morale)
      : (city.morale == null ? 55 : city.morale);
    const river = State.isRiverCity(G, city);
    const rough = city.terrain === 'mountain' || city.terrain === 'hill' || city.terrain === 'forest';

    const skillKey = hero ? Object.keys(Combat.TACTICS).find(k => Combat.TACTICS[k].skill === hero.skill) : null;
    const out = [];
    for (const key of Object.keys(Combat.TACTICS)) {
      const t = Combat.TACTICS[key];
      // 有该特技 → 专属战法；没有特技的人只能用通用战法
      if (t.skill && t.skill !== sk.id && key !== skillKey) {
        if (t.skill && hero && hero.skill !== t.skill) continue;
      }
      let why = null;
      if (b.tacticUsed) why = '本战已用过战法';
      else if (morale < 30) why = '士气已挫，不能成阵';
      else if (t.defOnly && isAtk) why = '仅守城可用';
      else if (t.need === 'river' && !river) why = '此城不临水';
      else if (t.need === 'rough' && !rough) why = '地形不备（需山林）';
      out.push({ key, ...t, cost: t.cost, ok: !why, why });
    }
    return out;
  },

  /** 开战：把这一仗要用的数据摊成一份可逐轮推进的状态，挂到军上 */
  begin(G, army, city, stamp) {
    const atkHero = G.heroes[army.heroId];
    const defHero = city.governor ? G.heroes[city.governor] : null;
    const atkStart = troopTotal(army.troops);
    const defStart = troopTotal(city.garrison);
    const atkOrigin = G.cities[army.from];

    const b = {
      cityId: city.id,
      round: 0,
      atkLoss: 0, defLoss: 0,
      captured: false, done: false,
      atkStart, defStart,
      atkMorale0: army.morale == null ? 60 : army.morale,
      defMorale0: (city.morale == null ? 55 : city.morale) + (city.order - 55) * 0.3,
      moraleDelta: 0,          // 断粮/骂阵等对守军士气的持续影响
      wallMul: 1,              // 火计/夜袭削弱城墙加成
      tacticUsed: null,
      atkDrill: atkOrigin ? State.bld(atkOrigin, 'drill') : 0,
      defDrill: State.bld(city, 'drill'),
      atkName: (G.factions[army.factionId] || {}).name || '我军',
      defName: (G.factions[city.owner] || {}).name || '守军',
      atkLead: atkHero ? atkHero.name : '无名之将',
      defLead: defHero ? defHero.name : '守将',
      lines: [],
    };

    b.lines.push(`【${city.name}之战】${b.atkName}${b.atkLead}率${Combat.compose(army.troops)}攻${city.name}，`
      + `${b.defName}${b.defLead}以${Combat.compose(city.garrison)}拒守。`);
    const atkSkill = heroSkill(G, atkHero && atkHero.skill);
    if (atkSkill.name) b.lines.push(`${b.atkLead}「${atkSkill.name}」既发，${b.atkName}士气大振。`);
    if (city.terrain !== 'plain') {
      b.lines.push(`战场${TERRAIN[city.terrain].name}，${
        city.terrain === 'mountain' || city.terrain === 'hill' ? '居高临下，守军据险'
        : city.terrain === 'forest' ? '林木遮蔽，弓矢难及远'
        : city.terrain === 'marsh' ? '地势泥泞，铁骑难驰'
        : '荒沙漫漫，水源难继'}。`);
    }
    if ((army.troops.siege || 0) > 0) b.lines.push('云梯撞车并进，城墙震荡。');
    else if ((army.troops.cav || 0) > atkStart * 0.25) b.lines.push('铁骑当先，直冲城门。');

    army.battle = b;
    return b;
  },

  /**
   * 推进一轮。tacticKey 非空时本场消耗一次战法。
   * 返回 true 表示战斗结束（b.done / b.captured）。
   */
  step(G, army, city, tacticKey, stamp) {
    const b = army.battle;
    if (!b || b.done) return true;

    let mods = null;
    if (tacticKey && !b.tacticUsed) {
      const t = Combat.TACTICS[tacticKey];
      const list = Combat.tacticsFor(G, army, city);
      const pick = list.find(x => x.key === tacticKey && x.ok);
      if (!t || !pick) throw new Error((list.find(x => x.key === tacticKey) || {}).why || '此战法不可用');
      b.tacticUsed = tacticKey;
      mods = t;

      const isAtk = army.factionId === G.player.factionId;
      if (isAtk) army.morale = Math.max(20, (army.morale || 60) - t.cost);
      else city.morale = U.clamp((city.morale || 55) - t.cost, 0, 100);

      if (t.enemyMorale) b.moraleDelta += t.enemyMorale;
      if (t.selfMorale) {
        if (isAtk) army.morale = U.clamp((army.morale || 60) + t.selfMorale, 20, 100);
        else city.morale = U.clamp((city.morale || 55) + t.selfMorale, 0, 100);
      }
      if (t.wall) b.wallMul = Math.min(b.wallMul, t.wall);
      b.lines.push(`第${b.round + 1}合：${isAtk ? b.atkLead : b.defLead}用「${t.name}」，${t.desc}。`);
    }

    b.round++;
    const mod = mods || {};
    const atkMorale = Math.max(20, b.atkMorale0 - b.round * 2);
    const defMorale = Math.max(20, b.defMorale0 + b.moraleDelta);

    let AP = Combat.power(G, army.troops, army.heroId, {
      terrain: city.terrain, isDefender: false,
      enemyTroops: city.garrison, morale: atkMorale,
      factionId: army.factionId, drill: b.atkDrill,
      enemyHeroId: city.governor,
    }) * (mod.atk || 1);

    let DP = Combat.power(G, city.garrison, city.governor, {
      terrain: city.terrain, isDefender: true,
      enemyTroops: army.troops, morale: defMorale,
      wall: city.wall * b.wallMul,
      factionId: city.owner, drill: b.defDrill,
      enemyHeroId: army.heroId,
    }) * (mod.def || 1);

    const share = AP / Math.max(1, AP + DP);
    const atkPct = U.clamp((1 - share) * 0.58 * RNG.jitter(1, 0.20), 0.02, 0.70)
      * (mod.atkLoss || 1);
    const defPct = U.clamp(share * 0.90 * RNG.jitter(1, 0.20), 0.02, 0.88)
      * (mod.defLoss || 1);

    const al = Combat._applyLosses(army.troops, U.clamp(atkPct, 0.02, 0.85));
    const dl = Combat._applyLosses(city.garrison, U.clamp(defPct, 0.02, 0.92));
    b.atkLoss += al; b.defLoss += dl;

    const atkR = troopTotal(army.troops), defR = troopTotal(city.garrison);
    if (b.round === 1) {
      b.lines.push(`初战：攻方折 ${U.num(al)}，守方折 ${U.num(dl)}。`);
    } else if (dl > al * 1.5) {
      b.lines.push(`第${b.round}合：守军阵脚渐乱，再折 ${U.num(dl)}。`);
    } else if (al > dl * 1.5) {
      b.lines.push(`第${b.round}合：攻军受挫，折 ${U.num(al)}。`);
    } else {
      b.lines.push(`第${b.round}合：两军互有杀伤（攻折 ${U.num(al)}，守折 ${U.num(dl)}）。`);
    }

    if (defR <= Math.max(6, b.defStart * 0.10)) {
      b.captured = atkR > 0;
      b.done = true;
    } else if (atkR < 25 || atkR <= b.atkStart * 0.32 || b.round >= Combat.MAX_ROUNDS) {
      b.done = true;
    }
    return b.done;
  },

  /** 收尾：城墙/治安/医馆/战报/特效，返回与旧 resolve 一致的结果对象 */
  conclude(G, army, city, stamp) {
    const b = army.battle;
    const atkOrigin = G.cities[army.from];
    const rounds = b.round;
    const captured = b.captured;

    // 城墙受损
    const siegeShare = (army.troops.siege || 0) / Math.max(1, b.atkStart);
    city.wall = Math.max(0, city.wall - (0.20 + siegeShare * 1.8) * rounds);
    city.order = U.clamp(city.order - 3 * rounds, 0, 100);

    // 医馆回收伤兵（攻方出发城）
    const clinic = atkOrigin ? State.bld(atkOrigin, 'clinic') : 0;
    let salvaged = 0;
    if (clinic > 0 && b.atkLoss > 0) {
      salvaged = Math.round(b.atkLoss * clinic * 0.05);
      if (salvaged > 0) {
        const kinds = TROOP_KEYS.filter(k => (army.troops[k] || 0) > 0);
        const key = kinds.length ? kinds[0] : 'inf';
        army.troops[key] += salvaged;
      }
    }

    const atkRemain = troopTotal(army.troops);
    const defRemain = troopTotal(city.garrison);
    b.lines.push(`攻方折损 ${U.num(b.atkLoss)}，余 ${U.num(atkRemain)}；守方折损 ${U.num(b.defLoss)}，余 ${U.num(defRemain)}。`);
    if (salvaged > 0) b.lines.push(`${atkOrigin.name}医馆收治伤卒 ${U.num(salvaged)} 人，复归行伍。`);
    if (captured) b.lines.push(`城门破。${city.name}陷落。`);
    else if (atkRemain <= 0) b.lines.push('攻军尽没，片甲不还。');
    else b.lines.push('守军力战不退，攻军退去。');

    const mine = army.factionId === G.player.factionId || city.owner === G.player.factionId;
    if (mine) {
      State.log(G, 'battle',
        `【${city.name}之战】${b.atkName}攻${b.defName}，${captured ? '城破' : '不克'}`
        + `（攻折 ${U.num(b.atkLoss)}，守折 ${U.num(b.defLoss)}）`,
        {
          battle: {
            cityId: city.id, cityName: city.name,
            atkFactionId: army.factionId, defFactionId: city.owner,
            atkName: b.atkName, defName: b.defName, atkLead: b.atkLead, defLead: b.defLead,
            captured, rounds,
            atkStart: b.atkStart, defStart: b.defStart,
            atkLoss: b.atkLoss, defLoss: b.defLoss,
            atkRemain, defRemain,
            tactic: b.tacticUsed,
          },
          lines: b.lines,
        });
    } else {
      State.log(G, 'note',
        `【${city.name}】${b.atkName}${b.atkLead}攻${b.defName}，${captured ? '城破' : '不克'}（攻折 ${U.num(b.atkLoss)}，守折 ${U.num(b.defLoss)}）。`);
    }
    G.stats.battles++;
    Bus.emit('combat', { cityId: city.id, captured, atkLoss: b.atkLoss, defLoss: b.defLoss });

    return {
      captured, atkLoss: b.atkLoss, defLoss: b.defLoss,
      atkRemain, defRemain, rounds, lines: b.lines,
    };
  },

  /**
   * 一次跑完（AI 之间、以及无头测试用）。
   * opts.aiTactic：AI 会在第一轮放一个战法（玩家指挥的仗不走这里，由界面决定放不放）
   */
  resolve(G, army, city, stamp, opts) {
    Combat.begin(G, army, city, stamp);
    let tactic = opts && opts.aiTactic ? Combat._aiTactic(G, army, city) : null;
    while (!Combat.step(G, army, city, tactic, stamp)) { tactic = null; }
    return Combat.conclude(G, army, city, stamp);
  },

  /** AI 的战法选择：按收益从高到低挑第一个可用的（先放再说，没有长期算计） */
  _aiTactic(G, army, city) {
    const usable = Combat.tacticsFor(G, army, city, 'atk').filter(t => t.ok);
    if (!usable.length) return null;
    const pref = ['huoji', 'yexi', 'wushuang', 'tuji', 'shenyi', 'xianzhen',
      'fubing', 'shuijun', 'duanliang', 'mazhen', 'jizhi', 'tiebi'];
    for (const k of pref) {
      if (usable.some(t => t.key === k)) return k;
    }
    return usable[0].key;
  },

  /** 回合开始前收尾所有没打完的玩家战斗（否则玩家点「结束回合」会卡住） */
  finishOpen(G, stamp) {
    for (const army of Object.values(G.armies)) {
      if (!army.battle) continue;
      const city = G.cities[army.battle.cityId];
      if (!city) { delete army.battle; continue; }
      while (!Combat.step(G, army, city, null, stamp)) { /* 自动打完 */ }
      const rep = Combat.conclude(G, army, city, stamp);
      delete army.battle;
      Army._afterBattle(G, army, city, rep, stamp);
    }
  },

  /** 无随机预估：不跑 RNG，直接按期望伤害推演。AI 与 UI 提示共用。 */
  predict(G, atkTroops, atkHeroId, city, atkFactionId, atkDrill) {
    const a = { ...emptyTroops(), ...atkTroops };
    const d = { ...emptyTroops(), ...city.garrison };
    const atkStart = troopTotal(a);
    const defStart = troopTotal(d);
    const defDrill = State.bld(city, 'drill');
    if (atkStart <= 0) return { win: false, remain: 0, atkLossPct: 1, rounds: 0, atkPower: 0, defPower: 0 };
    if (defStart <= 0) return { win: true, remain: atkStart, atkLossPct: 0, rounds: 0, atkPower: 0, defPower: 0 };

    // 首轮双方战力也带回去，UI 能把「差在哪」摊给玩家看
    let firstAtk = 0, firstDef = 0;
    let rounds = 0;
    while (rounds < 6) {
      rounds++;
      const AP = Combat.power(G, a, atkHeroId, {
        terrain: city.terrain, isDefender: false,
        enemyTroops: d, morale: Math.max(20, 58 - rounds * 2),
        factionId: atkFactionId, drill: atkDrill, wall: 0,
        enemyHeroId: city.governor,
      });
      const DP = Combat.power(G, d, city.governor, {
        terrain: city.terrain, isDefender: true,
        enemyTroops: a, morale: city.morale || 55, wall: city.wall,
        factionId: city.owner, drill: defDrill,
        enemyHeroId: atkHeroId,
      });
      if (rounds === 1) { firstAtk = AP; firstDef = DP; }
      const share = AP / Math.max(1, AP + DP);
      Combat._applyLosses(a, U.clamp((1 - share) * 0.58, 0.02, 0.70));
      Combat._applyLosses(d, U.clamp(share * 0.90, 0.02, 0.88));

      const ar = troopTotal(a), dr = troopTotal(d);
      if (dr <= Math.max(6, defStart * 0.10)) {
        return { win: ar > 0, remain: ar, atkLossPct: 1 - ar / atkStart, rounds, atkPower: firstAtk, defPower: firstDef };
      }
      if (ar < 25 || ar <= atkStart * 0.32) {
        return { win: false, remain: ar, atkLossPct: 1 - ar / atkStart, rounds, atkPower: firstAtk, defPower: firstDef };
      }
    }
    return { win: false, remain: troopTotal(a), atkLossPct: 1 - troopTotal(a) / atkStart, rounds, atkPower: firstAtk, defPower: firstDef };
  },

  defenseScore(G, city) {
    const lg = State.legionMul(G, city);
    const base = Combat.power(G, city.garrison, city.governor, {
      terrain: city.terrain, isDefender: true,
      enemyTroops: { inf: 1 }, morale: city.morale || 55, wall: city.wall,
      factionId: city.owner, drill: State.bld(city, 'drill'),
    });
    return lg ? base * lg.atk : base;
  },

  attackScore(G, troops, heroId, terrain, factionId, drill) {
    return Combat.power(G, troops, heroId, {
      terrain: terrain || 'plain', isDefender: false,
      enemyTroops: { inf: 1 }, morale: 60,
      factionId, drill,
    });
  },
};
