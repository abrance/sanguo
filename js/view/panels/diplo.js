// 视图层 · 外交面板与行动
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_DIPLO = {

  // ───────── 外交 ─────────
  bindDiplo() {
    UI.$('diploList').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      UI.diploAction(b.dataset.fid, b.dataset.act);
    });
  },

  diploAction(fid, act) {
    const G = Store.get();
    if (!G) return;
    const f = G.factions[fid];
    const confirmMsg = {
      pact: `与${f.name}私通密约：若被告发，上级好感 -15。继续？`,
      war: `向${f.name}宣战：天下侧目，各国关系 -4。继续？`,
      defect: `携直辖城归附${f.name}：官阶重置为县长，原势力即刻敌对，不可撤销。继续？`,
    }[act];
    if (confirmMsg && !window.confirm(confirmMsg)) return;

    try {
      if (act === 'envoy') Store.dispatch('SEND_ENVOY', { fid });
      else if (act === 'pact') Store.dispatch('SECRET_PACT', { fid });
      else if (act === 'aid') Store.dispatch('ASK_AID', { fid });
      else if (act === 'grain') Store.dispatch('BUY_GRAIN', { fid });
      else if (act === 'bribe') Store.dispatch('BRIBE_SUPERIOR');
      else if (act === 'defect') Store.dispatch('DEFECT', { fid });
      else if (act === 'war') Store.dispatch('DECLARE_WAR', { fid });
      else if (act === 'peace') Store.dispatch('SUE_FOR_PEACE', { fid });
      else if (act === 'ally') Store.dispatch('FORM_ALLIANCE', { fid });
      else if (act === 'break') Store.dispatch('BREAK_ALLIANCE', { fid });
      else if (act === 'call') Store.dispatch('CALL_TO_ARMS', { fid });
      else if (act.indexOf('p_') === 0) {
        Store.dispatch('PETITION', { fid, action: act.slice(2) });
      }
    } catch (e) { UI.toast(e.message); }
  },

  diploButtons(layer, f, st, cd, G) {
    const dis = cd ? 'disabled' : '';
    const b = (act, label, extra) =>
      `<button class="mini" data-act="${act}" data-fid="${f.id}" ${dis} ${extra || ''}>${label}</button>`;
    const out = [];

    if (layer === 'personal') {
      out.push(b('envoy', `遣使 ${PERSONAL_ACTIONS.envoy.cost}`));
      out.push(b('pact', `密约 ${PERSONAL_ACTIONS.pact.cost}`));
      out.push(b('aid', `求援 ${PERSONAL_ACTIONS.aid.cost}`));
      out.push(b('grain', `借粮 ${PERSONAL_ACTIONS.grain.cost}`));
      out.push(b('defect', '投靠'));
    } else if (layer === 'petition') {
      out.push(st === 'war' ? b('p_peace', '上表求和') : b('p_war', '上表宣战'));
      out.push(b('p_ally', '上表结盟'));
      out.push(b('p_intrigue', `上表离间 ${DIPLO_PROPOSALS.intrigue.cost}`));
    } else {
      out.push(st === 'war' ? b('peace', '罢兵求和') : b('war', '宣战'));
      if (st === 'ally') {
        out.push(b('break', '解盟'));
        out.push(b('call', '请盟出兵'));
      } else {
        out.push(b('ally', '结盟'));
      }
      out.push(b('p_intrigue', `离间 ${DIPLO_PROPOSALS.intrigue.cost}`));
    }
    return out.join('');
  },

  renderDiplo(G) {
    const list = UI.$('diploList');
    if (!list) return;

    const layer = Diplo.layer(G);
    UI.$('diploLayer').textContent = DIPLO_LAYERS[layer].name;
    UI.$('diploHint').textContent = DIPLO_LAYERS[layer].desc;

    const top = UI.$('diploTop');
    const canBribe = G.player.route !== 'independent';
    top.innerHTML = canBribe
      ? `<button class="mini" data-act="bribe" data-fid="">${PERSONAL_ACTIONS.bribe.name} ${PERSONAL_ACTIONS.bribe.cost}（上意 +12）</button>`
      : '';
    const bribe = top.querySelector('button[data-act="bribe"]');
    if (bribe) bribe.onclick = () => UI.diploAction('', 'bribe');

    const pf = G.player.factionId;
    const scroll = list.scrollTop;
    const rows = Object.values(G.factions)
      .filter(f => f.id !== 'free' && f.id !== pf && !f.dead)
      .map(f => ({ f, st: Diplo.statusOf(G, pf, f.id), rel: Diplo.relationOf(G, pf, f.id) }))
      .sort((a, b) => a.rel - b.rel);

    list.innerHTML = rows.map(({ f, st, rel }) => {
      const s = DIPLO_STATUS[st];
      const cd = Diplo.cooldownLeft(G, f.id);
      const pact = Diplo.hasPact(G, f.id);
      const pct = Math.round((rel + 100) / 2);
      return `<div class="diplo-row">
        <div class="drow1">
          <i class="csw fill" style="--fill:${f.color}"></i>
          <b>${U.esc(f.name)}</b>
          <span class="dst c" style="--c:${s.color}">${s.name}</span>
          <span class="drel">${U.signed(rel)}</span>
        </div>
        <div class="dbar"><i class="fill" style="--w:${pct}%;--fill:${s.color}"></i></div>
        <div class="drow2 dim">${s.desc}${pact ? ' · 密约在身' : ''}${cd ? ` · 使者 ${cd} 月后归` : ''}</div>
        <div class="dacts">${UI.diploButtons(layer, f, st, cd, G)}</div>
      </div>`;
    }).join('');
    list.scrollTop = scroll;
  },
};
