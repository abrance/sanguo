// 视图层 · 结局：天下一统 / 势力覆亡
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_END = {

  /**
   * 结局弹窗：只在结局第一次出现时铺一次（读档读到已结束的局面也一样铺）。
   * 一幕铺完就不再重入，点「览图」关掉后可继续看大地图。
   */
  renderEnd(G) {
    const box = UI.$('endOverlay');
    const body = UI.$('endBox');
    if (!box || !body) return;

    if (!G.over) {
      UI._endKey = null;
      box.classList.add('hidden');
      return;
    }

    const win = G.over.result === 'win';
    const key = `${win ? 'win' : 'lose'}:${G.meta.turn}`;
    if (UI._endKey === key) return;         // 已经铺过这一幕
    UI._endKey = key;

    const p = G.player;
    const dead = Object.values(G.factions).filter(f => f.kind !== 'free' && f.dead).length;
    const cities = State.factionCities(G, p.factionId).length;
    const months = G.meta.turn - 1;

    const stats = [
      [win ? `${cities}` : `${G.stats.citiesLost || 0}`, win ? '城  归  一' : '失  城'],
      [`${dead}`, '覆  灭  势  力'],
      [`${months}`, '征  战  月  数'],
      [`${p.merit}`, '战  功'],
      [`${rankOf(p.rank).name}`, '官  阶'],
      [`${ROUTES[p.route] ? ROUTES[p.route].name : '—'}`, '仕  途'],
    ];

    body.className = 'end-box' + (win ? '' : ' lose');
    body.innerHTML = `
      <div class="end-seal">${win ? '天下一统' : '覆亡'}</div>
      <div class="end-eyebrow">${U.esc(G.meta.scenarioName)} · ${G.meta.year}年${G.meta.month}月</div>
      <h1 class="end-title">${U.esc(G.over.title || (win ? '天 下 一 统' : '势 力 覆 亡'))}</h1>
      <div class="end-text">${U.esc(G.over.text)}</div>
      <div class="end-stats">
        ${stats.map(([v, k], i) =>
          `<div class="end-stat" style="--i:${i}"><b>${U.esc(String(v))}</b><span>${k}</span></div>`).join('')}
      </div>
      <div class="end-acts">
        <button class="primary" data-end="map">览  图</button>
        <button data-end="log">看  纪  事</button>
        <button data-end="history">战  史</button>
        <button data-end="new">重  开  一  局</button>
      </div>
      <pre id="endHistory" class="end-history hidden"></pre>`;

    box.classList.remove('hidden');

    // 天下尽在掌中：镜头拉到全图
    const cs = Object.values(G.cities);
    if (win && cs.length && Renderer.cam) {
      const cx = cs.reduce((s, c) => s + c.x, 0) / cs.length;
      const cy = cs.reduce((s, c) => s + c.y, 0) / cs.length;
      Renderer.flyTo(cx, cy, 1200, Renderer.ZOOM_MIN);
    }

    body.onclick = e => {
      const b = e.target.closest('button[data-end]');
      if (!b) return;
      const act = b.dataset.end;
      if (act === 'log') {
        box.classList.add('hidden');
        UI.sideTab = 'log';
        UI.syncTabs();
        return;
      }
      if (act === 'history') {
        const pre = UI.$('endHistory');
        const txt = UI.endHistoryText(G);
        if (pre) {
          pre.textContent = txt;
          pre.classList.remove('hidden');
          if (navigator.clipboard) navigator.clipboard.writeText(txt).catch(() => { });
        }
        UI.toast('战史已生成' + (navigator.clipboard ? '并复制' : ''));
        return;
      }
      if (act === 'new') {
        box.classList.add('hidden');
        UI.$('startOverlay').classList.remove('hidden');
        return;
      }
      box.classList.add('hidden');           // 览图：退出弹窗，地图留着看
    };
  },

  /** 纯文本战史：结局 + 三段史评 + 本局数据 + 大事记（docs/EVENTS.md §10） */
  endHistoryText(G) {
    const p = G.player;
    const f = G.factions[p.factionId] || {};
    const dead = Object.values(G.factions).filter(x => x.kind !== 'free' && x.dead).map(x => x.name);
    const events = (G.events && G.events.history) || [];
    const lines = [];
    lines.push(`《${G.meta.scenarioName}》战史 —— ${p.name}`);
    lines.push('');
    lines.push(`结局：${G.over.title || (G.over.result === 'win' ? '功业盖世' : '势力覆亡')}`);
    lines.push(G.over.text || '');
    lines.push('');
    lines.push(`共 ${G.meta.turn - 1} 月 · 城 ${State.factionCities(G, p.factionId).length}`
      + ` · 战功 ${p.merit} · 名望 ${Math.round(State.playerReputation ? State.playerReputation(G) : p.reputation)}`
      + ` · 官阶 ${rankOf(p.rank).name} · 仕途 ${ROUTES[p.route] ? ROUTES[p.route].name : '—'}`);
    lines.push(`攻取 ${G.stats.citiesTaken || 0} 城 · 失守 ${G.stats.citiesLost || 0} 城`
      + ` · 会战 ${G.stats.battles || 0} 次 · 覆灭势力 ${dead.length} 家`);
    if (events.length) {
      lines.push('');
      lines.push('大事记：');
      for (const e of events.slice(-12)) {
        lines.push(`  ${G.meta.scenarioName}第 ${e.turn} 月 · ${e.name} · ${e.label}`);
      }
    }
    lines.push('');
    lines.push(`势力：${f.name || '—'}`);
    return lines.join('\n');
  },
};
