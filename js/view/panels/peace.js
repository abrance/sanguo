// 视图层 · 求和裁决弹窗
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_PEACE = {

  // ───────── 求和裁决（对方请和 → 强制弹窗三选一） ─────────
  bindPeace() {
    UI._peaceMode = 'offer';
    UI._peaceKey = null;
    UI._peaceDemands = { gold: 0.25, mat: 0, iron: 0, troop: 0 };
    UI._peacePcts = [0, 0.25, 0.5, 0.75, 1];
  },

  /** 每条报价都要玩家拍板：接受 / 提条件 / 不接受 */
  renderPeace(G) {
    const box = UI.$('peaceOverlay');
    // 脏报价（势力已亡/已非交战）不该卡住弹窗
    const offers = (G.peaceOffers || []).filter(o => {
      const x = G.factions[o.fid];
      return x && !x.dead && Diplo.statusOf(G, G.player.factionId, o.fid) === Diplo.WAR;
    });
    const offer = offers[0];
    if (!offer || G.over) { box.classList.add('hidden'); UI._peaceKey = null; return; }

    const f = G.factions[offer.fid];
    const key = offer.fid + ':' + offer.turn;
    if (UI._peaceKey !== key) {           // 换了一家请和：重置条件
      UI._peaceKey = key;
      UI._peaceMode = 'offer';
      UI._peaceDemands = { gold: 0.25, mat: 0, iron: 0, troop: 0 };
    }
    box.classList.remove('hidden');

    const rest = offers.length - 1;
    const war = Diplo.statusOf(G, G.player.factionId, f.id) === Diplo.WAR;
    UI.$('peaceHead').innerHTML =
      `<b class="c" style="--c:${f.color}">${U.esc(f.name)}</b> 遣使请和 · 愿纳钱 ${U.num(Math.min(f.treasury, 400))}`
      + ` · 停战 ${Diplo.TRUCE_MONTHS} 月<br><span class="dim">${war ? '战事未休' : '已非交战'}`
      + `${rest > 0 ? ` · 另有 ${rest} 国待决` : ''}</span>`;

    if (UI._peaceMode === 'offer') {
      UI.$('peaceBody').innerHTML =
        `<p class="peace-note">受则即日罢兵；提条件则当场议价，谈不拢便罢兵不成；不受则战事照旧。</p>`;
      UI.$('peaceActs').innerHTML =
        `<button class="primary" data-act="accept">接受求和</button>
         <button data-act="counter">提出条件</button>
         <button data-act="refuse">不接受</button>`;
      UI.$('peaceActs').onclick = e => {
        const act = e.target.dataset && e.target.dataset.act;
        if (!act) return;
        if (act === 'counter') { UI._peaceMode = 'demand'; UI.renderPeace(G); return; }
        UI.peaceDispatch(act === 'accept' ? 'PEACE_ACCEPT' : 'PEACE_REFUSE', { fid: f.id });
      };
      return;
    }

    // 提条件：钱 / 建材 / 铁料 / 输兵，各按百分比档位索要
    const sumOf = key => State.factionCities(G, f.id).reduce((s, c) => s + (c[key] || 0), 0);
    const strongest = State.factionCities(G, f.id)
      .map(c => troopTotal(c.garrison)).sort((a, b) => b - a)[0] || 0;
    const caps = { gold: f.treasury, mat: sumOf('mat'), iron: sumOf('iron'), troop: strongest };
    const names = { gold: '钱', mat: '建材', iron: '铁料', troop: '输兵' };

    UI.$('peaceBody').innerHTML = Object.keys(names).map(k => {
      const pcts = UI._peacePcts.map(p =>
        `<button data-k="${k}" data-p="${p}" class="${Math.abs((UI._peaceDemands[k] || 0) - p) < 1e-6 ? 'on' : ''}">${Math.round(p * 100)}%</button>`).join('');
      return `<div class="prow"><span class="pname">${names[k]}</span>`
        + `<span class="pct">${pcts}</span>`
        + `<span class="pval">${U.num(Math.round(caps[k] * (UI._peaceDemands[k] || 0)))}</span></div>`;
    }).join('')
      + `<p class="peace-note">对方眼下最多肯割 ${Math.round(Diplo.demandTolerance(G, f.id) * 100)} 分的家底。`
      + `所索过重则议和不成，战事照旧。</p>`;

    UI.$('peaceActs').innerHTML =
      `<button class="primary" data-act="submit">递价</button>
       <button data-act="back">改主意</button>`;

    UI.$('peaceBody').onclick = e => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      UI._peaceDemands[b.dataset.k] = parseFloat(b.dataset.p);
      UI.renderPeace(G);
    };
    UI.$('peaceActs').onclick = e => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'back') { UI._peaceMode = 'offer'; UI.renderPeace(G); return; }
      if (act === 'submit') UI.peaceDispatch('PEACE_COUNTER', { fid: f.id, demands: UI._peaceDemands });
    };
  },

  peaceDispatch(type, payload) {
    try {
      const res = Store.dispatch(type, payload);
      const f = Store.get().factions[payload.fid];
      if (type === 'PEACE_COUNTER') {
        UI.flash(res.accepted ? `${f.name}尽纳所求，罢兵。` : `${f.name}不肯再让，议和不成。`,
          res.accepted ? 'good' : 'bad');
      } else {
        UI.flash(type === 'PEACE_ACCEPT' ? `许${f.name}之和。` : `却${f.name}之请。`);
      }
    } catch (e) { UI.flash(e.message, 'bad'); }
  },
};
