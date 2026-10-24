(function () {

  /**
   * 截图模式：index.html?shot=1&seed=7&turn=12&zoom=0.9&cx=1200&cy=900
   * 只给 tools/shots.js 的视觉回归用：固定种子、固定回合、dt=0（冻结动画），
   * 保证同一台机器上两次截图逐像素一致。
   */
  function shotQuery() {
    if (typeof URLSearchParams === 'undefined') return null;
    const q = new URLSearchParams(location.search);
    return q.get('shot') ? q : null;
  }

  function bootShot(q) {
    // CSS 动画一律停掉：无限循环的闪烁会让像素对比随机翻车
    document.body.classList.add('shot');
    const G = State.create({
      scenarioId: DEFAULT_SCENARIO,
      factionId: q.get('faction') || 'caocao',
      cityId: q.get('city') || 'chenliu',
      playerName: '影',
      seed: Number(q.get('seed') || 7),
    });
    Store.init(G);

    const turns = Number(q.get('turn') || 0);
    for (let i = 0; i < turns; i++) {
      try { Store.dispatch('END_TURN'); } catch (e) { break; }
      if (Store.get().over) break;
    }

    // fight=1：造一支大军直接结算一场攻城，保证截图里有稳定的战报卡
    //（截图夹具：直接调用规则层结算，不走命令层，避免 AI 中途议和把战斗跳过去）
    if (q.get('fight')) {
      const g1 = Store.get();
      const from = g1.cities[g1.player.homeCityId];
      const near = Object.values(g1.cities)
        .filter(c => c.owner !== g1.player.factionId && c.owner !== 'free')
        .map(c => ({ c, d: U.dist(from.x, from.y, c.x, c.y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (from && near) {
        Diplo.declareWar(g1, g1.player.factionId, near.c.owner);
        const army = {
          id: 'shot-army',
          factionId: g1.player.factionId,
          heroId: PLAYER_HERO_ID,
          from: from.id,
          to: near.c.id,
          troops: Object.assign(emptyTroops(), { inf: 2400, arc: 700, cav: 400 }),
          morale: 65,
          mission: 'attack',
        };
        Combat.resolve(g1, army, near.c, 'fixture');
        Store.replace(g1);
      }
    }

    // 事件卡会盖住地图（截图要稳定的画面）：先替他拍板
    {
      const g0 = Store.get();
      if (typeof EventSys !== 'undefined') EventSys.autoResolve(g0);
      Store.replace(g0);
    }

    const g = Store.get();
    Renderer.attach(g);
    Renderer.cam.zoom = Number(q.get('zoom') || 0.9);
    Renderer.centerOn(Number(q.get('cx') || 1200), Number(q.get('cy') || 900));
    if (q.get('sel')) {
      UI.selectedId = q.get('sel');
      Renderer.selectedId = UI.selectedId;
    }
    if (q.get('tab')) {
      UI.sideTab = q.get('tab');
      UI.syncTabs();
    }
    UI.render(g);
    document.getElementById('startOverlay').classList.add('hidden');
    window.__shotReady = true;

    // dt 固定 0：旗面飘动 / 直辖光晕 / 镜头缓动全都停在初始姿态
    function frame() {
      const x = Store.get();
      if (x) Renderer.draw(x, 0);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /** 性能角标：?perf=1 打开。看真正的帧成本与「为什么重画」，排查卡顿别靠猜 */
  function perfHud() {
    if (typeof URLSearchParams === 'undefined') return null;
    if (!new URLSearchParams(location.search).get('perf')) return null;
    const el = document.createElement('div');
    el.id = 'perfHud';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;pointer-events:none;'
      + 'background:rgba(0,0,0,.82);color:#e8e0d0;border:1px solid #5a5348;border-radius:4px;'
      + 'padding:6px 8px;font:11px/1.6 ui-monospace,monospace;white-space:pre';
    document.body.appendChild(el);
    const st = { draws: 0, why: {}, frames: 0, err: '', since: performance.now(), drawMs: 0, lastDraw: 0, maxDraw: 0, net: 0 };
    // 服务到浏览器的往返时延：区分「网络慢」和「本机渲染慢」
    const ping = () => {
      const t0 = performance.now();
      fetch('index.html?ping=' + t0, { cache: 'no-store' })
        .then(() => { st.net = performance.now() - t0; })
        .catch(() => { st.net = -1; });
    };
    setInterval(ping, 2000);
    window.addEventListener('error', e => {
      st.err = `${e.message || 'error'} @${String(e.filename || '').split('/').pop()}:${e.lineno}`;
    });
    setInterval(() => {
      const span = Math.max(1, performance.now() - st.since) / 1000;
      const why = Object.entries(st.why).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`).join('  ') || '无';
      el.textContent = `fps ${(st.frames / span).toFixed(0)}  重画 ${(st.draws / span).toFixed(1)}/s  `
        + `画布 ${Renderer.canvas.width}x${Renderer.canvas.height} @${Renderer._dpr}\n`
        + `重画原因 ${why}\n`
        + `绘制 ${st.draws ? (st.drawMs / st.draws).toFixed(1) : '—'}ms/次  最大 ${st.maxDraw.toFixed(1)}ms  `
        + `合计 ${(st.drawMs / span).toFixed(0)}ms/s\n`
        + `堆 ${((performance.memory && performance.memory.usedJSHeapSize) / 1e6 || 0).toFixed(0)}MB`
        + `  DOM ${document.getElementsByTagName('*').length}`
        + `  网络 ${st.net ? (st.net < 0 ? '失败' : st.net.toFixed(0) + 'ms') : '—'}`
        + (st.err ? `\n错误 ${st.err}` : '');
      st.draws = 0; st.frames = 0; st.why = {}; st.drawMs = 0; st.maxDraw = 0; st.since = performance.now();
    }, 1000);
    window.SanguoPerf = { line: () => el.textContent.replace(/\n/g, ' | ') };
    return st;
  }

  /**
   * 统一出错日志：每条都进 console（带 [sanguo] 前缀与堆栈），同时留在环形缓冲里。
   * 控制台两个入口：SanguoLog.dump() 看全部；copy(SanguoLog.ring.join('\n')) 拷走发人。
   */
  const LOG = (() => {
    const ring = [];
    function push(kind, msg, e) {
      const line = `${new Date().toTimeString().slice(0, 8)} [${kind}] ${msg}`;
      ring.push(line + (e && e.stack ? '\n' + e.stack : ''));
      if (ring.length > 100) ring.shift();
      if (e) console.error(`[sanguo] ${line}`, e);
      else console.warn(`[sanguo] ${line}`);
    }
    return { push, ring, dump: () => console.table(ring) };
  })();
  window.SanguoLog = LOG;

  /**
   * 一键诊断报告：不用开 DevTools、不用截图，控制台 `copy(Diag.report())` 粘给别人就行。
   * 带上环境、画布、动画、DOM、错误日志、局面规模——卡顿报告最常缺的就是这几项。
   */
  const Diag = {
    report() {
      const G = (typeof Store !== 'undefined') && Store.get();
      let anims = [];
      try {
        anims = document.getAnimations().map(a => `${a.animationName || a.transitionProperty || '?'}:`
          + `${a.playState}:${(a.effect && a.effect.target && (a.effect.target.id || a.effect.target.className)) || ''}`);
      } catch (e) { anims = ['getAnimations 不可用']; }
      const overlays = ['startOverlay', 'turnOverlay', 'eventOverlay', 'peaceOverlay', 'rankOverlay',
        'saveOverlay', 'helpOverlay', 'cityTip']
        .map(id => { const e = document.getElementById(id); return e ? id + '=' + (e.classList.contains('hidden') ? 'hidden' : 'SHOWN') : null; })
        .filter(Boolean);
      const r = Renderer;
      return [
        `时间 ${new Date().toString()}`,
        `UA ${navigator.userAgent}`,
        `屏幕 ${screen.width}x${screen.height} 窗口 ${innerWidth}x${innerHeight} dpr ${window.devicePixelRatio} 页面缩放 ${(window.visualViewport && visualViewport.scale) || 1}`,
        `画布 ${r.canvas ? r.canvas.width + 'x' + r.canvas.height : '-'} @${(r._dpr || 1).toFixed(3)} CSS ${r.cw}x${r.ch}`,
        `帧 ${(window.SanguoPerf && window.SanguoPerf.line()) || '未开 ?perf=1'}`,
        `动画 ${anims.length ? anims.join(' ') : '无'}`,
        `弹窗 ${overlays.join(' ')}`,
        `DOM ${document.getElementsByTagName('*').length} 堆 ${((performance.memory && performance.memory.usedJSHeapSize) / 1e6 || 0).toFixed(0)}MB 逻辑核 ${navigator.hardwareConcurrency}`,
        `局面 ${G ? `turn ${G.meta.turn} 城 ${Object.keys(G.cities).length} 军 ${Object.keys(G.armies).length} 开战 ${Object.values(G.armies).filter(a => a.battle).length} 纪事 ${G.log.length} 结局 ${G.over ? G.over.result : '-'}` : '未开局'}`,
        `侧栏 ${UI.sideTab} 城池页 ${UI.cityTab} 选中 ${UI.selectedId} 待重画 ${!!r.moving()}`,
        `减少动效 ${!!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)}`,
        `日志 ${LOG.ring.length ? '\n' + LOG.ring.slice(-8).join('\n') : '无'}`,
      ].join('\n');
    },
  };
  window.Diag = Diag;

  /** 页面级报错横幅：界面渲染/主循环出错时直接显示在页面上，不用开 DevTools */
  function errBanner(msg) {
    let el = document.getElementById('errBanner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'errBanner';
      el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#7a1f16;color:#ffe;'
        + 'font:12px/1.6 ui-monospace,monospace;padding:6px 10px;white-space:pre-wrap;max-height:40vh;overflow:auto';
      el.onclick = () => el.remove();
      document.body.appendChild(el);
    }
    el.textContent = '出错了（点掉这条）：' + msg
      + '\n详情在控制台搜 [sanguo]，或执行 copy(SanguoLog.ring.join("\\n")) 拷走';
  }

  function boot() {
    // ?scale=0.7：把渲染像素降到 70%，用来分“像素量”和“别的开销”
    const sc = Number(new URLSearchParams(location.search).get('scale'));
    if (sc > 0.2 && sc <= 1) Renderer.scale = sc;
    window.addEventListener('error', e => {
      LOG.push('window', `${e.message} @${String(e.filename || '').split('/').pop()}:${e.lineno}`, e.error);
      errBanner(`${e.message} @${String(e.filename || '').split('/').pop()}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', e => {
      const m = (e.reason && e.reason.message) || String(e.reason);
      LOG.push('promise', m, e.reason);
      errBanner('Promise: ' + m);
    });
    Renderer.init(document.getElementById('map'));
    UI.init();
    // 订阅者抛错会被 Bus 吞掉：这里自己接住，界面出错必须看得见
    Bus.on('state', G => {
      try { UI.render(G); } catch (e) {
        LOG.push('render', '界面渲染出错: ' + e.message, e);
        errBanner('界面渲染出错: ' + e.message);
      }
    });
    window.__bootOk = true;      // index.html 尾部自检靠它：没跑到这里 = 脚本没加载完整
    const PERF = perfHud();

    const shot = shotQuery();
    if (shot) { bootShot(shot); return; }

    // 有存档则直接续最近一局
    // 多剧本：挑所有剧本里最新的那一局继续
    let saved = null;
    for (const id of Object.keys(SCENARIOS)) {
      const cand = Save.latest(id);
      if (!cand) continue;
      if (!saved || (cand.meta.startedAt || 0) > (saved.meta.startedAt || 0)) saved = cand;
    }
    if (saved && saved.meta && saved.cities) {
      try {
        Store.init(saved);
        Renderer.attach(saved);
        UI.selectedId = saved.player.homeCityId;
        Renderer.selectedId = UI.selectedId;
        document.getElementById('startOverlay').classList.add('hidden');
      } catch (e) {
        // 旧档读不进来就退回开局界面，别留一个半死页面
        LOG.push('boot', '续档失败: ' + e.message, e);
        errBanner('续档失败: ' + e.message);
        document.getElementById('startOverlay').classList.remove('hidden');
      }
    }

    let last = performance.now();
    // 静止不重绘：软件光栅化时每帧整幅重绘要吃掉整整一个核，满载降频之后就是「开一会儿突然卡」。
    // 画面要变的时候才画：局面变了 / 镜头动了 / 选中·悬停变了 / 有交战特效 / 画布尺寸变了。
    let seen = { G: null, x: 0, y: 0, z: 0, hover: null, sel: null, targeting: false };
    function frame(t) {
      const dt = Math.min(80, t - last);
      last = t;
      if (PERF) PERF.frames++;
      try {
        const G = Store.get();
        if (G) {
          const cam = Renderer.cam;
          const dirty = seen.G !== G || seen.x !== cam.x || seen.y !== cam.y || seen.z !== cam.zoom
            || seen.hover !== Renderer.hoverId || seen.sel !== Renderer.selectedId
            || seen.targeting !== Renderer.targeting || Renderer.moving();
          if (dirty) {
            if (PERF) {
              const why = seen.G !== G ? 'state'
                : (seen.x !== cam.x || seen.y !== cam.y || seen.z !== cam.zoom) ? 'cam'
                  : seen.hover !== Renderer.hoverId ? 'hover'
                    : seen.sel !== Renderer.selectedId ? 'sel'
                      : seen.targeting !== Renderer.targeting ? 'targeting'
                        : Renderer.stale ? 'stale'
                          : Renderer._fly ? 'fly'
                            : Renderer._inertia ? 'inertia'
                              : (Renderer.fx && Renderer.fx.length) ? 'fx' : '?';
              PERF.draws++; PERF.why[why] = (PERF.why[why] || 0) + 1;
            }
            seen = {
              G, x: cam.x, y: cam.y, z: cam.zoom,
              hover: Renderer.hoverId, sel: Renderer.selectedId, targeting: Renderer.targeting,
            };
            Renderer.stale = false;
            const t0 = PERF ? performance.now() : 0;
            Renderer.draw(G, dt);
            if (PERF) {
              const cost = performance.now() - t0;
              PERF.drawMs += cost;
              PERF.lastDraw = cost;
              if (cost > PERF.maxDraw) PERF.maxDraw = cost;
            }
          }
        }
      } catch (e) {
        // 一帧画崩不能把主循环带走：否则地图永久冻结、整页看着像卡死
        if (PERF) PERF.err = 'frame: ' + e.message;
        if (!frame.warned) {
          frame.warned = true;
          LOG.push('frame', '绘制出错，已跳过该帧: ' + e.message, e);
          errBanner('绘制出错: ' + e.message);
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
