// 视图层 · 军区面板（一将统辖多城，全托管但听号令）
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_LEGION = {

  renderLegion(G) {
    const box = UI.$('legionBody');
    if (!box) return;
    const legions = State.legions(G);
    UI.$('legionCount').textContent = legions.length;

    // 可选都督：本方在世武将，且不在别的军区
    const used = new Set(legions.map(lg => lg.heroId));
    const heroes = Object.values(G.heroes)
      .filter(h => h.alive && h.factionId === G.player.factionId && h.id !== PLAYER_HERO_ID && !used.has(h.id))
      .sort((a, b) => (b.tong + b.zheng) - (a.tong + a.zheng))
      .slice(0, 6);

    let html = `<div class="dim mb-6 lh">
      军区每月自动营建、征兵；号令决定它打不打、打谁。都督统率 → 守城战力，政略 → 产出。
    </div>`;

    if (!legions.length) {
      html += `<div class="dim py-4">尚未设军区。</div>`;
    }

    for (const lg of legions) {
      const h = G.heroes[lg.heroId];
      const cities = State.legionCities(G, lg);
      const st = Legion.STANCES[lg.stance];
      const target = lg.targetFid && G.factions[lg.targetFid] ? G.factions[lg.targetFid] : null;

      html += `<div class="lgcard" data-lg="${lg.id}">
        <div class="lghead">
          <b>${U.esc(h ? h.name : '—')}</b>
          <span class="dim">统 ${h ? h.tong : '—'} · 政 ${h ? h.zheng : '—'}</span>
          <span class="dim">${cities.length} 城</span>
          <span class="dim ml-auto">出兵 ${lg.stats ? lg.stats.attacks : 0} · 拔城 ${lg.stats ? lg.stats.taken : 0}</span>
        </div>
        <div class="lgrow"><span class="lglab">号令</span>
          ${Object.values(Legion.STANCES).map(s =>
            `<button class="mini ${lg.stance === s.id ? 'on' : ''}" data-order="${s.id}" title="${U.esc(s.desc)}">${s.name}</button>`).join('')}
        </div>
        ${lg.stance === 'strike' ? `<div class="lgrow"><span class="lglab">征讨</span>
          ${Object.values(G.factions)
            .filter(f => f.id !== 'free' && f.id !== G.player.factionId && !f.dead)
            .sort((x, y) => (y.treasury || 0) - (x.treasury || 0))
            .slice(0, 8)
            .map(f => `<button class="mini ${lg.targetFid === f.id ? 'on' : ''}" data-target="${f.id}">${U.esc(f.name)}</button>`).join('')}
        </div>` : ''}
        <div class="lgrow"><span class="lglab">方针</span>
          ${Object.keys(POLICIES).map(k =>
            `<button class="mini ${lg.policy === k ? 'on' : ''}" data-pol="${k}" title="${U.esc(POLICIES[k].desc)}">${POLICIES[k].name}</button>`).join('')}
        </div>
        <div class="lgrow"><span class="lglab">辖城</span>
          ${State.demesne(G).map(c => {
            const inIt = lg.cityIds.indexOf(c.id) >= 0;
            const other = State.legionOf(G, c.id);
            const locked = other && other.id !== lg.id;
            return `<button class="mini ${inIt ? 'on' : ''}" data-city="${c.id}" ${locked ? 'disabled' : ''}
              title="${locked ? '已在其他军区' : U.esc(c.name)}">${U.esc(c.name)}</button>`;
          }).join('')}
        </div>
        <div class="lgacts">
          <button class="mini" data-act="delete">裁撤军区</button>
        </div>
      </div>`;
    }

    if (heroes.length) {
      html += `<div class="dim my-8-3">委任新都督</div><div class="lgrow">`
        + heroes.map(h => `<button class="mini" data-new="${h.id}">${U.esc(h.name)}</button>`).join('')
        + `</div>`;
    } else if (legions.length) {
      html += `<div class="dim mt-8">无可委任的将领。</div>`;
    }

    box.innerHTML = html;

    box.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const card = e.target.closest('.lgcard');
      const lgId = card && card.dataset.lg;
      const G2 = Store.get();
      try {
        if (b.dataset.new) {
          const r = Store.dispatch('LEGION_CREATE', { heroId: b.dataset.new });
          UI.flash(`已委${G2.heroes[b.dataset.new].name}为都督。`);
          return r;
        }
        if (!lgId) return;

        if (b.dataset.act === 'delete') {
          Store.dispatch('LEGION_DELETE', { id: lgId });
          UI.flash('军区已裁撤。');
          return;
        }
        if (b.dataset.order) {
          const lg = State.legions(G2).find(x => x.id === lgId);
          if (b.dataset.order === 'strike') {
            const enemies = Object.keys(G2.factions).filter(fid => fid !== 'free'
              && fid !== G2.player.factionId && !G2.factions[fid].dead);
            const first = (lg && lg.targetFid) || enemies[0];
            if (!first) throw new Error('无可征讨之敌');
            Store.dispatch('LEGION_ORDER', { id: lgId, stance: 'strike', targetFid: first });
            UI.flash(`号令：征讨${G2.factions[first].name}，可在下方换目标`);
          } else {
            Store.dispatch('LEGION_ORDER', { id: lgId, stance: b.dataset.order });
            UI.flash(`号令：${Legion.STANCES[b.dataset.order].name}`);
          }
          return;
        }
        if (b.dataset.target) {
          Store.dispatch('LEGION_ORDER', { id: lgId, stance: 'strike', targetFid: b.dataset.target });
          UI.flash(`号令：征讨${G2.factions[b.dataset.target].name}`);
          return;
        }
        if (b.dataset.pol) {
          Store.dispatch('LEGION_ORDER', { id: lgId, policy: b.dataset.pol });
          UI.flash(`军区方针：${POLICIES[b.dataset.pol].name}`);
          return;
        }
        if (b.dataset.city) {
          const lg = State.legions(G2).find(x => x.id === lgId);
          // 老存档里可能有已不直辖的残留辖城：按当前直辖过滤掉，顺手把军区列表扶正
          const ids = lg.cityIds.filter(id => State.isPlayerCity(G2, G2.cities[id]));
          const i = ids.indexOf(b.dataset.city);
          if (i >= 0) ids.splice(i, 1); else ids.push(b.dataset.city);
          Store.dispatch('LEGION_ASSIGN', { id: lgId, cityIds: ids });
          return;
        }
      } catch (err) { UI.flash(err.message, 'bad'); }
    };
  },
};
