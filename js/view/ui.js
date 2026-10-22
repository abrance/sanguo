// 视图层：侧栏 / 起始界面 / 交互
const UI = {

  selectedId: null,
  pending: null,
  selectedCities: new Set(),
  sideTab: 'city',
  cityTab: 'overview',
  _startFaction: null,
  _startCity: null,
  _logAutoScroll: true,

  $: id => document.getElementById(id),

  init() {
    UI.bindMap();
    UI.bindButtons();
    UI.bindTabs();
    UI.bindRankHall();
    UI.bindDiplo();
    UI.buildStart();
    UI.resizeCanvasSoon();
  },

  resizeCanvasSoon() { requestAnimationFrame(() => Renderer.resize()); },

  // ───────── 起始界面 ─────────
  buildStart() {
    const list = UI.$('factionPick');
    list.innerHTML = '';

    const rows = FACTION_ROWS.filter(r => r[5].length > 0);
    rows.sort((a, b) => b[5].length - a[5].length);

    for (const [id, name, color, rulerId, , cityIds] of rows) {
      const ruler = HERO_ROWS.find(h => h[0] === rulerId);
      const el = document.createElement('div');
      el.className = 'pick';
      el.dataset.fid = id;
      el.innerHTML = `<i class="csw" style="background:${color}"></i>
        <span>${U.esc(name)}</span>
        <span class="pk-meta">${cityIds.length}城</span>`;
      el.title = ruler ? `君主：${ruler[1]}` : '';
      el.onclick = () => UI.pickFaction(id);
      list.appendChild(el);
    }

    UI.pickFaction('caocao');
    UI.$('btnStart').onclick = UI.doStart;
  },

  pickFaction(fid) {
    UI._startFaction = fid;
    UI._startCity = null;

    const cur = FACTION_ROWS.find(r => r[0] === fid);
    for (const el of UI.$('factionPick').children) {
      el.classList.toggle('on', el.dataset.fid === fid);
    }

    const cityList = UI.$('cityPick');
    cityList.innerHTML = '';
    const cities = cur[5].map(id => CITY_ROWS.find(r => r[0] === id)).filter(Boolean);
    cities.sort((a, b) => b[6] - a[6]);

    for (const row of cities) {
      const [id, name, , , terrain, region, pop] = row;
      const el = document.createElement('div');
      el.className = 'pick';
      el.dataset.cid = id;
      el.innerHTML = `<span>${U.esc(name)}</span>
        <span class="pk-meta">${region}·${TERRAIN[terrain].name}·${pop}</span>`;
      el.onclick = () => UI.pickCity(id);
      cityList.appendChild(el);
    }

    if (cities.length) UI.pickCity(cities[0][0]);
    UI.refreshStartBtn();
  },

  pickCity(cid) {
    UI._startCity = cid;
    for (const el of UI.$('cityPick').children) {
      el.classList.toggle('on', el.dataset.cid === cid);
    }
    UI.refreshStartBtn();
  },

  refreshStartBtn() {
    UI.$('btnStart').disabled = !(UI._startFaction && UI._startCity);
  },

  doStart() {
    const name = (UI.$('playerName').value || '无名').trim().slice(0, 8) || '无名';
    localStorage.removeItem(Save.key(DEFAULT_SCENARIO));
    const G = State.create({
      scenarioId: DEFAULT_SCENARIO,
      factionId: UI._startFaction,
      cityId: UI._startCity,
      playerName: name,
      seed: Date.now(),
    });
    UI.$('startOverlay').classList.add('hidden');
    Store.init(G);
    Renderer.attach(G);
    UI.selectedId = G.player.homeCityId;
    Renderer.selectedId = UI.selectedId;
    Renderer.cam.zoom = 0.72;
    UI.sideTab = 'city';
    UI.cityTab = 'overview';
    UI.syncTabs();
    UI.render(G);
    Save.save(G);
  },

  // ───────── 标签页 ─────────
  bindTabs() {
    for (const btn of UI.$('sideTabs').querySelectorAll('button')) {
      btn.onclick = () => {
        UI.sideTab = btn.dataset.tab;
        UI.syncTabs();
        UI.render(Store.get());
      };
    }
    for (const btn of UI.$('cityTabs').querySelectorAll('button')) {
      btn.onclick = () => {
        UI.cityTab = btn.dataset.ctab;
        UI.syncTabs();
        UI.render(Store.get());
      };
    }
  },

  syncTabs() {
    for (const btn of UI.$('sideTabs').querySelectorAll('button')) {
      btn.classList.toggle('on', btn.dataset.tab === UI.sideTab);
    }
    for (const id of ['tabCity', 'tabArmy', 'tabTech', 'tabDiplo', 'tabLog']) {
      UI.$(id).classList.add('hidden');
    }
    const map = { city: 'tabCity', army: 'tabArmy', tech: 'tabTech', diplo: 'tabDiplo', log: 'tabLog' };
    UI.$(map[UI.sideTab]).classList.remove('hidden');

    for (const btn of UI.$('cityTabs').querySelectorAll('button')) {
      btn.classList.toggle('on', btn.dataset.ctab === UI.cityTab);
    }
  },

  // ───────── 地图交互 ─────────
  bindMap() {
    const cv = UI.$('map');
    let dragging = false;
    let lastX = 0, lastY = 0, moved = 0;

    cv.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      cv.classList.add('dragging');
    });

    window.addEventListener('mousemove', e => {
      const G = Store.get();
      if (!G) return;
      const r = cv.getBoundingClientRect();

      if (dragging) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        moved += Math.abs(dx) + Math.abs(dy);
        Renderer.panBy(dx, dy);
        return;
      }

      const hit = Renderer.pick(G, e.clientX - r.left, e.clientY - r.top);
      const prev = Renderer.hoverId;
      Renderer.hoverId = hit ? hit.id : null;
      if (UI.pending && hit && hit.id !== prev) UI.showTargetHint(hit);
    });

    window.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      cv.classList.remove('dragging');
      if (moved > 6) return;

      const G = Store.get();
      if (!G) return;
      const r = cv.getBoundingClientRect();
      const hit = Renderer.pick(G, e.clientX - r.left, e.clientY - r.top);
      if (hit) UI.onCityClick(hit);
    });

    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const before = Renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
      Renderer.zoomBy(e.deltaY > 0 ? 0.88 : 1.14);
      const after = Renderer.toWorld(e.clientX - r.left, e.clientY - r.top);
      Renderer.cam.x += before.x - after.x;
      Renderer.cam.y += before.y - after.y;
    }, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && UI.pending) UI.cancelPending();
    });
  },

  onCityClick(city) {
    const G = Store.get();

    if (UI.pending && UI.pending.type === 'batchDispatch') {
      const p = UI.pending;
      if (!UI.confirmBackstab(city)) return;
      UI.pending = null;
      Renderer.targeting = false;
      UI.$('map').classList.remove('targeting');
      try {
        Store.dispatch('BATCH_DISPATCH', { cityIds: p.fromIds, toId: city.id, ratio: p.ratio });
      } catch (e) { UI.toast(e.message); }
      UI.render(Store.get());
      return;
    }

    if (UI.pending && UI.pending.type === 'rally') {
      const p = UI.pending;
      if (city.owner !== G.player.factionId
          && !Diplo.canAttack(G, G.player.factionId, city.owner)) {
        UI.toast(`${city.name}非交战之城，持续调兵只对敌城或本方城有效。`);
        return;
      }
      UI.pending = null;
      Renderer.targeting = false;
      UI.$('map').classList.remove('targeting');
      try {
        Store.dispatch('SET_RALLY', { cityId: p.fromId, toId: city.id, ratio: p.ratio, keep: p.keep, fill: p.fill });
      } catch (e) { UI.toast(e.message); }
      UI.render(Store.get());
      return;
    }

    if (UI.pending && UI.pending.type === 'dispatch') {
      const fromId = UI.pending.fromId;
      if (city.id === fromId) { UI.toast('目标即出发地'); return; }
      if (!UI.confirmBackstab(city)) return;
      const ratio = UI.pending.ratio;
      UI.cancelPending();
      try {
        Store.dispatch('DISPATCH', { fromId, toId: city.id, ratio });
        UI.selectedId = fromId;
        Renderer.selectedId = fromId;
      } catch (err) {
        UI.toast(err.message);
      }
      return;
    }
    UI.selectedId = city.id;
    Renderer.selectedId = city.id;
    if (UI.sideTab !== 'city') { UI.sideTab = 'city'; UI.syncTabs(); }
    UI.render(G);
  },

  showTargetHint(city) {
    const G = Store.get();
    if (!G || !UI.pending) return;
    if (UI.pending.type === 'rally') {
      const p = UI.pending;
      const from = G.cities[p.fromId];
      const hint = UI.$('selHint');
      const prev = { rallyRatio: p.ratio, rallyFill: p.fill };
      const est = Rally.estimate(G, Object.assign({}, from, prev), city.id);
      const same = city.owner === G.player.factionId;
      hint.classList.remove('hidden');
      hint.style.color = same ? '#9a8c76' : '#e0b93a';
      hint.textContent = `持续调兵至 ${city.name}：每月约 ${U.num(est)} 兵（抽 ${Math.round(p.ratio * 100)}%）`
        + (same ? '' : ' · 该城非本方，将作为持续进攻');
      return;
    }

    if (UI.pending.type === 'batchDispatch') {
      const p = UI.pending;
      const hint = UI.$('batchHint');
      hint.classList.remove('hidden');
      let total = 0, armies = 0;
      for (const id of p.fromIds) {
        const c = G.cities[id];
        if (!c) continue;
        total += Math.floor(troopTotal(c.garrison) * p.ratio);
        armies++;
      }
      const same = city.owner === G.player.factionId;
      hint.style.color = same ? '#9a8c76' : '#e0b93a';
      hint.textContent = `${same ? '合兵至' : '合攻'} ${city.name}：${armies} 路约 ${U.num(total)} 兵`;
      return;
    }

    const hint = UI.$('selHint');
    const from = G.cities[UI.pending.fromId];
    if (!from) return;

    const plan = Army.previewDispatch(from, UI.pending.ratio);
    const total = troopTotal(plan);
    hint.classList.remove('hidden');

    if (city.owner === G.player.factionId) {
      const same = city.grantedTo === PLAYER_HERO_ID;
      hint.style.color = '#9a8c76';
      hint.textContent = `增援 ${city.name}：输送 ${U.num(total)}（${same ? '你直辖之城' : '同势力城池'}，直接并入）`;
      return;
    }

    const f = G.factions[city.owner];
    const pred = Combat.predict(G, plan, from.governor, city, G.player.factionId, State.bld(from, 'drill'));
    hint.style.color = pred.win ? '#7fb37f' : '#d96a6a';
    hint.textContent = `攻 ${city.name}（${f ? f.name : '—'}）：预计${pred.win ? '可克' : '难克'}，`
      + `余兵约 ${U.num(pred.remain)}/${U.num(total)}`;
  },

  /** 对非交战势力出兵＝背刺，付出前必须让人看清代价 */
  confirmBackstab(city) {
    const G = Store.get();
    if (!G || !city.owner || city.owner === G.player.factionId || city.owner === 'free') return true;
    if (Diplo.canAttack(G, G.player.factionId, city.owner)) return true;
    const f = G.factions[city.owner];
    const st = DIPLO_STATUS[Diplo.statusOf(G, G.player.factionId, city.owner)];
    return window.confirm(
      `未宣战即攻${f ? f.name : ''}之${city.name}（现为${st ? st.name : '中立'}）＝背刺：\n\n`
      + '· 天下关系 -12，对方永久记仇（不再结盟）\n'
      + '· 君主好感 -20，声望 -15\n\n确定？');
  },

  cancelPending() {
    UI.pending = null;
    Renderer.targeting = false;
    UI.$('map').classList.remove('targeting');
    const bh = UI.$('batchHint');
    if (bh) { bh.classList.add('hidden'); bh.textContent = ''; }
    UI.render(Store.get());
  },

  toast(msg) {
    const G = Store.get();
    if (!G) return;
    State.log(G, 'note', msg);
    UI.render(G);
  },

  // ───────── 按钮 ─────────
  bindButtons() {
    UI.$('btnEndTurn').onclick = () => {
      try {
        Store.dispatch('END_TURN');
        Save.save(Store.get());
      } catch (e) { UI.toast(e.message); }
    };

    UI.$('btnSave').onclick = () => {
      const G = Store.get();
      if (!G) return;
      UI.toast(Save.save(G) ? '已存档。' : '存档失败（存储不可用）');
    };

    UI.$('btnLoad').onclick = () => {
      let G = Save.load(DEFAULT_SCENARIO);
      if (!G) { UI.toast('无存档。'); return; }
      G = State.migrate(G);
      Store.replace(G);
      Renderer.attach(G);
      UI.selectedId = G.player.homeCityId;
      Renderer.selectedId = UI.selectedId;
      UI.toast('已读档。');
    };

    UI.$('btnNew').onclick = () => {
      UI.$('startOverlay').classList.remove('hidden');
    };

    UI.$('zoomIn').onclick = () => Renderer.zoomBy(1.25);
    UI.$('zoomOut').onclick = () => Renderer.zoomBy(0.8);
    UI.$('zoomReset').onclick = () => {
      const G = Store.get();
      Renderer.cam.zoom = 0.55;
      if (G) {
        const h = G.cities[G.player.homeCityId];
        if (h) Renderer.centerOn(h.x, h.y);
      }
    };

    UI.$('logClear').onclick = () => {
      const G = Store.get();
      if (!G) return;
      G.log.length = 0;
      UI.render(G);
    };

    UI.$('logList').addEventListener('scroll', () => {
      const el = UI.$('logList');
      UI._logAutoScroll = el.scrollTop + el.clientHeight > el.scrollHeight - 40;
    });
  },

  // ───────── 主渲染 ─────────
  render(G) {
    if (!G) return;

    const s = U.season(G.meta.month);
    UI.$('dateText').textContent = `${G.meta.year}年 ${G.meta.month}月`;
    UI.$('turnText').textContent = `第 ${G.meta.turn} 回合 · ${SEASON[s].name}`;
    UI.$('resFood').textContent = U.num(State.playerFood(G));
    UI.$('resGold').textContent = U.num(State.playerGold(G));
    UI.$('resTroop').textContent = U.num(State.playerTroops(G));
    UI.$('resMat').textContent = U.num(State.playerMat(G));
    UI.$('resIron').textContent = U.num(State.playerIron(G));
    const rpInc = State.playerRPIncome(G);
    UI.$('resRP').textContent = '+' + rpInc.toFixed(1) + '/月';
    UI.$('resRP').title = `科研产出 ${rpInc.toFixed(1)}/月 · 未分配库存 ${State.playerRP(G)}`;

    const rk = rankOf(G.player.rank);
    const route = ROUTES[G.player.route];
    UI.$('rankName').textContent = rk.name;
    UI.$('rankRoute').textContent = route.name;
    UI.$('rankRoute').style.color = route.color;

    const need = meritThreshold(G.player);
    const prev = G.player.rank > 1 ? rankOf(G.player.rank - 1).meritNeeded : 0;
    const shown = G.player.rank >= RANKS.length
      ? 100
      : U.clamp((G.player.merit - prev) / Math.max(1, need - prev), 0, 1) * 100;
    UI.$('meritFill').style.width = shown + '%';
    UI.$('meritVal').textContent = G.player.merit;
    UI.$('meritNext').textContent = isFinite(need) ? need : '—';
    UI.$('repVal').textContent = Math.round(G.player.reputation);

    const f = G.factions[G.player.factionId];
    UI.$('factionLine').textContent = f ? f.name : '—';
    UI.$('demesneVal').textContent = G.player.demesne.length;
    UI.$('demesneCap').textContent = cityCap(G.player);
    UI.$('favorVal').textContent = Math.round(G.player.favor == null ? 60 : G.player.favor);

    UI.renderMissionLine(G);
    UI.renderSel(G);
    UI.renderArmy(G);
    UI.renderTech(G);
    UI.renderDiplo(G);
    UI.renderLog(G);

    UI.$('btnEndTurn').disabled = !!G.over;
    UI.$('btnEndTurn').textContent = G.over
      ? (G.over.result === 'win' ? '天下一统' : '势力覆亡')
      : '结束回合';

    if (!UI.$('rankOverlay').classList.contains('hidden')) UI.renderRankHall(G);
  },

  // ───────── 上命（侧栏一行） ─────────
  renderMissionLine(G) {
    const el = UI.$('missionLine');
    const p = G.player;
    const m = p.mission;

    if (!m) {
      el.className = 'mission-line';
      if (p.route === 'independent') el.textContent = '自立之身，不受上命。';
      else if (p.missionCooldown > 0) el.textContent = `上命暂歇（${p.missionCooldown} 月后再遣）。`;
      else el.textContent = '上命将至。';
      return;
    }
    const left = Mission.left(m, G);
    el.className = 'mission-line' + (left <= 2 ? ' warn' : '');
    el.textContent = `【${m.title}】${Mission.text(m, G)} · 限 ${left} 月 · 战功 +${m.rewardMerit}`;
  },

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
      mbox.innerHTML = `
        <div class="mtitle">${U.esc(m.title)}</div>
        <div class="mtext">${U.esc(Mission.text(m, G))}</div>
        <div class="mmeta">限 ${left} 月 · 战功 +${m.rewardMerit} · 上意 +${m.rewardFavor}</div>
        <div class="mbtns">
          ${isExp
            ? `<span class="dim" style="font-size:10px">于城池面板出兵攻取该城，克则自动复命</span>`
            : `<button class="go" id="btnMissionFulfil">${m.typeKey === 'tribute' ? '如约上缴' : '点兵输送'}</button>`}
          <button class="danger" id="btnMissionDecline">抗命不遵</button>
        </div>`;
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
          <i class="csw" style="background:${f.color}"></i>
          <b>${U.esc(f.name)}</b>
          <span class="dst" style="color:${s.color}">${s.name}</span>
          <span class="drel">${Math.round(rel)}</span>
        </div>
        <div class="dbar"><i style="width:${pct}%;background:${s.color}"></i></div>
        <div class="drow2 dim">${s.desc}${pact ? ' · 密约在身' : ''}${cd ? ` · 使者 ${cd} 月后归` : ''}</div>
        <div class="dacts">${UI.diploButtons(layer, f, st, cd, G)}</div>
      </div>`;
    }).join('');
    list.scrollTop = scroll;
  },

  // ───────── 城池面板 ─────────
  renderSel(G) {
    const panel = UI.$('selPanel');
    const noSel = UI.$('noSel');
    const c = UI.selectedId ? G.cities[UI.selectedId] : null;

    if (!c) {
      panel.classList.add('hidden');
      noSel.classList.remove('hidden');
      return;
    }
    panel.classList.remove('hidden');
    noSel.classList.add('hidden');

    const f = G.factions[c.owner];
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const gov = c.governor ? G.heroes[c.governor] : null;

    UI.$('selName').textContent = c.name;
    const ownerEl = UI.$('selOwner');
    ownerEl.textContent = (f ? f.name : '—') + (isDemesne ? ' · 直辖' : '');
    ownerEl.style.color = f ? f.color : '';

    UI.$('selSub').textContent =
      `${c.region} · ${TERRAIN[c.terrain].name}`
      + (gov ? ` · 守将 ${gov.name}` : ' · 无守将')
      + (c.policy ? ` · ${POLICIES[c.policy].name}` : '')
      + (() => {
          if (!c.rallyTo || !G.cities[c.rallyTo]) return '';
          const st = Rally.status(G, c);
          const tag = st.code === 'moving' ? '（送）' : st.code === 'full' ? '（满）'
            : st.code === 'low' ? '（兵少）' : st.code === 'ready' ? '（待发）' : '';
          return ` · 补给→${G.cities[c.rallyTo].name}${tag}`;
        })();

    const hint = UI.$('selHint');
    if (UI.pending && UI.pending.type === 'dispatch') {
      hint.classList.remove('hidden');
      hint.style.color = '';
      hint.textContent = `已选 ${G.cities[UI.pending.fromId].name}，抽兵 ${Math.round(UI.pending.ratio * 100)}%。点地图上目标城池进军（悬停看胜算）。`;
    } else {
      hint.classList.add('hidden');
    }

    const pane = UI.$('cityPane');
    const scroll = pane.scrollTop;
    if (UI.cityTab === 'build') UI.paneBuild(G, c);
    else if (UI.cityTab === 'clans') UI.paneClans(G, c);
    else if (UI.cityTab === 'policy') UI.panePolicy(G, c);
    else UI.paneOverview(G, c);
    pane.scrollTop = scroll;
  },

  _statGrid(rows) {
    return rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
  },

  _btn(label, sub, onclick, reason) {
    const b = document.createElement('button');
    b.innerHTML = sub ? `${label}<span class="dim" style="font-size:9px"> ${sub}</span>` : label;
    if (reason) { b.disabled = true; b.title = reason; }
    b.onclick = onclick;
    return b;
  },

  paneOverview(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const caps = State.troopCapByType(G, c);
    const capTotal = State.troopCapOf(G, c);
    const total = troopTotal(c.garrison);
    const season = SEASON[U.season(G.meta.month)];
    const clanSat = Math.round(State.clanSat(c));

    const rows = [
      ['丁口 / 户籍', `${Math.round(c.pop)} / ${State.popMaxOf(G, c)}`],
      ['治安', `${Math.round(c.order)}`],
      ['城墙', `${c.wall.toFixed(1)} / ${State.wallMaxOf(c)}`],
      ['士族', `${clanSat}`],
      ['城库钱', U.num(c.gold)],
      ['存粮', `${U.num(c.food)} / ${U.num(State.foodCapOf(G, c))}`],
      ['建材', U.num(c.mat)],
      ['铁料', U.num(c.iron)],
      ['驻军', `${U.num(total)} / ${U.num(capTotal)}`],
      ['月产粮', U.num(State.bld(c, 'farm') * 50 * season.food)],
      ['月产钱', U.num(State.bld(c, 'market') * 20 * season.tax)],
    ];

    let html = `<div class="statgrid">${UI._statGrid(rows)}</div>`;

    html += `<div class="seclabel">驻军 / 兵种兵额</div>`;
    html += `<div class="statgrid">${TROOP_KEYS.map(k =>
      `<span class="k">${TROOPS[k].short}</span><span class="v">${U.num(c.garrison[k] || 0)}<span class="dim"> / ${U.num(caps[k])}</span></span>`
    ).join('')}</div>`;

    // 兵额推导（与校验同一份公式）
    const bd = State.troopCapBreakdown(G, c);
    html += `<div class="seclabel">兵额上限从哪来</div>`;
    html += `<div class="capformula">`
      + `户籍 ${U.num(bd.hukou)} × (1.9 + 农田 ${bd.farm} × 0.9) = <b>${U.num(Math.round(bd.popBase))}</b><br>`
      + `× 治安 ${bd.orderMul.toFixed(2)}　× 兵营(${bd.barracks}) ${bd.barracksMul.toFixed(2)}<br>`
      + `× 校场(${bd.drill}) ${bd.drillMul.toFixed(2)}　× 士族(心${Math.round(bd.clanSat)}) ${bd.clanMul.toFixed(2)}<br>`
      + `× 科技 ${bd.techMul.toFixed(2)}　= <b style="color:#e0b93a">${U.num(bd.total)}</b>`
      + `</div>`;
    html += `<div class="capnote">兵额 = <b>户籍 × 农田</b> 打底，再乘治安、兵营、校场、士族满意度、军制科技。`
      + `户籍靠建造<b>府衙</b>与农政科技提升。<br>`
      + `征兵只消耗<b>丁口</b>（影响钱粮产出，每月回升），<b>不动户籍</b>，所以不会越征上限越低。<br>`
      + `骑兵另需<b>马场</b>（每级 +12% 骑兵额），水军另需<b>船坞</b>，器械受<b>冶铁坊</b>加成。</div>`;

    if (c.buildQueue.length) {
      html += `<div style="margin-top:6px;font-size:10px;color:var(--ink-dim)">在建</div>`;
      for (const j of c.buildQueue) {
        const pct = Math.round((1 - j.left / j.total) * 100);
        html += `<div class="qrow"><span>${BUILDINGS[j.key].name}→${j.to}</span>
          <div class="qbar"><div style="width:${pct}%"></div></div>
          <span class="dim">${j.left}月</span></div>`;
      }
    }

    pane.innerHTML = html;

    const box = document.createElement('div');
    box.className = 'actions';

    if (!isDemesne) {
      box.innerHTML = c.owner === G.player.factionId
        ? `<span class="dim">本方势力城池 · 非你直辖，不可建设（可派兵增援）</span>`
        : `<span class="dim">${total > 0 ? '敌军城池' : '空城'}</span>`;
      pane.appendChild(box);
      return;
    }
    if (G.over) {
      box.innerHTML = `<span class="dim">战局已终</span>`;
      pane.appendChild(box);
      return;
    }

    // 一键补兵
    if (total < capTotal) {
      box.appendChild(UI._btn('一键补兵', `缺口 ${U.num(capTotal - total)}`, () => {
        try { Store.dispatch('FILL_TROOPS', { cityId: c.id, ratio: 1 }); }
        catch (e) { UI.toast(e.message); }
      }, null));
    }

    // 征兵（按钮上直接标出 钱 / 人口 双成本）
    const defs = [['inf', 300], ['inf', 800], ['arc', 300], ['cav', 300]];
    if (State.bld(c, 'shipyard') > 0) defs.push(['nvy', 300]);
    if (State.bld(c, 'ironworks') > 0) defs.push(['siege', 150]);

    for (const [troop, amt] of defs) {
      let reason = null;
      try { Recruit.check(G, c, troop, amt); } catch (e) { reason = e.message; }
      const cost = Economy.recruitCost(amt, troop);
      box.appendChild(UI._btn(`募${TROOPS[troop].short}${amt}`,
        reason ? reason : `${cost.gold}钱 ${cost.pop}口`, () => {
        try { Store.dispatch('RECRUIT', { cityId: c.id, troop, amount: amt }); }
        catch (e) { UI.toast(e.message); }
      }, reason));
    }

    const sep = document.createElement('div');
    sep.style.cssText = 'flex-basis:100%;height:0';
    box.appendChild(sep);

    if (total >= 20) {
      for (const r of [0.3, 0.5, 0.7, 0.9]) {
        box.appendChild(UI._btn(`出兵 ${Math.round(r * 100)}%`, null, () => {
          UI.pending = { type: 'dispatch', fromId: c.id, ratio: r };
          Renderer.targeting = true;
          UI.$('map').classList.add('targeting');
          UI.render(G);
        }));
      }
    } else {
      box.innerHTML += `<span class="dim">兵力不足，无法出征</span>`;
    }

    pane.appendChild(box);
  },

  paneBuild(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const free = Build.queueFree(c);
    const slots = State.buildSlots(c);

    let html = `<div class="dim" style="margin-bottom:4px">工程位 ${c.buildQueue.length}/${slots}`
      + `${slots > 1 ? '（府衙 3 级）' : '（府衙 3 级可并行 2 项）'}</div>`;

    if (c.buildQueue.length) {
      c.buildQueue.forEach((j, i) => {
        const pct = Math.round((1 - j.left / j.total) * 100);
        html += `<div class="qrow">
          <span style="min-width:74px">${BUILDINGS[j.key].name}→${j.to}</span>
          <div class="qbar"><div style="width:${pct}%"></div></div>
          <span class="dim">${j.left}月</span>
          ${isDemesne ? `<button class="mini" data-cancel="${i}">撤</button>` : ''}
        </div>`;
      });
    }

    html += `<div style="margin:6px 0 3px;font-size:10px;color:var(--ink-dim)">可营造</div>`;

    for (const key of BUILDING_KEYS) {
      const d = BUILDINGS[key];
      const lv = State.bld(c, key);
      const maxed = lv >= d.max;
      let reason = null;
      if (!isDemesne) reason = '非你直辖之城';
      else if (G.over) reason = '战局已终';
      else {
        const chk = Build.canBuild(G, c, key);
        if (!chk.ok) reason = chk.why;
      }
      const cost = Build.costOf(G, c, key);
      const turns = Build.turnsOf(G, key, lv);

      const costTxt = maxed ? '—'
        : `${cost.gold}钱 ${cost.mat}料${cost.iron ? ' ' + cost.iron + '铁' : ''}`;

      html += `<div class="brow ${maxed ? 'maxed' : (reason ? 'locked' : '')}" title="${U.esc(d.desc)}｜${U.esc(d.effect(Math.max(1, lv)))}">
        <span class="bname">${d.name}</span>
        <span class="blv">${lv}/${d.max}</span>
        <span class="bcost">${costTxt}</span>
        <button data-build="${key}" ${(maxed || reason) ? 'disabled' : ''} title="${U.esc(reason || `工期 ${turns} 月`)}">${maxed ? '满' : `${turns}月`}</button>
      </div>`;
    }

    pane.innerHTML = html;

    for (const b of pane.querySelectorAll('button[data-build]')) {
      b.onclick = () => {
        try { Store.dispatch('BUILD', { cityId: c.id, key: b.dataset.build }); }
        catch (e) { UI.toast(e.message); }
      };
    }
    for (const b of pane.querySelectorAll('button[data-cancel]')) {
      b.onclick = () => {
        try { Store.dispatch('CANCEL_BUILD', { cityId: c.id, index: Number(b.dataset.cancel) }); }
        catch (e) { UI.toast(e.message); }
      };
    }
  },

  paneClans(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const sat = State.clanSat(c);

    if (!c.clans || !c.clans.length) {
      pane.innerHTML = `<div class="dim">此城无大族。</div>`;
      return;
    }

    let html = `<div class="dim" style="margin-bottom:5px">
      士族均心 <b style="color:${sat > 60 ? '#7fb37f' : sat > 40 ? '#c9a227' : '#d96a6a'}">${Math.round(sat)}</b>
      · 钱粮产出 ×${State.clanEconMul(c).toFixed(2)}
      · 兵额战力 ×${State.clanMilMul(c).toFixed(2)}
    </div>`;

    for (const cl of c.clans) {
      html += `<div class="clan">
        <div class="crow">
          <span class="cname">${U.esc(cl.name)}</span>
          <span class="dim">心 ${Math.round(cl.sat)} · 势 ${Math.round(cl.inf)}</span>
        </div>
        <div class="barbox">
          <span class="dim" style="font-size:9px">心</span>
          <div class="bar sat"><div style="width:${Math.round(cl.sat)}%"></div></div>
          <span class="dim" style="font-size:9px">势</span>
          <div class="bar inf"><div style="width:${Math.round(cl.inf)}%"></div></div>
        </div>
      </div>`;
    }

    html += `<div class="dim" style="margin-top:6px;line-height:1.6">
      均心低于 28 且影响力高时，有叛乱之虞（折兵、掠库、治安大跌）。<br>
      战乱邻近、兵额过载、断粮都会压低士气。
    </div>`;

    pane.innerHTML = html;

    const box = document.createElement('div');
    box.className = 'actions';

    if (!isDemesne) {
      box.innerHTML = `<span class="dim">非你直辖之城</span>`;
      pane.appendChild(box);
      return;
    }
    if (G.over) {
      box.innerHTML = `<span class="dim">战局已终</span>`;
      pane.appendChild(box);
      return;
    }

    const cool = c.clanActionTurn ? Math.max(0, 3 - (G.meta.turn - c.clanActionTurn)) : 0;
    const coolMsg = cool > 0 ? `士族新定，尚需 ${cool} 月方可再动` : null;

    const act = (kind, label, sub, checkReason) => {
      box.appendChild(UI._btn(label, sub, () => {
        try { Store.dispatch('CLAN_ACTION', { cityId: c.id, action: kind }); }
        catch (e) { UI.toast(e.message); }
      }, coolMsg || checkReason));
    };

    act('pacify', '安抚', '200钱 120粮', c.gold < 200 ? '钱不足' : c.food < 120 ? '粮不足' : null);
    act('recruit', '征辟', '500钱', c.gold < 500 ? '钱不足' : null);
    act('suppress', '打压', '免费', null);

    pane.appendChild(box);
  },

  panePolicy(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const gov = c.governor ? G.heroes[c.governor] : null;
    const caps = State.troopCapByType(G, c);

    let html = `<div class="statgrid">${UI._statGrid([
      ['守将', gov ? `${gov.name}（统 ${gov.tong}）` : '无'],
      ['当前方针', c.policy ? POLICIES[c.policy].name : '未委任（亲理）'],
      ['兵额上限', U.num(State.troopCapOf(G, c))],
      ['工程位', State.buildSlots(c)],
      ['步/弓', `${U.num(caps.inf)} / ${U.num(caps.arc)}`],
      ['骑/水/器', `${U.num(caps.cav)} / ${U.num(caps.nvy)} / ${U.num(caps.siege)}`],
    ])}</div>`;

    html += `<div class="dim" style="margin-top:8px;line-height:1.6">
      委任太守后，每月自动按方营造、征兵，不必逐一手动。<br>
      你仍可随时手动操作同一座城，二者叠加。
    </div>`;

    // 持续调兵（补给线）
    const rTarget = c.rallyTo ? G.cities[c.rallyTo] : null;
    html += `<div class="seclabel">持续调兵（补给线）</div>`;
    if (rTarget) {
      const st = Rally.status(G, c);
      const d = Rally.detail(G, c, rTarget.id);
      const stColor = st.code === 'moving' ? '#9ecf9e'
        : st.code === 'ready' ? '#e0b93a'
        : st.code === 'full' ? '#c9a227' : '#d96a6a';

      html += `<div class="capformula" style="border-color:#3f6a3f">
        补给目标 <b style="color:#9ecf9e">${rTarget.name}</b>
        ${rTarget.owner === G.player.factionId ? '（同势力，到即并入）' : '（敌方，持续进攻）'}
        <div class="rallymath">
          本城 ${U.num(d.total)} 兵 ÷ 兵额 ${U.num(d.cap)}　（保护下限 ${U.num(d.keep)}）<br>
          · 抽 ${Math.round(d.ratio * 100)}% → 可送 <b>${U.num(d.byRatio)}</b>
          ${d.bind === 'ratio' ? '<span class="bindtag">← 生效</span>' : ''}<br>
          · 扣掉保护下限 → 可送 <b>${U.num(d.byKeep)}</b>
          ${d.bind === 'keep' ? '<span class="bindtag">← 生效</span>' : ''}<br>
          · 目标剩余容量 → <b>${U.num(Math.round(Math.min(d.room, 99999)))}</b>
          ${d.bind === 'room' ? '<span class="bindtag">← 生效</span>' : ''}
        </div>
        ${d.bind === 'keep' && d.send > 0
          ? `<div class="dim" style="margin-top:3px;color:#c9a227">本城兵只比保护下限多 ${U.num(d.total - d.keep)}，实际送出受此限制。想多送先募兵。</div>`
          : ''}
        <div style="margin-top:5px;color:${stColor};font-size:11px">● ${U.esc(st.text)}</div>
      </div>`;
    } else {
      html += `<div class="capnote">未设定。设定后每月自动把本城兵力送往目标城 —— 后方向前线输送、或持续骚扰敌城。<br>
        抽得越狠送得越快，但本城会被抽空；后方城建议<strong>同时设「备战」方针</strong>，太守每月募兵回血，才能形成不断的流水。</div>`;
    }

    html += `<div class="batchbar" style="margin-top:6px">
      <span class="dim" style="font-size:10px">每月送走本城</span>
      <select class="mini" id="rallyRatio">
        ${[0.1, 0.2, 0.35, 0.5, 0.7, 0.9].map(v => `<option value="${v}" ${Math.abs((c.rallyRatio || 0.5) - v) < 0.01 ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}
      </select>
      <span class="dim" style="font-size:10px">补至目标兵额</span>
      <select class="mini" id="rallyFill">
        ${[1, 1.2, 1.5, 2].map(v => `<option value="${v}" ${Math.abs((c.rallyFill || 1.2) - v) < 0.01 ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}
      </select>
    </div>`;

    pane.innerHTML = html;

    // 比例即时生效（已设目标时）
    const bindRallySelects = () => {
      const rs = UI.$('rallyRatio'), rf = UI.$('rallyFill');
      if (!rs) return;
      const push = () => {
        if (!c.rallyTo) return;
        try {
          Store.dispatch('SET_RALLY', {
            cityId: c.id, toId: c.rallyTo,
            ratio: Number(rs.value),
            fill: rf ? Number(rf.value) : undefined,
          });
        } catch (e) { UI.toast(e.message); }
      };
      rs.onchange = push;
      if (rf) rf.onchange = push;
    };
    bindRallySelects();

    const box = document.createElement('div');
    box.className = 'actions';

    if (!isDemesne) {
      box.innerHTML = `<span class="dim">非你直辖之城</span>`;
      pane.appendChild(box);
      return;
    }

    for (const key of POLICY_KEYS) {
      const P = POLICIES[key];
      const on = c.policy === key;
      const b = UI._btn(`${P.name}${on ? ' ✓' : ''}`, null, () => {
        try { Store.dispatch('SET_POLICY', { cityId: c.id, policy: on ? null : key }); }
        catch (e) { UI.toast(e.message); }
      });
      b.title = P.desc;
      if (on) b.style.borderColor = '#c9a227';
      box.appendChild(b);
    }

    const sep = document.createElement('div');
    sep.style.cssText = 'flex-basis:100%;height:0';
    box.appendChild(sep);

    if (c.policy) {
      box.appendChild(UI._btn('罢委任', null, () => {
        try { Store.dispatch('SET_POLICY', { cityId: c.id, policy: null }); }
        catch (e) { UI.toast(e.message); }
      }));
    }

    const sep2 = document.createElement('div');
    sep2.style.cssText = 'flex-basis:100%;height:0';
    box.appendChild(sep2);

    const ratioSel = UI.$('rallyRatio');
    const fillSel = UI.$('rallyFill');

    box.appendChild(UI._btn(c.rallyTo ? '改调兵目标' : '设持续调兵 → 点地图', null, () => {
      UI.pending = {
        type: 'rally',
        fromId: c.id,
        ratio: ratioSel ? Number(ratioSel.value) : (c.rallyRatio || 0.5),
        fill: fillSel ? Number(fillSel.value) : (c.rallyFill || 1.2),
      };
      Renderer.targeting = true;
      UI.$('map').classList.add('targeting');
      UI.render(G);
    }));

    if (c.rallyTo) {
      box.appendChild(UI._btn('罢持续调兵', null, () => {
        try { Store.dispatch('SET_RALLY', { cityId: c.id, toId: null }); }
        catch (e) { UI.toast(e.message); }
      }));
    }

    pane.appendChild(box);
  },

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

  // ───────── 科技 ─────────
  renderTech(G) {
    const f = G.factions[G.player.factionId];
    const cur = f.tech.current;
    const queue = f.tech.queue || [];
    const rate = TechSys.rate(G, G.player.factionId);
    const body = UI.$('techBody');
    const scroll = body.scrollTop;

    UI.$('techCurrent').textContent = cur
      ? `${TECHS[cur.key].name} ${Math.round((1 - cur.left / cur.total) * 100)}%`
      : `空闲 · ${Math.floor(f.tech.rp)} 点`;

    let html = `<div class="techrate">
      产出 <b>${rate.toFixed(1)}</b> 点/月 · 库存 <b>${Math.floor(f.tech.rp)}</b>
      · 已研 <b>${TechSys.doneList(f).length}/${TECH_KEYS.length}</b>
    </div>`;

    if (cur) {
      const pct = Math.round((1 - cur.left / cur.total) * 100);
      const eta = TechSys.eta(G, G.player.factionId, cur);
      const color = BRANCH_COLOR[TECHS[cur.key].branch];
      html += `<div class="techcur" style="border-left:3px solid ${color}">
        <div class="tcrow">
          <span style="color:${color}">研习中 · ${TECHS[cur.key].name}</span>
          <span class="dim">${Math.ceil(cur.left)}/${cur.total} 点 · 约 ${eta} 月</span>
        </div>
        <div class="qbar"><div style="width:${pct}%"></div></div>
      </div>`;
    } else {
      html += `<div class="dim" style="margin:6px 0">当前无研习项目，点下方「研」开工或排队。</div>`;
    }

    if (queue.length) {
      html += `<div class="techqueue">队列 `
        + queue.map(e => `<span class="qpill">${TECHS[e.key].name}<button data-unsched="${e.key}" title="移出队列">×</button></span>`).join('')
        + `</div>`;
    }

    for (const br of TECH_BRANCHES) {
      const list = TECH_KEYS.filter(k => TECHS[k].branch === br)
        .sort((a, b) => TECHS[a].tier - TECHS[b].tier);
      if (!list.length) continue;

      const doneN = list.filter(k => f.tech.done[k]).length;
      html += `<div class="tbranch">
        <div class="tbranch-head">
          <span style="color:${BRANCH_COLOR[br]}">${br}</span>
          <span class="dim" style="font-size:9px">${doneN}/${list.length}</span>
        </div>`;

      for (const key of list) {
        const t = TECHS[key];
        const done = !!f.tech.done[key];
        const isCur = cur && cur.key === key;
        const inQ = queue.some(e => e.key === key);
        const avail = TechSys.available(f, key);
        const cls = done ? 'done' : isCur ? 'cur' : inQ ? 'queued' : avail ? '' : 'locked';

        let stateTxt;
        if (done) stateTxt = '已成';
        else if (isCur) stateTxt = '研习中';
        else if (inQ) stateTxt = '排队中';
        else if (avail) {
          const eta = Math.max(1, Math.ceil(t.cost / Math.max(0.1, rate)));
          stateTxt = `${t.cost} 点 · 约 ${eta} 月`;
        } else stateTxt = `${t.cost} 点`;

        html += `<div class="titem ${cls}" title="${U.esc(t.desc)}">
          <span class="tname">${done ? '✓ ' : ''}${t.name}</span>
          <span class="tcost">${stateTxt}</span>
          ${(!done && !isCur && !inQ && avail)
            ? `<button class="mini" data-tech="${key}">研</button>` : ''}
        </div>`;
      }
      html += `</div>`;
    }

    html += `<div class="capnote" style="margin-top:8px">
      科研点由<b>学宫</b>产出：每级 6 点/月，另加守将政治加成。无学宫之城仅 0.8 点/月。<br>
      可连续点「研」排入队列，最多 ${TechSys.MAX_QUEUE} 项。
    </div>`;

    body.innerHTML = html;
    body.scrollTop = scroll;

    for (const b of body.querySelectorAll('button[data-tech]')) {
      b.onclick = () => {
        try { Store.dispatch('RESEARCH', { key: b.dataset.tech }); }
        catch (e) { UI.toast(e.message); }
      };
    }
    for (const b of body.querySelectorAll('button[data-unsched]')) {
      b.onclick = () => {
        try { Store.dispatch('UNSCHEDULE_TECH', { key: b.dataset.unsched }); }
        catch (e) { UI.toast(e.message); }
      };
    }
  },

  // ───────── 纪事 ─────────
  renderLog(G) {
    const box = UI.$('logList');
    const items = G.log.slice(-160);
    const html = items.map(e =>
      `<div class="l-${e.kind || 'note'}">${U.esc(e.text)}</div>`).join('');

    box.innerHTML = (G.over
      ? `<div class="l-turn" style="font-size:14px">${U.esc(G.over.text)}</div>`
      : '') + html;

    if (UI._logAutoScroll) box.scrollTop = box.scrollHeight;
  },
};
