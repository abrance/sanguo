// 视图层 · 军务面板
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_ARMY = {

  // ───────── 军务 ─────────
  renderArmy(G) {
    // 在外军队
    const box = UI.$('armyList');
    const mine = Object.values(G.armies).filter(a => a.factionId === G.player.factionId);
    const hostile = Object.values(G.armies).filter(a =>
      a.factionId !== G.player.factionId && G.cities[a.to] && G.cities[a.to].owner === G.player.factionId);

    const rows = [];
    for (const a of mine) {
      const h = a.heroId ? G.heroes[a.heroId] : null;
      rows.push(`<div class="row" data-to="${a.to}">
        <span class="rname">我方 ${h ? h.name : '兵马'}</span>
        <span class="rmeta">${ArmyCompose(a.troops)} → ${G.cities[a.to].name} ${a.eta}月</span>
      </div>`);
    }
    for (const a of hostile) {
      const f = G.factions[a.factionId];
      const h = a.heroId ? G.heroes[a.heroId] : null;
      rows.push(`<div class="row" data-to="${a.to}">
        <span class="rname" style="color:#d96a6a">${f.name} ${h ? h.name : ''}</span>
        <span class="rmeta">犯 ${G.cities[a.to].name} ${a.eta}月</span>
      </div>`);
    }
    UI.$('armyCount').textContent = mine.length + hostile.length;
    box.innerHTML = rows.join('') || '<div class="dim" style="padding:4px">无在外军队</div>';
    for (const el of box.querySelectorAll('.row[data-to]')) {
      el.onclick = () => {
        const G2 = Store.get();
        const city = G2.cities[el.dataset.to];
        if (!city) return;
        Renderer.centerOn(city.x, city.y);
        UI.selectedId = city.id;
        Renderer.selectedId = city.id;
        UI.sideTab = 'city';
        UI.syncTabs();
        UI.render(G2);
      };
    }

    // 批量操兵：直辖城多选
    const cities = State.demesne(G);
    const alive = new Set(cities.map(c => c.id));
    for (const id of Array.from(UI.selectedCities)) {
      if (!alive.has(id)) UI.selectedCities.delete(id);
    }

    const list = UI.$('cityPickList');
    list.innerHTML = cities.map(c => {
      const cap = State.troopCapOf(G, c);
      const t = troopTotal(c.garrison);
      const pct = Math.round(t / Math.max(1, cap) * 100);
      const on = UI.selectedCities.has(c.id);
      return `<div class="crow-pick ${on ? 'on' : ''}" data-city="${c.id}">
        <input type="checkbox" ${on ? 'checked' : ''} />
        <span class="cn">${c.name}${c.policy ? `<span class="dim"> · ${POLICIES[c.policy].name}</span>` : ''}</span>
        <span class="cm ${pct >= 95 ? 'cfull' : ''}">${U.num(t)}/${U.num(cap)} ${pct}%</span>
      </div>`;
    }).join('') || '<div class="dim" style="padding:4px">无直辖城</div>';

    for (const el of list.querySelectorAll('.crow-pick')) {
      const cid = el.dataset.city;
      const cb = el.querySelector('input');
      cb.onchange = () => {
        if (cb.checked) UI.selectedCities.add(cid);
        else UI.selectedCities.delete(cid);
        el.classList.toggle('on', cb.checked);
        UI.updateBatchCount();
      };
      el.onclick = (ev) => {
        if (ev.target === cb) return;
        cb.checked = !cb.checked;
        cb.onchange();
      };
    }

    // 批量按钮
    UI.$('batchAll').onclick = () => {
      for (const c of State.demesne(G)) UI.selectedCities.add(c.id);
      UI.render(G);
    };
    UI.$('batchNone').onclick = () => {
      UI.selectedCities.clear();
      UI.render(G);
    };
    UI.$('batchFill').onclick = () => {
      const ids = Array.from(UI.selectedCities);
      if (!ids.length) { UI.toast('先勾选城池'); return; }
      try { Store.dispatch('BATCH_FILL', { cityIds: ids }); }
      catch (e) { UI.toast(e.message); }
    };
    UI.$('batchDispatch').onclick = () => {
      const ids = Array.from(UI.selectedCities);
      if (!ids.length) { UI.toast('先勾选城池'); return; }
      const ratio = Number(UI.$('batchRatio').value) || 0.7;
      UI.pending = { type: 'batchDispatch', fromIds: ids, ratio };
      Renderer.targeting = true;
      UI.$('map').classList.add('targeting');
      const bh = UI.$('batchHint');
      bh.classList.remove('hidden');
      bh.style.color = '';
      bh.textContent = `已选 ${ids.length} 城，抽 ${Math.round(ratio * 100)}%。点地图上目标城池（Esc 取消）。`;
    };

    UI.updateBatchCount();
  },

  updateBatchCount() {
    const n = UI.selectedCities.size;
    const el = UI.$('batchCount');
    if (el) el.textContent = n ? `已选 ${n} 城` : '未选';
  },
};
