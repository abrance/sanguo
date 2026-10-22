// 上级好感：赏赐、猜忌、削权
const Favor = {

  monthly(G) {
    const p = G.player;
    if (G.over) return;
    if (p.route === 'independent') return;

    const route = ROUTES[p.route] || ROUTES.loyal;
    const cities = State.demesne(G);
    if (!cities.length) return;

    p.favor = U.clamp(p.favor + route.favorDrift, 0, 100);

    // 权臣：君主猜忌
    if (p.route === 'dominant' && RNG.chance(0.20)) {
      const loss = RNG.between(6, 12);
      p.favor = U.clamp(p.favor - loss, 0, 100);
      State.log(G, 'bad', `君主心疑，密遣使者察你动静。（好感 -${loss}）`);
    }

    // 赏赐：忠臣路线基础赏赐，好感高时任何路线都有额外赏
    const subsidize = route.subsidy || p.favor > 80;
    if (subsidize) {
      const base = route.subsidy ? 1 : 0.35;
      const k = base * (p.favor / 60);
      const food = Math.round(42 * cities.length * k);
      const gold = Math.round(26 * cities.length * k);
      const perFood = food / cities.length;
      const perGold = gold / cities.length;
      for (const c of cities) {
        c.food += perFood;
        c.gold += perGold;
      }
      if (RNG.chance(0.10) && (food > 0 || gold > 0)) {
        State.log(G, 'good', `上级赐粮 ${U.num(food)}、钱 ${U.num(gold)}。`);
      }
    }

    // 好感过低：削权（至少保留一座直辖城）
    if (p.favor < 25 && p.demesne.length >= 2 && RNG.chance(0.10)) {
      const victimId = p.demesne[p.demesne.length - 1];
      const victim = G.cities[victimId];
      if (victim) {
        victim.grantedTo = null;
        p.demesne = p.demesne.filter(id => id !== victimId);
        if (p.homeCityId === victimId) p.homeCityId = p.demesne[0];
        p.favor = U.clamp(p.favor + 10, 0, 100);
        State.log(G, 'bad', `上级削权：${victim.name}收归势力直辖，不再由你节制。`);
      }
    }
  },

  /** 权臣：征调同僚城池的兵力到自己直辖城 */
  levyTroops(G, fromCityId, toCityId) {
    const p = G.player;
    if (p.route !== 'dominant') throw new Error('唯权臣可行此举');
    if (p.rank < 3) throw new Error('官未至刺史，无征调之权');

    const from = G.cities[fromCityId];
    const to = G.cities[toCityId];
    if (!from || !to) throw new Error('城池不存在');
    if (from.owner !== G.player.factionId) throw new Error('非同势力城池');
    if (from.grantedTo === PLAYER_HERO_ID) throw new Error('此城已归你直辖，无需征调');
    if (to.grantedTo !== PLAYER_HERO_ID) throw new Error('接收方须是你的直辖城');
    if (p.domActionTurn && G.meta.turn - p.domActionTurn < 2) throw new Error('权柄初用，需两月再动');

    const troops = Army.takeFromGarrison(from.garrison, 0.40);
    const total = troopTotal(troops);
    if (total < 30) {
      for (const k of TROOP_KEYS) from.garrison[k] += troops[k] || 0;
      throw new Error('该城兵力不足，无兵可调');
    }
    for (const k of TROOP_KEYS) to.garrison[k] = (to.garrison[k] || 0) + (troops[k] || 0);

    from.morale = U.clamp(from.morale - 6, 0, 100);
    p.favor = U.clamp(p.favor - 4, 0, 100);
    p.domActionTurn = G.meta.turn;

    State.log(G, 'note',
      `征调${from.name}兵 ${U.num(total)} 入${to.name}。同僚侧目。（好感 -4）`);
    return { total };
  },

  /** 权臣：截留同僚城池税赋 */
  skimTax(G, cityId) {
    const p = G.player;
    if (p.route !== 'dominant') throw new Error('唯权臣可行此举');
    if (p.rank < 3) throw new Error('官未至刺史，无截税之权');

    const c = G.cities[cityId];
    if (!c) throw new Error('城池不存在');
    if (c.owner !== G.player.factionId) throw new Error('非同势力城池');
    if (c.grantedTo === PLAYER_HERO_ID) throw new Error('此城已归你直辖，无需截留');
    if (p.domActionTurn && G.meta.turn - p.domActionTurn < 2) throw new Error('权柄初用，需两月再动');

    const take = Math.round(c.gold * 0.45);
    if (take < 20) throw new Error('此城府库空虚，无税可截');

    c.gold -= take;
    const home = G.cities[p.homeCityId] || State.demesne(G)[0];
    if (home) home.gold += take;

    p.favor = U.clamp(p.favor - 4, 0, 100);
    p.domActionTurn = G.meta.turn;

    State.log(G, 'note',
      `截留${c.name}税赋 ${U.num(take)} 入私库。地方怨望。（好感 -4）`);
    return { take };
  },
};
