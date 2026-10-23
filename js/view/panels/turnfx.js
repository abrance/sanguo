// 视图层 · 回合过场（docs/VISUAL.md §11.3）
// 360ms 时间轴：遮罩 → 月份牌 → 季节色调 → 收起；点击/空格可跳过，减少动效时只留一闪。
const UI_TURNFX = {

  TIMELINE: { veilIn: 0, card: 60, tint: 160, out: 320, done: 360 },

  bindTurnFx() {
    UI.$('turnOverlay').onclick = () => UI_TURNFX.skip();
    document.addEventListener('keydown', e => {
      if (e.key === ' ' && !UI.$('turnOverlay').classList.contains('hidden')) {
        e.preventDefault();
        UI_TURNFX.skip();
      }
    });
  },

  /** 过场：G 是推进后的状态（用来取年月与季节） */
  play(G) {
    const box = UI.$('turnOverlay');
    if (!box || !G) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const season = SEASON[U.season(G.meta.month)];

    UI.$('turnMonth').textContent = `${G.meta.year}年 ${G.meta.month}月`;
    UI.$('turnSeason').textContent = `${season.name} · ${SCENARIO_LABEL(G)}`;
    UI_TURNFX._applyTint(G);

    box.classList.remove('hidden', 'out');
    box.classList.toggle('reduced', !!reduced);
    if (reduced) {
      UI_TURNFX._timer = setTimeout(() => UI_TURNFX.finish(), 120);
      return;
    }
    UI_TURNFX._timer = setTimeout(() => UI_TURNFX.finish(), UI_TURNFX.TIMELINE.done);
  },

  /** 跳过：立刻收起（不吞输入） */
  skip() {
    if (UI.$('turnOverlay').classList.contains('hidden')) return;
    clearTimeout(UI_TURNFX._timer);
    UI_TURNFX.finish();
  },

  finish() {
    const box = UI.$('turnOverlay');
    if (!box) return;
    box.classList.add('out');
    setTimeout(() => box.classList.add('hidden'), 90);
  },

  /** 季节色调：整图上一次 0.10 的薄色（换季时玩家能"看见"时间） */
  _applyTint(G) {
    const tint = UI.$('seasonTint');
    if (!tint) return;
    tint.className = 'season-' + U.season(G.meta.month);
  },
};

/** 剧本名（标题里带一句，读档换剧本时也能一眼认出） */
function SCENARIO_LABEL(G) {
  const sc = SCENARIOS[G.meta.scenarioId];
  return sc ? sc.name : '';
}
