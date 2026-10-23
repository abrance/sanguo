// 视图层 · 纪事面板
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_LOG = {

  // ───────── 纪事 ─────────
  renderLog(G) {
    const box = UI.$('logList');
    const items = G.log.slice(-LOG_VIEW);
    const base = G.log.length - items.length;
    const mark = UI._logMark == null ? G.log.length : UI._logMark;

    const filter = UI.logFilter || 'all';
    const q = (UI.logQuery || '').trim();
    const pred = UI._logPred();
    const liveHtml = UI_LOG._liveBattle(G);

    const html = items
      .map((e, i) => ({ e, global: base + i }))
      .filter(({ e }) => pred(e) && (!q || e.text.indexOf(q) >= 0))
      .map(({ e, global }) => UI._logHtml(e, global >= mark))
      .join('');

    box.innerHTML = (liveHtml || '')
      + (G.over ? `<div class="l-turn fs-lead">${U.esc(G.over.text)}</div>` : '')
      + (html || `<div class="dim p-6-2">${filter === 'all' && !q ? '暂无纪事。' : '此筛选下无记录。'}</div>`);
    UI_LOG._bindLive(G);

    if (filter === 'all' && !q) UI._logMark = G.log.length;
    if (UI._logAutoScroll) box.scrollTop = box.scrollHeight;
  },

  /** 正在进行的攻城（玩家指挥）：显示轮次、双方余兵、可用战法与「继续」 */
  _liveBattle(G) {
    const army = Object.values(G.armies).find(a => a.battle);
    if (!army) return '';
    const b = army.battle;
    const city = G.cities[b.cityId];
    if (!city) return '';
    const mine = army.factionId === G.player.factionId || city.grantedTo === PLAYER_HERO_ID;
    if (!mine) return '';

    const list = Combat.tacticsFor(G, army, city);
    const btns = list.map(t => `<button class="btn tiny" data-tactic="${t.key}"
      ${t.ok ? '' : `disabled title="${U.esc(t.why || '')}"`}
      title="${U.esc(t.desc)}">${t.name}<span class="dim fs-tiny"> 士气-${t.cost}</span></button>`).join('');

    return `<div class="livebattle" data-army="${army.id}">
      <div class="lb-head">⚔ ${U.esc(city.name)}之战 · 第 ${b.round}/${Combat.MAX_ROUNDS} 合
        <span class="dim">攻 ${U.num(troopTotal(army.troops))} / 守 ${U.num(troopTotal(city.garrison))}
        · 累计折 ${U.num(b.atkLoss)} / ${U.num(b.defLoss)}</span></div>
      <div class="lb-line dim fs-tiny">${U.esc(b.lines[b.lines.length - 1] || '')}</div>
      <div class="lb-acts">${btns}
        <button class="btn" data-continue="1">继续 ▶</button>
      </div>
    </div>`;
  },

  _bindLive(G) {
    const box = UI.$('logList');
    if (!box) return;
    const card = box.querySelector('.livebattle');
    if (!card) return;
    const armyId = card.dataset.army;
    const step = tactic => {
      try { Store.dispatch('BATTLE_STEP', { armyId, tactic }); }
      catch (e) { UI.toast(e.message); }
    };
    for (const b of card.querySelectorAll('[data-tactic]')) {
      b.onclick = () => step(b.dataset.tactic);
    }
    const cont = card.querySelector('[data-continue]');
    if (cont) cont.onclick = () => step(null);
  },

  _logKey(e) { return e.turn + ':' + (e.text || '').slice(0, 14); },

  /** 一条纪事：战报渲染成可展开卡片，其余仍是单行 */
  _logHtml(e, fresh) {
    const cls = 'l-' + (e.kind || 'note') + (fresh ? ' fresh' : '');
    const b = e.data && e.data.battle;
    if (!b) return `<div class="${cls}">${U.esc(e.text)}</div>`;

    const key = UI._logKey(e);
    const open = UI._logOpen.has(key);
    const atkPct = Math.round((1 - b.atkRemain / Math.max(1, b.atkStart)) * 100);
    const defPct = Math.round((1 - b.defRemain / Math.max(1, b.defStart)) * 100);
    const body = open
      ? `<div class="bcard-body">${(e.data.lines || []).map(l => `<div>${U.esc(l)}</div>`).join('')}</div>`
      : '';

    return `<div class="bcard ${b.captured ? 'win' : 'fail'}${open ? ' open' : ''}${fresh ? ' fresh' : ''}" data-lkey="${U.esc(key)}">
      <div class="bcard-head">
        <span class="bcard-city">${U.esc(b.cityName)}</span>
        <span class="bcard-res">${b.captured ? '城破' : '不克'}</span>
        <span class="bcard-vs">${U.esc(b.atkName)} → ${U.esc(b.defName)}</span>
        <span class="bcard-rounds">${b.rounds} 合</span>
      </div>
      <div class="bcard-bar">
        <i class="atk" style="--w:${U.clamp(atkPct, 0, 100)}%"></i>
        <i class="def" style="--w:${U.clamp(defPct, 0, 100)}%"></i>
      </div>
      <div class="bcard-nums">
        <span>攻 ${U.esc(b.atkLead || '—')} 折 ${U.num(b.atkLoss)} · 余 ${U.num(b.atkRemain)}</span>
        <span>守 ${U.esc(b.defLead || '—')} 折 ${U.num(b.defLoss)} · 余 ${U.num(b.defRemain)}</span>
      </div>
      ${body}
    </div>`;
  },

  _logPred() {
    const f = UI.logFilter || 'all';
    if (f === 'battle') return e => e.kind === 'battle';
    if (f === 'event') return e => e.kind === 'good' || e.kind === 'bad';
    if (f === 'note') return e => e.kind === 'note';
    if (f === 'turn') return e => e.kind === 'turn';
    return () => true;
  },
};
