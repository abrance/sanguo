(function () {

  /**
   * 截图模式：index.html?shot=1&seed=7&turn=12&zoom=0.9&cx=1200&cy=900
   * 只给 tools/shots.js 的视觉回归用：固定种子、固定回合、dt=0（冻结动画），
   * 保证同一台机器上两次截图逐像素一致。
   */
  function shotQuery() {
    if (typeof URLSearchParams === 'undefined') return null;
    const q = new URLSearchParams(location.search);
    return q.get('shot') ? q : null;
  }

  function bootShot(q) {
    // CSS 动画一律停掉：无限循环的闪烁会让像素对比随机翻车
    document.body.classList.add('shot');
    const G = State.create({
      scenarioId: DEFAULT_SCENARIO,
      factionId: q.get('faction') || 'caocao',
      cityId: q.get('city') || 'chenliu',
      playerName: '影',
      seed: Number(q.get('seed') || 7),
    });
    Store.init(G);

    const turns = Number(q.get('turn') || 0);
    for (let i = 0; i < turns; i++) {
      try { Store.dispatch('END_TURN'); } catch (e) { break; }
      if (Store.get().over) break;
    }

    // fight=1：造一支大军直接结算一场攻城，保证截图里有稳定的战报卡
    //（截图夹具：直接调用规则层结算，不走命令层，避免 AI 中途议和把战斗跳过去）
    if (q.get('fight')) {
      const g1 = Store.get();
      const from = g1.cities[g1.player.homeCityId];
      const near = Object.values(g1.cities)
        .filter(c => c.owner !== g1.player.factionId && c.owner !== 'free')
        .map(c => ({ c, d: U.dist(from.x, from.y, c.x, c.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (from && near) {
        Diplo.declareWar(g1, g1.player.factionId, near.c.owner);
        const army = {
          id: 'shot-army',
          factionId: g1.player.factionId,
          heroId: PLAYER_HERO_ID,
          from: from.id,
          to: near.c.id,
          troops: Object.assign(emptyTroops(), { inf: 2400, arc: 700, cav: 400 }),
          morale: 65,
          mission: 'attack',
        };
        Combat.resolve(g1, army, near.c, 'fixture');
        Store.replace(g1);
      }
    }

    const g = Store.get();
    Renderer.attach(g);
    Renderer.cam.zoom = Number(q.get('zoom') || 0.9);
    Renderer.centerOn(Number(q.get('cx') || 1200), Number(q.get('cy') || 900));
    if (q.get('sel')) {
      UI.selectedId = q.get('sel');
      Renderer.selectedId = UI.selectedId;
    }
    if (q.get('tab')) {
      UI.sideTab = q.get('tab');
      UI.syncTabs();
    }
    UI.render(g);
    document.getElementById('startOverlay').classList.add('hidden');
    window.__shotReady = true;

    // dt 固定 0：旗面飘动 / 直辖光晕 / 镜头缓动全都停在初始姿态
    function frame() {
      const x = Store.get();
      if (x) Renderer.draw(x, 0);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    Renderer.init(document.getElementById('map'));
    UI.init();
    Bus.on('state', G => UI.render(G));

    const shot = shotQuery();
    if (shot) { bootShot(shot); return; }

    // 有存档则直接续最近一局
    const saved = Save.latest(DEFAULT_SCENARIO);
    if (saved && saved.meta && saved.cities) {
      Store.init(saved);
      Renderer.attach(saved);
      UI.selectedId = saved.player.homeCityId;
      Renderer.selectedId = UI.selectedId;
      document.getElementById('startOverlay').classList.add('hidden');
    }

    let last = performance.now();
    function frame(t) {
      const dt = Math.min(80, t - last);
      last = t;
      const G = Store.get();
      if (G) Renderer.draw(G, dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
