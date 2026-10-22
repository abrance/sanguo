// 视图层 · 官阶台
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_RANK = {

  // ───────── 官阶台 ─────────
  bindRankHall() {
    UI.$('btnRankHall').onclick = () => {
      UI.$('rankOverlay').classList.remove('hidden');
      UI.renderRankHall(Store.get());
    };
    UI.$('btnRankClose').onclick = () => {
      UI.$('rankOverlay').classList.add('hidden');
    };
  },

  _canIndependence(G) {
    const p = G.player;
    return p.route !== 'independent'
      && p.rank >= INDEPENDENCE.minRank
      && p.demesne.length >= INDEPENDENCE.minCities
      && p.reputation >= INDEPENDENCE.minReputation;
  },

  renderRankHall(G) {
    if (!G) return;
    const p = G.player;
    const route = ROUTES[p.route];
    const need = meritThreshold(p);
    const f = G.factions[p.factionId];

    // 摘要
    UI.$('rankSummary').innerHTML = [
      `势力 <b>${f ? f.name : '—'}</b>`,
      `官阶 <b>${rankOf(p.rank).name}${p.route === 'independent' ? '（自立之主）' : ''}</b>`,
      `战功 <b>${p.merit}</b>${isFinite(need) ? ' / ' + need : ''}`,
      `声望 <b>${Math.round(p.reputation)}</b>`,
      `直辖 <b>${p.demesne.length}/${cityCap(p)}</b>`,
      `上意 <b>${Math.round(p.favor == null ? 60 : p.favor)}</b>`,
      `路线 <b style="color:${route.color}">${route.name}</b>`,
    ].map(x => `<span>${x}</span>`).join('');

    // 官阶阶梯
    UI.$('rankLadder').innerHTML = RANKS.map(r => {
      const cls = r.lvl === p.rank ? 'cur' : r.lvl < p.rank ? 'past' : '';
      const capTxt = r.lvl === p.rank ? `直辖 ${cityCap(p)}` : `直辖 ${r.maxCities}`;
      return `<div class="ladder-row ${cls}">
        <span class="lv">${r.lvl}</span>
        <span class="nm">${r.name}</span>
        <span class="need">${r.meritNeeded} 战功</span>
        <span class="cap">${capTxt}</span>
        <span class="ul">${r.unlock.join(' · ') || '—'}</span>
      </div>`;
    }).join('');

    // 路线卡
    const canIndep = UI._canIndependence(G);
    const cards = [];
    for (const key of ['loyal', 'dominant', 'independent']) {
      const r = ROUTES[key];
      const on = p.route === key;
      let locked = false, reason = '';
      if (p.route === 'independent' && !on) { locked = true; reason = '既已自立'; }
      else if (key === 'dominant' && p.rank < 2) { locked = true; reason = '需太守以上'; }
      else if (key === 'independent' && !on) {
        if (p.rank < INDEPENDENCE.minRank) { locked = true; reason = `需${rankOf(INDEPENDENCE.minRank).name}`; }
        else if (p.demesne.length < INDEPENDENCE.minCities) { locked = true; reason = `需 ${INDEPENDENCE.minCities} 城`; }
        else if (p.reputation < INDEPENDENCE.minReputation) { locked = true; reason = `声望 ${INDEPENDENCE.minReputation}`; }
        else if (!canIndep) { locked = true; reason = '条件不足'; }
      }

      cards.push(`<div class="rcard ${on ? 'on' : ''} ${locked ? 'locked' : ''}" data-route="${key}">
        <h4 style="color:${r.color}">${r.name}${on ? ' · 现行' : ''}</h4>
        <div class="bl">${r.buff.map(x => `<div>${U.esc(x)}</div>`).join('')}</div>
        <div class="dl">${r.debuff.map(x => `<div>${U.esc(x)}</div>`).join('')}</div>
        ${locked ? `<div class="dim" style="margin-top:4px">${reason}</div>` : ''}
        ${key === 'independent' && !on && canIndep ? `<div style="margin-top:5px;color:#e0998f">点击举兵自立</div>` : ''}
      </div>`);
    }
    UI.$('routeCards').innerHTML = cards.join('');

    for (const el of UI.$('routeCards').querySelectorAll('.rcard')) {
      const key = el.dataset.route;
      if (el.classList.contains('locked') || el.classList.contains('on')) continue;
      el.onclick = () => {
        if (key === 'independent') {
          if (!window.confirm('举兵自立将脱离现势力，原势力即刻兴兵来讨。确定？')) return;
          try { Store.dispatch('DECLARE_INDEPENDENCE'); } catch (e) { UI.toast(e.message); }
        } else {
          try { Store.dispatch('SET_ROUTE', { route: key }); } catch (e) { UI.toast(e.message); }
        }
      };
    }

    // 上命
    const m = p.mission;
    const mbox = UI.$('missionBox');
    if (p.route === 'independent') {
      mbox.innerHTML = `<div class="mtext">自立之身，不再受任何人差遣。</div>`;
    } else if (!m) {
      mbox.innerHTML = `<div class="mtext">${p.missionCooldown > 0
        ? `上命暂歇，${p.missionCooldown} 月后另有差遣。`
        : '暂无上命。'}</div>`;
    } else {
      const left = Mission.left(m, G);
      const isExp = m.typeKey === 'expedition';
      const total = Math.max(1, m.expireTurn - (m.issueTurn == null ? m.expireTurn - left : m.issueTurn));
      const pct = U.clamp((left / total) * 100, 0, 100);
      const target = m.targetCityId && G.cities[m.targetCityId];
      mbox.innerHTML = `
        <div class="mtitle">${U.esc(m.title)}</div>
        <div class="mtext">${U.esc(Mission.text(m, G))}</div>
        <div class="mbar ${left <= 2 ? 'warn' : ''}"><i style="width:${pct.toFixed(0)}%"></i></div>
        <div class="mmeta">限 ${left}/${total} 月 · 战功 ${U.signed(m.rewardMerit)} · 上意 ${U.signed(m.rewardFavor)}</div>
        <div class="mbtns">
          ${target ? `<button id="btnMissionLocate">定位${U.esc(target.name)}</button>` : ''}
          ${isExp
            ? `<span class="dim" style="font-size:10px">于城池面板出兵攻取该城，克则自动复命</span>`
            : (m.typeKey === 'envoy' || m.typeKey === 'intrigue')
              ? `<span class="dim" style="font-size:10px">关系指标达成后自动复命</span>`
              : `<button class="go" id="btnMissionFulfil">${m.typeKey === 'tribute' ? '如约上缴' : '点兵输送'}</button>`}
          <button class="danger" id="btnMissionDecline">抗命不遵</button>
        </div>`;
      const bl = UI.$('btnMissionLocate');
      if (bl) bl.onclick = () => UI.locateCity(target.id);
      const bf = UI.$('btnMissionFulfil');
      if (bf) bf.onclick = () => {
        try { Store.dispatch('FULFILL_MISSION'); } catch (e) { UI.toast(e.message); }
      };
      UI.$('btnMissionDecline').onclick = () => {
        if (!window.confirm('抗命将大损上级好感与战功。确定？')) return;
        try { Store.dispatch('DECLINE_MISSION'); } catch (e) { UI.toast(e.message); }
      };
    }

    // 权柄（权臣专属）
    const step = UI.$('powerStep');
    if (p.route !== 'dominant' || p.rank < 3) {
      step.classList.add('hidden');
    } else {
      step.classList.remove('hidden');
      const others = State.factionCities(G, p.factionId)
        .filter(c => c.grantedTo !== PLAYER_HERO_ID);
      const home = G.cities[p.homeCityId] || State.demesne(G)[0];
      const cool = p.domActionTurn ? Math.max(0, 2 - (G.meta.turn - p.domActionTurn)) : 0;

      if (!others.length) {
        UI.$('powerBox').innerHTML = `<div>同僚无城可征。</div>`;
      } else {
        const opts = others.map(c =>
          `<option value="${c.id}">${c.name}（兵 ${U.num(troopTotal(c.garrison))} · 钱 ${U.num(c.gold)}）</option>`).join('');
        UI.$('powerBox').innerHTML = `
          <div class="prow">
            <select id="selDomCity">${opts}</select>
          </div>
          <div class="prow">
            <button id="btnLevy" ${cool ? 'disabled' : ''}>征调四成兵${home ? ' → ' + home.name : ''}</button>
            <button id="btnSkim" ${cool ? 'disabled' : ''}>截留四成税</button>
          </div>
          ${cool ? `<div class="dim">权柄初用，需 ${cool} 月再动。</div>` : ''}`;

        const chosen = () => UI.$('selDomCity').value;
        const btnL = UI.$('btnLevy');
        const btnS = UI.$('btnSkim');
        if (btnL && home) btnL.onclick = () => {
          try { Store.dispatch('LEVY_TROOPS', { fromCityId: chosen(), toCityId: home.id }); }
          catch (e) { UI.toast(e.message); }
        };
        if (btnS) btnS.onclick = () => {
          try { Store.dispatch('SKIM_TAX', { cityId: chosen() }); }
          catch (e) { UI.toast(e.message); }
        };
      }
    }
  },
};
