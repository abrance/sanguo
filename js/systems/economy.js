// 经济系统：产出（粮/钱/建材/铁）、消耗、饥荒、治安与人口漂移
const Economy = {

  produce(G, stamp) {
    for (const c of Object.values(G.cities)) {
      const season = SEASON[U.season(G.meta.month)];
      const f = G.factions[c.owner];
      const bonus = (f && f.bonus) || techMultipliers({});
      const gov = c.governor ? G.heroes[c.governor] : null;
      const ecoMul = State.legionMul(G, c);
      // 守将私交加成（只对玩家直辖城，docs/HERO.md §1.5）：私交 100 → 产出 +10%
      const bondMul = State.isPlayerCity(G, c) && gov && gov.bond
        ? 1 + gov.bond / 1000 : 1;
      const ecoBonus = ((gov && skillOf(G, gov).economy) || 1) * (ecoMul ? ecoMul.eco : 1) * bondMul;
      const clanMul = State.clanEconMul(c);

      const popFactor = 0.55 + c.pop / 240;
      const orderFactor = 0.60 + c.order / 150;

      const customs = 1 + State.bld(c, 'customs') * 0.10;

      // 玩家天赋：只作用于直辖城
      const tal = c.grantedTo === PLAYER_HERO_ID ? talentOf(G) : {};

      const foodOut = State.bld(c, 'farm') * 78 * season.food * popFactor * orderFactor
        * clanMul * ecoBonus * bonus.food * (tal.food || 1);
      const goldOut = State.bld(c, 'market') * 30 * season.tax * popFactor * orderFactor
        * clanMul * ecoBonus * bonus.gold * customs * (tal.gold || 1);
      const matSeason = 0.70 + season.build * 0.40;
      const matOut = (28 + State.bld(c, 'lumber') * 13 + State.bld(c, 'quarry') * 21)
        * matSeason * bonus.mat * clanMul * (tal.mat || 1);
      const ironOut = (4 + State.bld(c, 'ironworks') * 7) * bonus.iron * clanMul * (tal.iron || 1);

      if (c.mat == null) c.mat = 0;
      if (c.iron == null) c.iron = 0;

      const armyUpkeep = troopFood(c.garrison);
      const popUpkeep = c.pop * 0.32;
      c.food += foodOut - armyUpkeep - popUpkeep;
      c.gold += goldOut;
      c.mat = Math.min(matOut + c.mat, 400 + State.bld(c, 'lumber') * 500 + State.bld(c, 'quarry') * 800);
      c.iron = Math.min(ironOut + c.iron, 200 + State.bld(c, 'ironworks') * 400);

      // 仓廪上限
      const fcap = State.foodCapOf(G, c);
      if (c.food > fcap) {
        c.food = fcap;
        if (c.grantedTo === PLAYER_HERO_ID && RNG.chance(0.04)) {
          State.log(G, 'note', `${c.name}仓廪满溢，余粮陈腐。`);
        }
      }

      // 饥荒
      if (c.food < 0) {
        const def = Math.min(0, c.food);
        c.food = 0;
        c.order = U.clamp(c.order - 5, 0, 100);
        const relief = 1 - State.bld(c, 'granary') * 0.04;
        const lossPct = Math.max(0.01, (0.04 + Math.min(0.12, Math.abs(def) / 4000)) * relief);
        let lost = 0;
        for (const k of TROOP_KEYS) {
          const l = Math.round((c.garrison[k] || 0) * lossPct);
          c.garrison[k] -= l;
          lost += l;
        }
        if (lost > 0 && c.owner === G.player.factionId) {
          State.log(G, 'bad', `${c.name}粮尽，逃兵 ${U.num(lost)}。`);
        }
      }

      // 治安回归：府衙 + 守将加速
      const office = State.bld(c, 'office');
      const beacon = State.bld(c, 'beacon');
      const orderCap = 55 + office * 5 + beacon * 2;
      const rec = (c.governor ? 1.4 : 0.8) + office * 0.3;
      if (c.order < orderCap) c.order = Math.min(orderCap, c.order + rec);
      else if (c.order > orderCap) c.order = Math.max(orderCap, c.order - 0.5);

      // 人口向户籍上限靠拢（抽丁后可回升），医馆加速
      const pmax = State.popMaxOf(G, c);
      if (c.pop < pmax) {
        const clinic = 1 + State.bld(c, 'clinic') * 0.08;
        const rate = 0.10 * (0.70 + c.order / 150) * clinic;
        c.pop = Math.min(pmax, c.pop + (pmax - c.pop) * rate);
      } else if (c.pop > pmax) {
        c.pop = Math.max(pmax, c.pop - (c.pop - pmax) * 0.1);
      }

      // 城防自然修复（未在建城墙时）；围城中不修 —— 否则攻城战被拖到下一回合时城墙又长回来
      const wmax = State.wallMaxOf(c);
      if (c.wall < wmax && !State.besieged(G, c.id)) {
        c.wall = Math.min(wmax, c.wall + 0.12);
      }
    }
  },

  recruitCost(amount, troopKey) {
    const t = TROOPS[troopKey];
    return { gold: Math.ceil(amount * t.cost), pop: Math.ceil(amount * t.popCost) };
  },
};
