// 视图层 · 军区面板（一将统辖多城，全托管但听号令）
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_LEGION = {

  /** 本方城按州分组：[[州, [城...]], ...] */
  _provinceGroups(G) {
    const m = new Map();
    for (const c of Object.values(G.cities)) {
      if (c.owner !== G.player.factionId) continue;
      if (!m.has(c.region)) m.set(c.region, []);
      m.get(c.region).push(c);
    }
    return [...m.entries()];
  },

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
      辖城可以是直辖城，也可以是属下治理的城 —— 后者交给都督代管，比自己一城城点更省事。<br>
      辖城按钮就是开关：<b>✓</b> 已归该军区（再点一下即移出），<b>＋</b> 尚未归入（点一下归入）。
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
          ${lg.targetFid ? '' : '<span class="dim">未定目标（只打已交战与在野）</span>'}
          ${Object.values(G.factions)
            .filter(f => f.id !== 'free' && f.id !== G.player.factionId && !f.dead)
            .sort((x, y) => (Diplo.statusOf(G, G.player.factionId, y.id) === Diplo.WAR ? 1 : 0)
              - (Diplo.statusOf(G, G.player.factionId, x.id) === Diplo.WAR ? 1 : 0)
              || (y.treasury || 0) - (x.treasury || 0))
            .map(f => `<button class="mini ${lg.targetFid === f.id ? 'on' : ''}" data-target="${f.id}">${U.esc(f.name)}</button>`).join('')}
        </div>` : ''}
        <div class="lgrow"><span class="lglab">方针</span>
          ${Object.keys(POLICIES).map(k =>
            `<button class="mini ${lg.policy === k ? 'on' : ''}" data-pol="${k}" title="${U.esc(POLICIES[k].desc)}">${POLICIES[k].name}</button>`).join('')}
        </div>
        <div class="lgrow"><span class="lglab">辖城</span>
          ${Object.values(G.cities)
            .filter(c => c.owner === G.player.factionId)
            .sort((x, y) => (y.grantedTo === PLAYER_HERO_ID ? 1 : 0) - (x.grantedTo === PLAYER_HERO_ID ? 1 : 0))
            .map(c => {
              const inIt = lg.cityIds.indexOf(c.id) >= 0;
              const other = State.legionOf(G, c.id);
              const locked = other && other.id !== lg.id;
              const direct = c.grantedTo === PLAYER_HERO_ID;
              // 开关式：✓ 已在军区（点一下移出），＋ 未入军区（点一下归入）
              return `<button class="mini lgchip ${inIt ? 'on' : ''}" data-city="${c.id}" ${locked ? 'disabled' : ''}
                title="${locked ? '已在其他军区' : U.esc((inIt ? '点击移出军区：' : '点击归入军区：') + c.name + (direct ? '（直辖）' : '（属下治理）'))}"
                >${inIt ? '✓' : '＋'} ${U.esc(c.name)}${direct ? '·直' : ''}</button>`;
            }).join('')}
          ${lg.cityIds.length ? `<button class="mini" data-act="clear" title="把这座军区的辖城全部移出（城本身不变，只是不再由都督代管）">全部移出</button>` : ''}
        </div>
        <div class="lgrow"><span class="lglab">整州</span>
          ${UI_LEGION._provinceGroups(G).map(([region, list]) => {
              // 只算「还没入这家军区、也没被别家占着」的城
              const free = list.filter(c => {
                if (lg.cityIds.indexOf(c.id) >= 0) return false;
                const o = State.legionOf(G, c.id);
                return !o || o.id === lg.id;
              });
              return free.length
                ? `<button class="mini" data-reg="${U.esc(region)}"
                     title="把${U.esc(region)}的本方城一次全交给这位都督">${U.esc(region)} +${free.length}</button>`
                : '';
            }).join('') || '<span class="dim">本方城已尽入军区</span>'}
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
            // 不替玩家选目标：点名才宣战（旧逻辑会直接挑排序第一的势力开战）
            const keep = lg ? lg.targetFid : null;
            Store.dispatch('LEGION_ORDER', { id: lgId, stance: 'strike', targetFid: keep });
            UI.flash(keep
              ? `号令：征讨${G2.factions[keep].name}`
              : '号令：征讨 —— 在下方点一个势力定目标；未定目标前只打已交战势力与在野之城');
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
        if (b.dataset.reg) {
          const lg = State.legions(G2).find(x => x.id === lgId);
          const region = b.dataset.reg;
          const ids = lg.cityIds.filter(id => State.isOwnCity(G2, G2.cities[id]));
          for (const c of Object.values(G2.cities)) {
            if (c.owner !== G2.player.factionId || c.region !== region) continue;
            const other = State.legionOf(G2, c.id);
            if (other && other.id !== lgId) continue;   // 已在别家军区，不抢
            if (ids.indexOf(c.id) < 0) ids.push(c.id);
          }
          Store.dispatch('LEGION_ASSIGN', { id: lgId, cityIds: ids });
          UI.flash(`${region} ${ids.length} 城归入军区。`);
          return;
        }
        if (b.dataset.act === 'clear') {
          Store.dispatch('LEGION_ASSIGN', { id: lgId, cityIds: [] });
          UI.flash('军区辖城已全部移出（城仍归你，改由太守/AI 代管）。');
          return;
        }
        if (b.dataset.city) {
          const lg = State.legions(G2).find(x => x.id === lgId);
          // 老存档里可能有已失守的残留辖城：按当前本方城池过滤掉，顺手把军区列表扶正
          const ids = lg.cityIds.filter(id => State.isOwnCity(G2, G2.cities[id]));
          const i = ids.indexOf(b.dataset.city);
          const out = i >= 0;
          if (out) ids.splice(i, 1); else ids.push(b.dataset.city);
          Store.dispatch('LEGION_ASSIGN', { id: lgId, cityIds: ids });
          const city = G2.cities[b.dataset.city];
          UI.flash(`${city ? city.name : '该城'}${out ? '已移出' : '已归入'}军区。`);
          return;
        }
      } catch (err) { UI.flash(err.message, 'bad'); }
    };
  },
};
