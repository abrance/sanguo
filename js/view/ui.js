// 视图层核心：状态、地图交互、主渲染、按钮绑定
// 面板按域拆在 js/view/panels/，末尾统一装配进 UI（保持单一命名空间，调用点不变）
const UI = {

  selectedId: null,
  pending: null,
  selectedCities: new Set(),
  sideTab: 'city',
  cityTab: 'overview',
  _startFaction: null,
  _startCity: null,
  _startTalent: 'merchant',
  _logAutoScroll: true,
  _logOpen: new Set(),      // 展开的战报卡（key = 回合+摘要）
  _hist: [],          // 顶栏 12 月趋势采样（纯视图，不进存档）
  _histTurn: null,

  $: id => document.getElementById(id),

  init() {
    UI.bindMap();
    UI.bindButtons();
    UI.bindTabs();
    UI.bindRankHall();
    UI.bindDiplo();
    UI.bindPeace();
    Bus.on('combat', e => Renderer.addFx(e));
    UI.buildStart();
    UI.resizeCanvasSoon();
  },

  resizeCanvasSoon() { requestAnimationFrame(() => Renderer.resize()); },

  /** 跳到某座城：选中 + 居中 + 切到城池页 */
  locateCity(cityId) {
    const G = Store.get();
    const c = G && G.cities[cityId];
    if (!c) return;
    UI.selectedId = c.id;
    Renderer.selectedId = c.id;
    if (Renderer.cam.zoom < 0.7) Renderer.cam.zoom = 0.9;
    Renderer.flyTo(c.x, c.y, 320);
    if (UI.sideTab !== 'city') { UI.sideTab = 'city'; UI.syncTabs(); }
    UI.render(G);
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
    for (const id of ['tabCity', 'tabArmy', 'tabTech', 'tabLegion', 'tabDiplo', 'tabLog']) {
      UI.$(id).classList.add('hidden');
    }
    const map = {
      city: 'tabCity', army: 'tabArmy', tech: 'tabTech',
      legion: 'tabLegion', diplo: 'tabDiplo', log: 'tabLog',
    };
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
      UI._panV = null;
      UI._panAt = 0;
      Renderer._inertia = null;
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

        // 记录末速（相机单位/帧），松手后按它滑一段
        const now = performance.now();
        const dtms = Math.max(4, now - (UI._panAt || now - 16));
        UI._panAt = now;
        UI._panV = {
          vx: (-dx / Renderer.cam.zoom) / dtms * 16,
          vy: (-dy / Renderer.cam.zoom) / dtms * 16,
        };
        return;
      }

      const hit = Renderer.pick(G, e.clientX - r.left, e.clientY - r.top);
      const prev = Renderer.hoverId;
      Renderer.hoverId = hit ? hit.id : null;
      if (UI.pending && hit && hit.id !== prev) UI.showTargetHint(hit);
      if (UI.pending) UI.hideCityTip();
      else UI.showCityTip(hit, e.clientX, e.clientY);
    });

    cv.addEventListener('mouseleave', () => {
      Renderer.hoverId = null;
      UI.hideCityTip();
    });

    // 小地图：点/拖即跳转视野
    const mini = UI.$('minimap');
    if (mini) {
      const worldOf = e => {
        const r = mini.getBoundingClientRect();
        return {
          x: U.clamp((e.clientX - r.left) / r.width * GameMap.W, 0, GameMap.W),
          y: U.clamp((e.clientY - r.top) / r.height * GameMap.H, 0, GameMap.H),
        };
      };
      mini.addEventListener('mousedown', e => {
        e.preventDefault();
        UI._miniDrag = true;
        const w = worldOf(e);
        Renderer.flyTo(w.x, w.y, 240);            // 点一下：缓动飞过去
      });
      window.addEventListener('mousemove', e => {
        if (!UI._miniDrag) return;
        UI.hideCityTip();
        const w = worldOf(e);                      // 按住拖：直跟，不叠加动画
        Renderer._fly = null;
        Renderer.cam.x = w.x;
        Renderer.cam.y = w.y;
      });
      window.addEventListener('mouseup', () => { UI._miniDrag = false; });
    }

    window.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      cv.classList.remove('dragging');

      // 甩动：速度够快就滑行一段（惯性）
      if (moved > 6) {
        const v = UI._panV;
        if (v && Math.hypot(v.vx, v.vy) > 1.2) Renderer._inertia = { vx: v.vx, vy: v.vy };
        return;
      }

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
      if (e.key === 'Escape') UI.$('helpOverlay').classList.add('hidden');
      // ← → 在直辖城之间切换，省得回地图点
      const t = e.target;
      const typing = t && t.matches && t.matches('input,textarea,select');
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing) {
        if (UI.cycleCity(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault();
      }
    });
  },

  onCityClick(city) {
    const G = Store.get();
    UI.hideCityTip();

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
    if (G) {
      State.log(G, 'note', msg);
      UI.render(G);
    }
    UI.flash(msg);
  },

  /** 地图上方的浮层提示（不写纪事，不打断操作） */
  flash(msg, kind) {
    const el = UI.$('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(UI._toastTimer);
    UI._toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  },

  /** 悬停城池的速览：兵 / 墙 / 治安 / 守将 / 对我的态度 */
  showCityTip(city, cx, cy) {
    const tip = UI.$('cityTip');
    if (!tip) return;
    const G = Store.get();
    if (!G || !city) { tip.classList.add('hidden'); return; }

    const f = G.factions[city.owner];
    const isMine = city.owner === G.player.factionId;
    const isDemesne = city.grantedTo === PLAYER_HERO_ID;
    const gov = city.governor ? G.heroes[city.governor] : null;
    const st = !isMine && city.owner !== 'free'
      ? DIPLO_STATUS[Diplo.statusOf(G, G.player.factionId, city.owner)] : null;
    const cap = State.troopCapOf(G, city);
    const troops = troopTotal(city.garrison);
    const building = city.buildQueue && city.buildQueue.length
      ? BUILDINGS[city.buildQueue[0].key].name : null;

    tip.innerHTML = `
      <div class="ct-head">
        <b>${U.esc(city.name)}</b>
        <span style="color:${f ? f.color : '#888'}">${f ? U.esc(f.name) : '—'}${isDemesne ? ' · 直辖' : ''}</span>
        ${st ? `<span class="dst" style="color:${st.color}">${st.name}</span>` : ''}
      </div>
      <div class="ct-row"><span>守军</span><b>${U.num(troops)}</b><span>/</span>${U.num(cap)}
        <span>城墙</span><b>${city.wall.toFixed(1)}</b></div>
      <div class="ct-row"><span>治安</span><b>${Math.round(city.order)}</b>
        <span>士气</span><b>${Math.round(city.morale)}</b>
        <span>守将</span><b>${gov ? U.esc(gov.name) : '无'}</b></div>
      <div class="ct-foot dim">${TERRAIN[city.terrain].name} · ${city.region}
        ${city.policy ? ' · ' + POLICIES[city.policy].name : ''}
        ${building ? ' · 兴建' + building : ''}</div>`;

    tip.classList.remove('hidden');
    const wrap = UI.$('mapwrap').getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = cx - wrap.left + 16;
    let y = cy - wrap.top + 18;
    if (x + w > wrap.width - 8) x = cx - wrap.left - w - 14;
    if (y + h > wrap.height - 8) y = cy - wrap.top - h - 12;
    tip.style.left = Math.max(6, x) + 'px';
    tip.style.top = Math.max(6, y) + 'px';
  },

  hideCityTip() {
    const tip = UI.$('cityTip');
    if (tip) tip.classList.add('hidden');
  },

  // ───────── 按钮 ─────────
  bindButtons() {
    UI.$('btnEndTurn').onclick = () => {
      if (UI._turnLock) return;           // 过场期间不接第二次点击
      UI._turnLock = true;
      setTimeout(() => { UI._turnLock = false; }, 450);
      try {
        Store.dispatch('END_TURN');
        Save.save(Store.get());
        const g = Store.get();
        const season = SEASON[U.season(g.meta.month)].name;
        UI.flash(`${g.meta.year}年 ${g.meta.month}月 · ${season}`, 'turn');
      } catch (e) { UI.toast(e.message); }
    };

    UI.$('btnSave').onclick = () => {
      const G = Store.get();
      if (!G) return;
      UI.flash(Save.save(G) ? '已存档。' : '存档失败（存储不可用）');
    };

    UI.$('btnLoad').onclick = () => {
      const G = Save.load(DEFAULT_SCENARIO);
      if (!G) { UI.flash('无存档。'); return; }
      Store.replace(G);
      Renderer.attach(G);
      UI.selectedId = G.player.homeCityId;
      Renderer.selectedId = UI.selectedId;
      UI.flash('已读档。');
    };

    // 导出/导入：存档就是一份 JSON 文件，谁拿到谁能读
    UI.$('btnExport').onclick = () => {
      const G = Store.get();
      if (!G) return;
      const url = URL.createObjectURL(new Blob([Save.encode(G)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `sanguo-${G.meta.scenarioId}-${G.meta.year}年${G.meta.month}月.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      UI.flash('已导出存档文件，发给谁都能读。');
    };

    UI.$('btnImport').onclick = () => UI.$('importFile').click();

    UI.$('importFile').onchange = e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        e.target.value = '';                       // 允许重复选同一个文件
        const G = Save.decode(String(r.result));
        if (!G) { UI.flash('存档文件不可读（损坏或版本过新）。'); return; }
        Save.save(G);                              // 入本地槽位，刷新后仍在
        Store.replace(G);
        Renderer.attach(G);
        UI.selectedId = G.player.homeCityId;
        Renderer.selectedId = UI.selectedId;
        UI._hist = [];
        UI._histTurn = null;
        UI.flash('已导入存档。');
      };
      r.readAsText(f);
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
        if (h) Renderer.flyTo(h.x, h.y, 300);
      }
    };

    UI.$('btnHelp').onclick = () => UI.$('helpOverlay').classList.remove('hidden');
    UI.$('btnHelpClose').onclick = () => UI.$('helpOverlay').classList.add('hidden');
    UI.$('helpOverlay').onclick = e => {
      if (e.target === UI.$('helpOverlay')) UI.$('helpOverlay').classList.add('hidden');
    };

    UI.$('logClear').onclick = () => {
      const G = Store.get();
      if (!G) return;
      G.log.length = 0;
      UI._logMark = 0;
      UI.render(G);
    };

    for (const btn of UI.$('logFilters').querySelectorAll('.chip')) {
      btn.onclick = () => {
        UI.logFilter = btn.dataset.lf;
        for (const b of UI.$('logFilters').querySelectorAll('.chip')) {
          b.classList.toggle('on', b === btn);
        }
        UI.render(Store.get());
      };
    }
    UI.$('logList').addEventListener('click', e => {
      const card = e.target.closest('.bcard');
      if (!card) return;
      const key = card.dataset.lkey;
      if (UI._logOpen.has(key)) UI._logOpen.delete(key);
      else UI._logOpen.add(key);
      UI.render(Store.get());
    });

    UI.$('logSearch').oninput = e => {
      UI.logQuery = e.target.value;
      UI.render(Store.get());
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
    UI.$('talentVal').textContent = talentName(G);

    UI.renderSparks(G);
    UI.renderMissionLine(G);
    UI.renderBulk(G);
    UI.renderRail(G);
    UI.renderSel(G);
    UI.renderArmy(G);
    UI.renderTech(G);
    UI.renderLegion(G);
    UI.renderDiplo(G);
    UI.renderLog(G);

    UI.$('btnEndTurn').disabled = !!G.over;
    UI.$('btnEndTurn').textContent = G.over
      ? (G.over.result === 'win' ? '天下一统' : '势力覆亡')
      : '结束回合';

    if (!UI.$('rankOverlay').classList.contains('hidden')) UI.renderRankHall(G);
    UI.renderPeace(G);
  },

  // ───────── 顶栏趋势（12 月 sparkline + 环比） ─────────
  renderSparks(G) {
    const turn = G.meta.turn;
    if (UI._histTurn !== turn) {
      UI._histTurn = turn;
      UI._hist.push({
        turn,
        food: State.playerFood(G),
        gold: State.playerGold(G),
        troop: State.playerTroops(G),
      });
      while (UI._hist.length > 12) UI._hist.shift();
    }

    const series = [
      ['sparkFood', 'dFood', 'food', '#b8912f'],
      ['sparkGold', 'dGold', 'gold', '#c9a227'],
      ['sparkTroop', 'dTroop', 'troop', '#8c3b32'],
    ];

    for (const [cid, did, key, color] of series) {
      const cv = UI.$(cid);
      const el = UI.$(did);
      if (!cv) continue;
      const g = cv.getContext('2d');
      const w = cv.width, h = cv.height;
      g.clearRect(0, 0, w, h);

      const vals = UI._hist.map(x => x[key]);
      if (vals.length >= 2) {
        const min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
        const span = max - min || Math.max(1, max * 0.02);
        const px = i => (i / (vals.length - 1)) * (w - 2) + 1;
        const py = v => h - 2 - ((v - min) / span) * (h - 5);

        g.beginPath();
        vals.forEach((v, i) => (i ? g.lineTo(px(i), py(v)) : g.moveTo(px(i), py(v))));
        g.strokeStyle = color;
        g.globalAlpha = 0.85;
        g.lineWidth = 1.2;
        g.stroke();

        g.beginPath();
        g.lineTo(px(vals.length - 1), py(vals[vals.length - 1]));
        g.lineTo(px(vals.length - 1), h);
        g.lineTo(px(0), h);
        g.closePath();
        g.globalAlpha = 0.12;
        g.fillStyle = color;
        g.fill();
        g.globalAlpha = 1;
      }

      if (!el) continue;
      if (vals.length < 2) { el.textContent = ''; el.className = 'delta'; continue; }
      const diff = vals[vals.length - 1] - vals[vals.length - 2];
      el.textContent = diff === 0 ? '' : (diff > 0 ? '▲' : '▼') + U.num(Math.abs(diff));
      el.className = 'delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '');
      el.title = `上月 ${U.num(vals[vals.length - 2])} → 本月 ${U.num(vals[vals.length - 1])}`;
    }
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
    const total = Math.max(1, m.expireTurn - (m.issueTurn == null ? m.expireTurn - left : m.issueTurn));
    const pct = U.clamp((left / total) * 100, 0, 100);
    el.className = 'mission-line' + (left <= 2 ? ' warn' : '') + (left <= 1 ? ' blink' : '');
    el.innerHTML = `<span class="mline-txt">【${U.esc(m.title)}】${U.esc(Mission.text(m, G))} · 限 ${left} 月 · 战功 ${U.signed(m.rewardMerit)}</span>`
      + `<span class="mline-bar"><i style="width:${pct.toFixed(0)}%"></i></span>`;
  },
};

Object.assign(UI,
  UI_START, UI_RANK, UI_PEACE, UI_DIPLO, UI_CITY, UI_ARMY, UI_TECH, UI_LOG, UI_LEGION);
