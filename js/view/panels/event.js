// 视图层 · 事件卡（docs/EVENTS.md §6）
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_EVENT = {

  bindEvent() {
    UI._evKey = null;
    document.addEventListener('keydown', e => {
      const cur = Store.get() && EventSys.current(Store.get());
      if (!cur) return;
      if (e.key === 'Escape') return;                 // 必须选一个，不许 Esc 溜走
      const n = parseInt(e.key, 10);
      if (!n || n < 1 || n > 9) return;
      const opts = EventSys.options(Store.get());
      const pick = opts[n - 1];
      if (!pick || !pick.ok) return;
      e.preventDefault();
      UI.eventChoose(pick.key);
    });
  },

  /** 有事件就弹卡；选项当场写明代价，不可选写原因 */
  renderEvent(G) {
    const box = UI.$('eventOverlay');
    if (!box) return;
    const cur = G.over ? null : EventSys.current(G);
    if (!cur) { box.classList.add('hidden'); UI._evKey = null; return; }

    const { item, ev, ctx } = cur;
    const key = ev.id + ':' + (item.cityId || '') + ':' + ev.name;
    box.classList.remove('hidden');

    const text = ev.text || {};
    UI.$('evTitle').textContent = text.title || ev.name;
    UI.$('evSource').textContent = text.source || '';
    UI.$('evPortrait').textContent = portraitGlyph(text.portrait);

    const body = typeof text.body === 'function' ? text.body(G, ctx) : (text.body || '');
    UI.$('evBody').innerHTML = `<p>${U.esc(body)}</p>`
      + (ctx.city ? `<div class="dim fs-tiny">${U.esc(ctx.city.name)} · 治安 ${Math.round(ctx.city.order)} · 粮 ${U.num(ctx.city.food)} · 钱 ${U.num(ctx.city.gold)}</div>` : '');

    const opts = EventSys.options(G);
    const acts = UI.$('evActs');
    acts.innerHTML = opts.map((o, i) => `<button data-opt="${o.key}" class="${o.ok ? '' : 'is-off'}"
      ${o.ok ? '' : `disabled title="${U.esc(o.why || '')}"`}>
      <span class="dim fs-tiny">${i + 1}</span> ${U.esc(o.label)}
      <span class="dim fs-tiny">${U.esc(o.costText || '')}</span>
      ${o.ok ? '' : `<span class="dim fs-tiny">（${U.esc(o.why || '不可选')}）</span>`}
    </button>`).join('');
    acts.onclick = e => {
      const b = e.target.closest('button[data-opt]');
      if (!b || b.disabled) return;
      UI.eventChoose(b.dataset.opt);
    };

    UI._evKey = key;
  },

  eventChoose(optionKey) {
    try { Store.dispatch('EVENT_CHOICE', { optionKey }); }
    catch (e) { UI.toast(e.message); }
  },
};

/** 事件卡的剪影：程序化字形，不依赖素材（docs/EVENTS.md §6.2） */
function portraitGlyph(kind) {
  return {
    locust: '蝗', refugee: '流', scholar: '贤', plague: '疫', flood: '水',
    capital: '京', seal: '玺', edict: '诏', defector: '降', duel: '斗',
    nightraid: '夜', steppe: '漠', bride: '婚', accuser: '劾', comet: '星',
  }[kind] || '事';
}
