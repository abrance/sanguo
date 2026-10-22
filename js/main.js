(function () {

  function boot() {
    Renderer.init(document.getElementById('map'));
    UI.init();
    Bus.on('state', G => UI.render(G));

    // 有存档则直接续档
    const saved = Save.load(DEFAULT_SCENARIO);
    if (saved && saved.meta && saved.cities) {
      State.migrate(saved);
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
