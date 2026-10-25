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

  /** 提示条只换语义类，颜色一律留在 CSS —— 视图层不写颜色值 */
  _tint(el, cls) {
    el.classList.remove('tip-dim', 'tip-gold', 'tip-good', 'tip-bad');
    if (cls) el.classList.add(cls);
  },

  init() {
    UI.bindMap();
    UI.bindButtons();
    UI.bindTabs();
    UI.bindRankHall();
    UI.bindDiplo();
    UI.bindPeace();
    UI.bindEvent();
    UI.bindTurnFx();
    Audio.init();
    UI.bindMute();
    UI.bindAudioHooks();
    Bus.on('combat', e => Renderer.addFx(e));
    UI.buildStart();
    UI.resizeCanvasSoon();
    window.addEventListener('resize', () => { UI._wrapRect = null; });   // 悬浮提示缓存的容器矩形作废
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
    // 战报「只看关键轮」
    const keyBtn = UI.$('logKeyOnly');
    if (keyBtn) {
      keyBtn.onclick = () => {
        UI.logKeyOnly = !UI.logKeyOnly;
        keyBtn.classList.toggle('on', UI.logKeyOnly);
        UI.render(Store.get());
      };
    }

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
      // 悬浮提示一帧最多更新一次：120Hz 鼠标（或触控板）能一秒打上百个 mousemove，
      // 每个都重建 innerHTML + 量尺寸 = 强制布局，主线程直接被拖住
      else {
        UI._tipArgs = { city: hit, x: e.clientX, y: e.clientY };
        if (!UI._tipRaf) UI._tipRaf = requestAnimationFrame(() => {
          UI._tipRaf = 0;
          const a = UI._tipArgs;
          if (a) UI.showCityTip(a.city, a.x, a.y);
        });
      }
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
      // 用 div 做的可点行（军队行 / 直辖城切换条）：Enter 与空格等价于点击。
      // 没这一条，鼠标能点到的东西键盘用户永远够不到（cursor:pointer 不能代替 tabindex）。
      if ((e.key === 'Enter' || e.key === ' ') && !typing) {
        const el = t && t.closest && t.closest('[data-keyclick]');
        if (el) { e.preventDefault(); el.click(); }
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
      UI._tint(hint, same ? 'tip-dim' : 'tip-gold');
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
      UI._tint(hint, same ? 'tip-dim' : 'tip-gold');
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
      UI._tint(hint, 'tip-dim');
      hint.textContent = `增援 ${city.name}：输送 ${U.num(total)}（${same ? '你直辖之城' : '同势力城池'}，直接并入）`;
      return;
    }

    const f = G.factions[city.owner];
    const pred = Combat.predict(G, plan, from.governor, city, G.player.factionId, State.bld(from, 'drill'));
    UI._tint(hint, pred.win ? 'tip-good' : 'tip-bad');
    hint.textContent = `攻 ${city.name}（${f ? f.name : '—'}）：我战力 ${U.num(pred.atkPower)} : 守 ${U.num(pred.defPower)}，`
      + `预计${pred.win ? '可克' : '难克'}，余兵约 ${U.num(pred.remain)}/${U.num(total)}`;
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
    if (!G || !city) { tip.classList.add('hidden'); UI._tipSig = ''; UI._tipSize = null; return; }

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

    // 同一座城、内容没变就不重建 DOM：悬停移动时只改两个 style，不再触发强制布局
    const sig = [city.id, city.owner, city.grantedTo, troops, Math.round(city.order), Math.round(city.morale),
      city.wall.toFixed(1), gov ? gov.id : '', city.policy, building].join('|');
    if (sig !== UI._tipSig) {
      UI._tipSig = sig;
      tip.innerHTML = `
      <div class="ct-head">
        <b>${U.esc(city.name)}</b>
        <span class="c" style="--c:${f ? f.color : 'var(--ink-ghost)'}">${f ? U.esc(f.name) : '—'}${isDemesne ? ' · 直辖' : ''}</span>
        ${st ? `<span class="dst c" style="--c:${st.color}">${st.name}</span>` : ''}
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
      UI._tipSize = { w: tip.offsetWidth, h: tip.offsetHeight };   // 只有重建时才量尺寸
    } else if (tip.classList.contains('hidden')) {
      tip.classList.remove('hidden');
      if (!UI._tipSize) UI._tipSize = { w: tip.offsetWidth, h: tip.offsetHeight };
    }

    const size = UI._tipSize || { w: 200, h: 80 };
    const wrap = UI._wrapRect || (UI._wrapRect = UI.$('mapwrap').getBoundingClientRect());
    const w = size.w, h = size.h;
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

  // ───────── 存档槽 ─────────
  _slotMode: 'load',

  openSlots(mode) {
    UI._slotMode = mode;
    UI.$('saveTitle').textContent = mode === 'save' ? '存 档' : '读 档';
    UI.$('saveHint').textContent = mode === 'save'
      ? '点已有存档 = 覆盖它；或新建一个。每次结束回合另存一份自动档。'
      : '选一个存档继续。载入后结束回合只会写自动档，不会改原档。';
    UI.$('btnSlotNew').style.display = mode === 'save' ? '' : 'none';
    UI.$('saveOverlay').classList.remove('hidden');
    UI.renderSlots();
  },

  renderSlots() {
    const box = UI.$('slotList');
    const list = Save.list(UI.sc().id);
    const mode = UI._slotMode;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="slotempty">尚无存档。</div>';
      return;
    }
    for (const s of list) {
      const row = document.createElement('div');
      row.className = 'slotrow';

      const btn = document.createElement('button');
      btn.className = 'slotmain';
      const tag = s.slot === Save.AUTO ? '<em>自动</em>' : (s.slot === Save.LEGACY ? '<em>旧档</em>' : '');
      btn.innerHTML = `<span class="slothead">${s.year}年 ${s.month}月 · 第 ${s.turn} 回合${tag}</span>`
        + `<span class="slotmeta">${U.esc(s.player)}（${U.esc(s.faction)}）· ${U.esc(s.home)} · 直辖 ${s.cities} 城 · ${UI._slotTime(s.at)}</span>`;
      btn.onclick = () => (mode === 'save' ? UI.overwriteSlot(s) : UI.loadSlot(s));
      row.appendChild(btn);

      const del = document.createElement('button');
      del.className = 'slotdel';
      del.textContent = '删';
      del.title = '删除此存档';
      del.onclick = () => {
        if (!confirm(`删除 ${s.year}年${s.month}月（第 ${s.turn} 回合）的存档？不可恢复。`)) return;
        Save.remove(s.scenarioId, s.slot);
        UI.renderSlots();
        UI.flash('已删除存档。');
      };
      row.appendChild(del);
      box.appendChild(row);
    }
  },

  /** 存到指定槽？覆盖前让玩家知道那槽里是什么 */
  overwriteSlot(s) {
    const G = Store.get();
    if (!G) return;
    if (s.slot !== Save.AUTO && !confirm(`覆盖 ${s.year}年${s.month}月（第 ${s.turn} 回合）的存档？`)) return;
    if (!Save.save(G, s.slot)) { UI.flash('存档失败（存储不可用）'); return; }
    UI.renderSlots();
    UI.flash(`已存档（${G.meta.year}年 ${G.meta.month}月）。`);
  },

  loadSlot(s) {
    const G = Save.load(s.scenarioId, s.slot);
    if (!G) { UI.flash('此存档不可读。'); return; }
    UI.applySave(G);
    UI.$('saveOverlay').classList.add('hidden');
    UI.flash(`已读档：${s.year}年 ${s.month}月 · 第 ${s.turn} 回合。`);
  },

  /** 把读进来的局面接上：状态、渲染、选中、趋势采样一起重置 */
  applySave(G) {
    Store.replace(G);
    Renderer.attach(G);
    UI.selectedId = G.player.homeCityId;
    Renderer.selectedId = UI.selectedId;
    UI._hist = [];
    UI._histTurn = null;
    UI.syncTabs();
  },

  _slotTime(at) {
    if (!at) return '时间未详';
    const d = new Date(at);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  // ───────── 按钮 ─────────
  /** 音效挂钩：破城分三档（我破城 / 我失城 / 别人的），不克一声轻的 */
  bindAudioHooks() {
    if (typeof Bus === 'undefined') return;
    Bus.on('combat', e => {
      if (!e) return;
      const g = Store.get();
      const pid = g && g.player ? g.player.factionId : null;
      if (e.captured) {
        Audio.play(e.atkFactionId === pid ? 'captureWin' : e.defFactionId === pid ? 'captureLose' : 'capture');
      } else {
        Audio.play('march');
      }
    });
    // 我军失城 / 势力覆灭：纪事里出现关键字就响一次（Audio 内部有节流）
    UI._lastLogLen = 0;
    const watch = () => {
      const g = Store.get();
      if (!g) return;
      if (UI._lastLogLen === 0) { UI._lastLogLen = g.log.length; return; }
      if (g.log.length > UI._lastLogLen) {
        const fresh = g.log.slice(UI._lastLogLen);
        UI._lastLogLen = g.log.length;
        if (fresh.some(x => /陷落|覆灭|失守/.test(x.text))) Audio.play('alarm');
      }
    };
    setInterval(watch, 600);
  },

  /** 顶栏音效开关：状态存 localStorage，用例里的无头环境没有 AudioContext 也不报错 */
  bindMute() {
    const btn = UI.$('btnMute');
    if (!btn) return;
    const sync = () => {
      btn.classList.toggle('off', Audio.muted);
      btn.title = Audio.muted ? '音效已关（点击开启）' : '音效已开（点击关闭）';
    };
    sync();
    btn.onclick = () => { Audio.setMuted(!Audio.muted); sync(); if (!Audio.muted) Audio.play('turn'); };
  },

  bindButtons() {
    UI.$('btnEndTurn').onclick = () => {
      // 战局已终：这颗按钮变成「重看结局」，不推进回合
      const cur = Store.get();
      if (cur && cur.over) { UI._endKey = null; UI.renderEnd(cur); return; }
      if (UI._turnLock) return;           // 过场期间不接第二次点击
      UI._turnLock = true;
      setTimeout(() => { UI._turnLock = false; }, 450);
      try {
        Store.dispatch('END_TURN');
        Save.save(Store.get(), Save.AUTO);      // 自动存档槽，不占玩家的命名槽
        const g = Store.get();
        UI_TURNFX.play(g);                      // 过场：月份牌 + 季节色（不再只弹一条 toast）
        Audio.play('turn');
        UI.flash(`${g.meta.year}年 ${g.meta.month}月 · ${SEASON[U.season(g.meta.month)].name}`, 'turn');
      } catch (e) { UI.toast(e.message); }
    };

    UI.$('btnSave').onclick = () => UI.openSlots('save');
    UI.$('btnLoad').onclick = () => UI.openSlots('load');
    UI.$('btnSlotClose').onclick = () => UI.$('saveOverlay').classList.add('hidden');
    UI.$('btnSlotNew').onclick = () => {
      const G = Store.get();
      if (!G) return;
      if (Save.save(G)) { UI.renderSlots(); UI.flash('已新建存档。'); }
      else UI.flash('存档失败（存储不可用）');
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
        Save.save(G, Save.AUTO);                   // 入自动槽，刷新后仍在
        UI.applySave(G);
        UI.$('saveOverlay').classList.add('hidden');
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
      if (!Store.get()) return;
      Store.dispatch('CLEAR_LOG');       // 写状态只能走命令层
      UI._logMark = 0;
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
    const repNow = Math.round(State.playerReputation(G));
    UI.$('repVal').textContent = repNow;
    UI.$('repVal').title = `名望 ${repNow}：${repTitle(repNow)}`
      + '（登用成功率受它影响；每 +8 点名望约提高 1%）';

    const f = G.factions[G.player.factionId];
    UI.$('factionLine').textContent = f ? f.name : '—';
    UI.$('demesneVal').textContent = G.player.demesne.length;
    UI.$('demesneCap').textContent = cityCap(G.player);
    UI.$('favorVal').textContent = Math.round(G.player.favor == null ? 60 : G.player.favor);
    // 天赋：不只写名字，写出它当前每月给直辖城折合多少东西（绝对值才看得出效果）
    const tal = talentOf(G);
    const gain = tal.id ? Economy.talentGain(G) : null;
    const bits = gain
      ? [['钱', gain.gold], ['粮', gain.food], ['建材', gain.mat], ['铁料', gain.iron]]
        .filter(([, v]) => Math.abs(v) >= 1)
      : [];
    UI.$('talentVal').textContent = tal.id
      ? `${tal.name}${bits.length ? `（${bits.map(([k, v]) => k + U.signed(v)).join(' ')}/月）` : ''}`
      : '无';
    UI.$('talentVal').title = tal.id
      ? `${tal.name}：${tal.desc}\n只作用于你的直辖城与军队。\n每月折合：`
        + (bits.map(([k, v]) => `${k}${U.signed(v)}`).join('　') || '—')
        + '\n（随城建、季节、士族浮动）'
      : '本局未选天赋';

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

    UI.$('btnEndTurn').disabled = false;   // 结局时它当「重看结局」用
    UI.$('btnEndTurn').textContent = G.over
      ? (G.over.result === 'win' ? '天下一统' : '势力覆亡')
      : '结束回合';

    if (!UI.$('rankOverlay').classList.contains('hidden')) UI.renderRankHall(G);
    UI.renderPeace(G);
    UI.renderEvent(G);
    UI.renderEnd(G);
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
      + `<span class="mline-bar"><i style="--w:${pct.toFixed(0)}%"></i></span>`;
  },
};

Object.assign(UI,
  UI_START, UI_RANK, UI_PEACE, UI_EVENT, UI_TURNFX, UI_DIPLO, UI_CITY, UI_ARMY, UI_TECH, UI_LOG, UI_LEGION, UI_END);
