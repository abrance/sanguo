// 回合流水线
const Turn = {

  advance(G) {
    G.meta.turn++;
    G.meta.month++;
    if (G.meta.month > 12) { G.meta.month = 1; G.meta.year++; }
    const stamp = `${G.meta.year}年${G.meta.month}月`;

    State.log(G, 'turn', `—— ${stamp}（${SEASON[U.season(G.meta.month)].name}）——`);

    // 1 行军 / 战斗
    Army.advance(G, stamp);
    // 2 工程推进
    Build.advance(G, stamp);
    // 3 产出与消耗
    Economy.produce(G, stamp);
    // 4 士族情绪 / 叛乱
    Clans.drift(G, stamp);
    // 5 科研
    TechSys.advance(G, stamp);
    // 6 太守委任
    Viceroy.run(G, stamp);
    Legion.run(G, stamp);
    // 7 持续调兵（补给线）
    Rally.run(G, stamp);
    // 8 上级好感 / 上命
    Favor.monthly(G);
    Mission.tick(G);
    // 8.5 外交：期满 / 关系漂移 / AI 议和宣战结盟
    Diplo.advance(G);
    // 9 声望与晋升
    Rank.monthly(G);
    // 10 AI 决策
    AI.run(G, stamp);
    // 11 玩家失城 → 流亡投奔
    Turn.playerFate(G);
    // 12 势力存亡
    Turn.cleanupFactions(G);
    // 13 胜负
    State.checkEnd(G);
  },

  /** 直辖城全失时，不会立刻出局：被势力重新任命到最弱一城（流亡投奔） */
  playerFate(G) {
    if (G.player.demesne.length > 0) return;
    const cities = State.factionCities(G, G.player.factionId);
    if (!cities.length) return;

    cities.sort((a, b) => a.pop - b.pop);
    const c = cities[0];
    if (c.grantedTo === PLAYER_HERO_ID) return;

    c.grantedTo = PLAYER_HERO_ID;
    if (G.player.demesne.indexOf(c.id) < 0) G.player.demesne.push(c.id);
    G.player.homeCityId = c.id;
    G.player.merit = Math.max(0, G.player.merit - 10);
    G.player.reputation = Math.max(0, G.player.reputation - 10);
    State.log(G, 'bad',
      `${G.player.name}城破流亡，辗转投奔${c.name}，暂栖人下。战功 -10。`);
  },

  cleanupFactions(G) {
    for (const f of Object.values(G.factions)) {
      if (f.kind === 'free') continue;
      if (f.dead) continue;
      const cities = State.factionCities(G, f.id);
      if (cities.length) continue;

      // 玩家本势力：在外军队没归建前还活着（还能打回来），判负交给 checkEnd
      if (f.id === G.player.factionId
          && Object.values(G.armies).some(a => a.factionId === f.id)) continue;

      // 无城即亡：AI 势力不再靠一支在途军凭空续命（地图上看不见它，却还在外交名单里）
      f.dead = true;
      for (const a of Object.values(G.armies)) {
        if (a.factionId !== f.id) continue;
        delete G.armies[a.id];
        if (a.heroId && G.heroes[a.heroId]) G.heroes[a.heroId].cityId = null;
      }
      State.log(G, 'note', `${f.name}覆灭。`);
    }
  },
};
