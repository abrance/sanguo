// 官阶系统：晋升 + 战功分封
const Rank = {

  /** 攻下城池后 —— 分封 + 检查晋升 */
  onCapture(G, city, stamp) {
    const cap = cityCap(G.player);
    if (G.player.demesne.length < cap) {
      city.grantedTo = PLAYER_HERO_ID;
      if (G.player.demesne.indexOf(city.id) < 0) G.player.demesne.push(city.id);
      if (!G.cities[G.player.homeCityId] || G.cities[G.player.homeCityId].grantedTo !== PLAYER_HERO_ID)
        G.player.homeCityId = city.id;
      State.log(G, 'good', `分封：${city.name}归${G.player.name}直辖。`);
    } else {
      State.log(G, 'note',
        `战功已录，然官止${rankOf(G.player.rank).name}，直辖不过${cap}城。${city.name}暂归势力。`);
    }
    Rank.checkPromotion(G, stamp);
  },

  /** 检查晋升 */
  checkPromotion(G, stamp) {
    let promoted = false;
    while (true) {
      const nr = nextRank(G.player.rank);
      if (!nr) break;
      const need = meritThreshold(G.player);
      if (G.player.merit < need) break;
      G.player.rank += 1;
      promoted = true;
      State.log(G, 'good',
        `【擢升】${G.player.name}迁${rankOf(G.player.rank).name}。直辖上限 ${cityCap(G.player)} 城。`);
    }
    if (promoted) G.player.reputation += 15;
    return promoted;
  },

  /** 每回合的声望自然增长（治下安定） */
  monthly(G) {
    const cities = State.demesne(G);
    let rep = 0;
    for (const c of cities) rep += (c.order - 45) / 100;
    rep = Math.max(0, Math.round(rep));
    if (rep > 0) G.player.reputation += rep;
    Rank.checkPromotion(G, '月度');
  },
};
