// Canvas 渲染器：地图 / 城池 / 军队 / 选中态
const Renderer = {
  canvas: null,
  ctx: null,
  G: null,
  terrain: null,
  cam: { x: 1200, y: 900, zoom: 0.55 },
  selectedId: null,
  targeting: false,
  hoverId: null,
  _t: 0,
  fx: [],
  _fly: null,
  _inertia: null,
  MINI_W: 180,
  MINI_H: 135,
  _terr: null,
  _terrKey: '',
  _capitals: null,

  init(canvas) {
    Renderer.canvas = canvas;
    Renderer.ctx = canvas.getContext('2d');
    Renderer.resize();
    window.addEventListener('resize', Renderer.resize);
  },

  /** 一块画布的像素上限：没显卡加速时合成开销 ≈ 像素数 × 刷新率，大窗口不封顶就是半核跑空转 */
  MAX_CANVAS_PX: 1.3e6,
  scale: 1,

  resize() {
    // 页面缩放（Ctrl+=）会抬高 devicePixelRatio：画布像素按平方涨，软件光栅化下直接爆 CPU。
    // 两道闸：dpr 封顶 1.5，再按最大像素数降渲染分辨率（CSS 尺寸不变，只降内部像素）。
    const rect = Renderer.canvas.getBoundingClientRect();
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5) * (Renderer.scale || 1);
    const px = Math.max(1, rect.width * rect.height) * dpr * dpr;
    if (px > Renderer.MAX_CANVAS_PX) dpr *= Math.sqrt(Renderer.MAX_CANVAS_PX / px);
    Renderer.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    Renderer.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    Renderer._dpr = dpr;
    Renderer.cw = rect.width;
    Renderer.ch = rect.height;
    Renderer.stale = true;      // 尺寸变了，必须重画一帧
  },

  attach(G) {
    Renderer.G = G;
    Renderer.terrain = GameMap.prerender(GameMap.generate(G.meta.seed), Object.values(G.cities));
    const home = G.cities[G.player.homeCityId];
    if (home) Renderer.centerOn(home.x, home.y);
    Renderer.stale = true;
  },

  /** 本帧要不要重画：静止时返回 false，主循环据此跳过整幅重绘 */
  moving() {
    return !!(Renderer.stale || Renderer._fly || Renderer._inertia
      || (Renderer.fx && Renderer.fx.length));
  },

  centerOn(x, y) { Renderer.cam.x = x; Renderer.cam.y = y; },

  /** 缓动飞行到世界坐标（小地图/定位/回中都用它） */
  flyTo(x, y, ms, zoom) {
    Renderer._inertia = null;
    Renderer._fly = {
      x0: Renderer.cam.x, y0: Renderer.cam.y,
      x1: U.clamp(x, -200, GameMap.W + 200),
      y1: U.clamp(y, -200, GameMap.H + 200),
      z0: Renderer.cam.zoom,
      z1: zoom == null ? Renderer.cam.zoom : U.clamp(zoom, Renderer.ZOOM_MIN, Renderer.ZOOM_MAX),
      t: 0, dur: Math.max(60, ms || 260),
    };
  },

  /** 每帧推进镜头：飞行优先，其次拖拽惯性 */
  tickCam(dt) {
    if (Renderer._fly) {
      const f = Renderer._fly;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = 1 - Math.pow(1 - f.t, 3);          // ease-out cubic
      Renderer.cam.x = U.lerp(f.x0, f.x1, e);
      Renderer.cam.y = U.lerp(f.y0, f.y1, e);
      Renderer.cam.zoom = U.lerp(f.z0, f.z1, e);
      if (f.t >= 1) Renderer._fly = null;
      return;
    }
    const i = Renderer._inertia;
    if (!i) return;
    const k = dt / 16;
    Renderer.cam.x = U.clamp(Renderer.cam.x + i.vx * k, -200, GameMap.W + 200);
    Renderer.cam.y = U.clamp(Renderer.cam.y + i.vy * k, -200, GameMap.H + 200);
    const damp = Math.pow(0.90, k);
    i.vx *= damp;
    i.vy *= damp;
    if (Math.abs(i.vx) + Math.abs(i.vy) < 0.12) Renderer._inertia = null;
  },

  ZOOM_MIN: 0.28,
  ZOOM_MAX: 2.2,

  /**
   * 立面总旋钮（只改这一块就能整体调风格）：
   *   height  立面高度系数（屏幕 px / 城半径）；0 = 退回原平面画法
   *   skew    东面宽度 / 高度（斜投影角度，越大越像等距）
   *   front   南面压暗（正对观者的背光面，最暗）
   *   side    东面压暗（侧向背光面，稍亮）
   *   flagLift 旗杆随城抬升比例（1 = 插在城头，0 = 仍插在地面）
   * 光源固定在西北，与 map.js 山体侧影同向 —— 改这两处得一起改。
   */
  ISO: {
    height: 1.25,
    skew: 0.24,
    front: 0.62,
    side: 0.75,
    flagLift: 0.9,
  },

  /** 城立面高度：档次越高越高，城墙等级再加一点 */
  cityHeight(r, tier, wall, wallMax) {
    const base = tier === 2 ? 1.05 : tier === 1 ? 0.82 : 0.6;
    const keep = wallMax ? U.clamp((wall || 1) / wallMax, 0, 1) * 0.18 : 0;
    return r * Renderer.ISO.height * (base + keep);
  },

  zoomBy(f) {
    const z = U.clamp(Renderer.cam.zoom * f, Renderer.ZOOM_MIN, Renderer.ZOOM_MAX);
    Renderer.cam.zoom = z;
  },

  panBy(dxScreen, dyScreen) {
    Renderer._fly = null;                          // 手一拖就打断飞行
    Renderer.cam.x -= dxScreen / Renderer.cam.zoom;
    Renderer.cam.y -= dyScreen / Renderer.cam.zoom;
    Renderer.cam.x = U.clamp(Renderer.cam.x, -200, GameMap.W + 200);
    Renderer.cam.y = U.clamp(Renderer.cam.y, -200, GameMap.H + 200);
  },

  toScreen(wx, wy) {
    return {
      x: (wx - Renderer.cam.x) * Renderer.cam.zoom + Renderer.cw / 2,
      y: (wy - Renderer.cam.y) * Renderer.cam.zoom + Renderer.ch / 2,
    };
  },

  toWorld(sx, sy) {
    return {
      x: (sx - Renderer.cw / 2) / Renderer.cam.zoom + Renderer.cam.x,
      y: (sy - Renderer.ch / 2) / Renderer.cam.zoom + Renderer.cam.y,
    };
  },

  /** 当前视野在世界坐标里的矩形（裁剪整图 blit 用） */
  viewBounds() {
    const z = Renderer.cam.zoom;
    const halfW = Renderer.cw / 2 / z, halfH = Renderer.ch / 2 / z;
    const x0 = U.clamp(Renderer.cam.x - halfW, 0, GameMap.W);
    const y0 = U.clamp(Renderer.cam.y - halfH, 0, GameMap.H);
    const x1 = U.clamp(Renderer.cam.x + halfW, 0, GameMap.W);
    const y1 = U.clamp(Renderer.cam.y + halfH, 0, GameMap.H);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  },

  /** 兵额缓存：每 400ms 重算一次，避免逐城逐帧跑兵额公式 */
  capOf(G, c, now) {
    const cache = Renderer._capCache || (Renderer._capCache = { at: 0, map: new Map() });
    if (now - cache.at > 400) { cache.at = now; cache.map.clear(); }
    let v = cache.map.get(c.id);
    if (v == null) { v = State.troopCapOf(G, c); cache.map.set(c.id, v); }
    return v;
  },

  /**
   * 画家算法的绘制顺序：城与军队按世界 y 混排（城有立面，北边的必须先画）。
   * 纯函数、循环全部有界 —— 曾经这里是 `while (ai < armies.length) draw(...)` 忘了自增，
   * 只要屏幕上有军队在所有可见城池以南（拖拽/放大后很常见）主线程就死循环：
   * CPU 100%、控制台都动不了、点什么都没反应。
   */
  mergeDrawOrder(cityItems, armyItems) {
    const out = [];
    let ai = 0;
    for (const it of cityItems) {
      while (ai < armyItems.length && armyItems[ai].a.y < it.c.y) {
        out.push({ kind: 'army', o: armyItems[ai] });
        ai++;
      }
      out.push({ kind: 'city', o: it });
    }
    for (; ai < armyItems.length; ai++) out.push({ kind: 'army', o: armyItems[ai] });
    return out;
  },

  /** 命中城池 */
  pick(G, sx, sy) {
    const z = Renderer.cam.zoom;
    const pad = 8;
    let best = null, bestD = Infinity;
    for (const c of Object.values(G.cities)) {
      const p = Renderer.toScreen(c.x, c.y);
      const r = (7 + c.pop / 45) * Math.max(0.75, z);
      let hit = false, d;

      if (z < 0.5) {
        // 远景色点：还是圆
        d = U.dist(sx, sy, p.x, p.y);
        hit = d < Math.max(2.4, r * 0.62) + pad;
      } else {
        // 近景城体：立面抬起来以后比底平面高，命中范围得跟着长
        const tier = Renderer.cityTier(G, c);
        const foot = Renderer.cityFoot(r, tier);
        const cz = Renderer.cityHeight(r, tier, c.wall, State.wallMaxOf(c));
        const x0 = p.x - foot.w / 2 - pad;
        const x1 = p.x + foot.w / 2 + cz * Renderer.ISO.skew + pad;
        const y0 = p.y - foot.h * 0.62 - cz - pad;     // 屋顶上沿
        const y1 = p.y + foot.h * 0.38 + pad;          // 城基下沿
        hit = sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
        d = U.dist(sx, sy, p.x, p.y - foot.h * 0.12);  // 多处重叠时取离底平面中心最近的
      }

      if (hit && d < bestD) { best = c; bestD = d; }
    }
    return best;
  },

  // ───────── 绘制 ─────────
  draw(G, dt) {
    Renderer._t += dt;
    Renderer._now = performance.now();
    Renderer.tickCam(dt);
    const ctx = Renderer.ctx;
    const dpr = Renderer._dpr || 1;
    const cw = Renderer.cw, ch = Renderer.ch;
    const z = Renderer.cam.zoom;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d0c0a';
    ctx.fillRect(0, 0, cw, ch);

    // 地形（世界坐标变换）
    if (Renderer.terrain) {
      ctx.save();
      ctx.setTransform(dpr * z, 0, 0, dpr * z,
        dpr * (cw / 2 - Renderer.cam.x * z),
        dpr * (ch / 2 - Renderer.cam.y * z));
      ctx.imageSmoothingEnabled = true;
      // 只贴可见的那块世界：整图 blit 会把 2400×1800 全过一遍，视野小的时候纯浪费
      const vb = Renderer.viewBounds();
      if (vb) ctx.drawImage(Renderer.terrain, vb.x0, vb.y0, vb.w, vb.h, vb.x0, vb.y0, vb.w, vb.h);
      ctx.restore();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const playerFid = G.player.factionId;

    // 领地晕染（势力色，缓存在一个半分辨率画布上，易主时才重建）
    if (Renderer.terrain && G) {
      ctx.save();
      ctx.setTransform(dpr * z, 0, 0, dpr * z,
        dpr * (cw / 2 - Renderer.cam.x * z),
        dpr * (ch / 2 - Renderer.cam.y * z));
      // 领地层是半分辨率：源矩形按 0.5 缩放取
      const vb = Renderer.viewBounds();
      const layer = Renderer.territoryLayer(G);
      if (vb) {
        ctx.drawImage(layer, vb.x0 * 0.5, vb.y0 * 0.5, vb.w * 0.5, vb.h * 0.5,
          vb.x0, vb.y0, vb.w, vb.h);
      }
      ctx.restore();
    }

    // 军队路线（先画线，压在城市下）
    for (const a of Object.values(G.armies)) {
      const from = G.cities[a.from], to = G.cities[a.to];
      if (!from || !to) continue;
      const p1 = Renderer.toScreen(a.x, a.y);
      const p2 = Renderer.toScreen(to.x, to.y);
      const f = G.factions[a.factionId];
      const hostile = a.factionId !== playerFid && to.owner === playerFid;

      ctx.save();
      ctx.setLineDash(hostile ? [6, 5] : [4, 6]);
      ctx.lineWidth = hostile ? 2 : 1.4;
      ctx.strokeStyle = hostile ? 'rgba(224,96,80,0.85)' : hexA(f ? f.color : '#888', 0.55);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }

    // 城池：按世界 y 升序画（画家算法）—— 城有立面后，北边的城必须先画
    const cityDraw = [];
    for (const c of Object.values(G.cities)) {
      const p = Renderer.toScreen(c.x, c.y);
      if (p.x < -60 || p.y < -60 || p.x > cw + 60 || p.y > ch + 60) continue;
      cityDraw.push({ c, p });
    }
    cityDraw.sort((a, b) => a.c.y - b.c.y);

    // 军队也按世界 y 排，和城池混排 —— 否则兵符永远浮在所有城之上，城后有兵时穿帮
    const armies = Object.values(G.armies)
      .map(a => ({ a, p: Renderer.toScreen(a.x, a.y) }))
      .filter(o => o.p.x > -40 && o.p.y > -40 && o.p.x < cw + 40 && o.p.y < ch + 40)
      .sort((m, n) => m.a.y - n.a.y);

    for (const item of Renderer.mergeDrawOrder(cityDraw, armies)) {
      if (item.kind === 'army') {
        Renderer.drawArmyMarker(ctx, G, item.o.a, item.o.p, playerFid, z);
        continue;
      }
      const { c, p } = item.o;

      const f = G.factions[c.owner];
      const color = f ? f.color : '#888';
      const isPlayer = c.owner === playerFid;
      const isDemesne = c.grantedTo === PLAYER_HERO_ID;
      const isSel = c.id === Renderer.selectedId;
      const isHover = c.id === Renderer.hoverId;

      const r = (7 + c.pop / 45) * Math.max(0.75, z);
      // 标记 LOD：远看色点，中看城+旗，近看字与兵数
      const lod = z < 0.5 ? 0 : z < 0.8 ? 1 : 2;

      // 玩家直辖城光晕：远景色点在这里画，近景交给 drawCity（跟着底平面走，不然会被城体盖掉）
      const pulse = isDemesne ? 0.5 + 0.5 * Math.sin(Renderer._t / 600) : 0;
      if (isDemesne && lod === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 7 + pulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(201,162,39,${0.10 + pulse * 0.07})`;
        ctx.fill();
      }

      if (lod === 0) {
        Renderer.drawCityDot(ctx, p.x, p.y, Math.max(2.4, r * 0.62), color, {
          demesne: isDemesne, sel: isSel, hover: isHover,
        });
        continue;
      }

      // 城池：外墙 + 雉堞 + 城门（档次与城墙等级都进画面）
      const tier = Renderer.cityTier(G, c);
      const cz = Renderer.cityHeight(r, tier, c.wall, State.wallMaxOf(c));
      Renderer.drawCity(ctx, p.x, p.y, r, color, {
        tier,
        wall: c.wall,
        wallMax: State.wallMaxOf(c),
        detail: lod >= 2,
        tint: lod >= 2 ? 0.1 : 1,   // 中景保留势力色（归属一眼可读）；近景才换成建材色
        imperial: !!(G.court && G.court.emperorCityId === c.id),
        demesne: isDemesne,
        player: isPlayer,
        z: cz,
        ring: isSel ? '#fff3d0'
          : isHover ? (Renderer.targeting ? 'rgba(224,96,80,0.9)' : 'rgba(240,223,168,0.55)') : null,
        ringW: isSel ? 1.6 : 1.5,
        glow: pulse,
      });

      // 驻军规模：城外营帐（近景才画）
      if (lod >= 2) {
        const fill = troopTotal(c.garrison) / Math.max(1, Renderer.capOf(G, c, Renderer._now));
        if (fill > 0.6) Renderer.drawCamp(ctx, p.x, p.y, r, fill > 1.15 ? 3 : fill > 0.85 ? 2 : 1);
      }

      // 势力旗：旗色即势力色，放大时旗上写势力首字；杆随立面上抬，插在城头
      if (f && c.owner !== 'free') {
        Renderer.drawFlag(ctx, p.x, p.y, r, color, lod >= 2 ? f.name.slice(0, 1) : '',
          cz * Renderer.ISO.flagLift);
      }

      // 治所：城头一颗小星（中景也画 —— 2~3px 的亮点比一排雉堞更能读出"这是治所"）
      if (Renderer._capitals && Renderer._capitals.has(c.id)) {
        Renderer._star(ctx, p.x, p.y - r * 1.15 - cz * 0.55, Math.max(2.2, r * 0.28), 'rgba(240,223,168,0.9)');
      }

      // 关系弧（对我方势力的态度）：红交战 / 黄停战 / 绿同盟
      if (!isPlayer && c.owner !== 'free') {
        const st = Diplo.statusOf(G, playerFid, c.owner);
        const col = st === 'war' ? 'rgba(200,90,74,0.95)'
          : st === 'ally' ? 'rgba(95,154,106,0.95)'
            : st === 'truce' ? 'rgba(201,162,39,0.95)' : null;
        if (col) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 4.5, Math.PI * 0.15, Math.PI * 0.85);
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }


      // 在建工程：城上一点弱光
      if (c.buildQueue && c.buildQueue.length) {
        const pulse = 0.5 + 0.5 * Math.sin(Renderer._t / 420 + c.x);
        ctx.beginPath();
        ctx.arc(p.x, p.y - r - 5, 1.8 + pulse * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(224,185,58,${0.45 + pulse * 0.4})`;
        ctx.fill();
      }

      // 名称（带压暗铭牌，叠在纹理上也看得清）
      const fs = U.clamp(11 * z + 2, 10, 15);
      ctx.font = `${fs}px "Noto Serif SC",serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(c.name).width;
      ctx.fillStyle = 'rgba(8,7,6,0.4)';
      ctx.fillRect(p.x - tw / 2 - 3, p.y + r + 2, tw + 6, fs + 1);
      ctx.fillStyle = isDemesne ? '#f0dfa8' : (isPlayer ? '#dce9f4' : '#ded6c6');
      ctx.fillText(c.name, p.x, p.y + r + 3);

      // 兵力（放大了才显示）
      if (lod >= 2) {
        const gt = troopTotal(c.garrison);
        ctx.font = `${U.clamp(9 * z, 9, 12)}px "Noto Serif SC",serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(6,5,4,0.9)';
        const txt = U.num(gt);
        ctx.strokeText(txt, p.x, p.y + r + 3 + fs + 1);
        ctx.fillStyle = 'rgba(220,205,180,0.8)';
        ctx.fillText(txt, p.x, p.y + r + 3 + fs + 1);
      }
    }

    // 剩下的军队（比所有城都靠南）

    // 目标选择模式的十字说明
    if (Renderer.targeting) {
      ctx.fillStyle = 'rgba(224,96,80,0.9)';
      ctx.font = '13px "Noto Serif SC",serif';
      ctx.textAlign = 'center';
      ctx.fillText('选择进军目标（Esc 取消）', cw / 2, 26);
    }

    Renderer.drawFx(ctx, G);
    Renderer.drawCompass(ctx, cw - 44, ch - 44);
    if (z >= 0.8) Renderer.drawArmyKey(ctx, cw - 22, ch - 96);
    Renderer.drawMinimap(G);
  },

  /** 交战特效入队（由 Bus 的 combat 事件驱动，纯视觉，不参与规则） */
  addFx(e) {
    if (!e || !e.cityId) return;
    Renderer.fx.push({ cityId: e.cityId, captured: !!e.captured, at: performance.now() });
    if (Renderer.fx.length > 8) Renderer.fx.shift();
  },

  /** 短促交战特效：0.7s 扩环 + 火光 */
  drawFx(ctx, G) {
    if (!Renderer.fx.length) return;
    const now = performance.now();
    Renderer.fx = Renderer.fx.filter(f => now - f.at < 700);
    const z = Math.max(0.75, Renderer.cam.zoom);
    for (const f of Renderer.fx) {
      const c = G.cities[f.cityId];
      if (!c) continue;
      const p = Renderer.toScreen(c.x, c.y);
      const t = (now - f.at) / 700;
      const rr = (10 + t * 30) * z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
      ctx.strokeStyle = f.captured
        ? `rgba(224,96,80,${((1 - t) * 0.9).toFixed(3)})`
        : `rgba(224,185,58,${((1 - t) * 0.7).toFixed(3)})`;
      ctx.lineWidth = 2.4 * (1 - t) + 0.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, rr * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(240,140,60,${((1 - t) * 0.22).toFixed(3)})`;
      ctx.fill();
      // 易主闪白
      if (f.captured && t < 0.32) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,250,235,${((0.32 - t) * 1.6).toFixed(3)})`;
        ctx.fill();
      }
    }
  },

  /** 领地晕染层：半分辨率，城主人变了才重建 */
  territoryLayer(G) {
    const key = Object.values(G.cities).map(c => c.owner + (c.grantedTo ? '*' : '')).join('');
    if (Renderer._terr && Renderer._terrKey === key) return Renderer._terr;

    const s = 0.5;
    const cv = document.createElement('canvas');
    cv.width = GameMap.W * s;
    cv.height = GameMap.H * s;
    const g = cv.getContext('2d');

    for (const c of Object.values(G.cities)) {
      const f = G.factions[c.owner];
      const col = f ? f.color : '#6b6455';
      const R = (78 + Math.min(70, c.pop * 0.02)) * s;   // 78–148 世界像素：势力色晕，别糊满全图
      const rg = g.createRadialGradient(c.x * s, c.y * s, R * 0.4, c.x * s, c.y * s, R);
      rg.addColorStop(0, hexA(col, 0.30));
      rg.addColorStop(0.6, hexA(col, 0.12));
      rg.addColorStop(1, hexA(col, 0));
      g.fillStyle = rg;
      g.beginPath();
      g.arc(c.x * s, c.y * s, R, 0, Math.PI * 2);
      g.fill();
    }

    Renderer._terr = cv;
    Renderer._terrKey = key;
    Renderer._miniThumb = Renderer.buildMiniThumb(cv);   // 小地图底图，随易主一起重建
    Renderer._capitals = Renderer.capitals(G);
    // 郡城阈值：取人口 78 分位，随剧本/平衡调整自动跟随
    const pops = Object.values(G.cities).map(c => c.pop).sort((a, b) => a - b);
    Renderer._popHi = pops.length ? pops[Math.floor(pops.length * 0.78)] : 140;
    return cv;
  },

  /** 小地图底图：地形 + 领地层缩到 180×135，只在易主时重建一次 */
  buildMiniThumb(terrLayer) {
    const cv = document.createElement('canvas');
    cv.width = Renderer.MINI_W;
    cv.height = Renderer.MINI_H;
    const g = cv.getContext('2d');
    if (Renderer.terrain) g.drawImage(Renderer.terrain, 0, 0, cv.width, cv.height);
    if (terrLayer) g.drawImage(terrLayer, 0, 0, cv.width, cv.height);
    return cv;
  },

  /** 小地图：底图 + 城点 + 视野框，150ms 一刷 */
  drawMinimap(G) {
    const cv = document.getElementById('minimap');
    if (!cv || !G) return;
    const now = Renderer._now || 0;
    if (Renderer._miniAt && now - Renderer._miniAt < 150) return;
    Renderer._miniAt = now;

    const g = cv.getContext('2d');
    const s = cv.width / GameMap.W;
    g.clearRect(0, 0, cv.width, cv.height);
    if (Renderer._miniThumb) g.drawImage(Renderer._miniThumb, 0, 0);
    else if (Renderer.terrain) g.drawImage(Renderer.terrain, 0, 0, cv.width, cv.height);

    for (const c of Object.values(G.cities)) {
      const f = G.factions[c.owner];
      g.fillStyle = f ? f.color : '#8a8272';
      g.beginPath();
      g.arc(c.x * s, c.y * s, c.grantedTo === PLAYER_HERO_ID ? 2.3 : 1.4, 0, Math.PI * 2);
      g.fill();
    }

    const vb = Renderer.viewBounds();
    if (vb) {
      g.strokeStyle = 'rgba(240,223,168,0.95)';
      g.lineWidth = 1;
      g.strokeRect(vb.x0 * s + 0.5, vb.y0 * s + 0.5, Math.max(3, vb.w * s), Math.max(3, vb.h * s));
    }
  },

  /** 每势力最大的城算治所 */
  capitals(G) {
    return State.capitals(G);   // 口径只有一份：State.capitals
  },

  /** 远景城池：只画一个色点（带直辖金环与选中反馈） */
  /** 军队主兵种 → 图示；看不出来（空编制/平手）就当骑（尖锋） */
  armyKind(a) {
    const t = a.troops || {};
    let kind = 'cav', best = 0;
    for (const k of TROOP_KEYS) {
      const n = t[k] || 0;
      if (n > best) { best = n; kind = k; }
    }
    return kind;
  },

  /** 兵种图示：前向 = 局部 +x（上层会整体旋到"北"），s 为尺寸 */
  _armyPath(ctx, kind, s) {
    if (kind === 'inf') {                       // 步：盾（上宽下尖）
      ctx.moveTo(s * 0.95, -s * 0.12);
      ctx.lineTo(s * 0.55, -s * 0.85);
      ctx.lineTo(-s * 0.75, -s * 0.62);
      ctx.lineTo(-s * 0.75, s * 0.62);
      ctx.lineTo(s * 0.55, s * 0.85);
      ctx.lineTo(s * 0.95, s * 0.12);
    } else if (kind === 'arc') {                // 弓：弓臂 + 弦口内凹
      ctx.moveTo(s * 0.85, -s * 0.85);
      ctx.quadraticCurveTo(s * 0.05, 0, s * 0.85, s * 0.85);
      ctx.lineTo(s * 0.5, s * 0.7);
      ctx.quadraticCurveTo(-s * 0.35, 0, s * 0.5, -s * 0.7);
    } else if (kind === 'nvy') {                // 水：帆（下缘斜切的三角）
      ctx.moveTo(s * 0.9, 0);
      ctx.lineTo(-s * 0.55, s * 0.8);
      ctx.lineTo(-s * 0.55, -s * 0.3);
    } else if (kind === 'siege') {              // 器：方车（梯形箱 + 前檐）
      ctx.moveTo(s * 0.9, -s * 0.55);
      ctx.lineTo(s * 0.9, s * 0.55);
      ctx.lineTo(-s * 0.7, s * 0.75);
      ctx.lineTo(-s * 0.7, -s * 0.75);
    } else {                                    // 骑 / 缺省：尖锋
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.7, s * 0.75);
      ctx.lineTo(-s * 0.7, -s * 0.75);
    }
    ctx.closePath();
  },

  /** 军队标记：兵种图示（大小随兵力）+ 行军月数；按 y 混排进城池绘制流，见 draw */
  drawArmyMarker(ctx, G, a, p, playerFid, z) {
    const f = G.factions[a.factionId];
    const color = f ? f.color : '#888';
    const isMine = a.factionId === playerFid;
    const kind = Renderer.armyKind(a);
    // 规模：兵越多越大（sqrt 压一压，免得大军把地图撑满）
    const men = troopTotal(a.troops || {});
    const size = U.clamp((6 + Math.sqrt(men) * 0.22) * Math.max(0.8, z), 6, 16);

    // 地面软影（与城池同一套光向：东南）
    ctx.beginPath();
    ctx.ellipse(p.x + size * 0.22, p.y + size * 0.3, size * 0.8, size * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();

    // 队形数随兵力：<500 一队 · <2000 两队 · <5000 三队 · 以上四队（docs/VISUAL.md §11.2）
    const ranks = men < 500 ? 1 : men < 2000 ? 2 : men < 5000 ? 3 : 4;
    const gap = size * 2.05;
    const start = -gap * (ranks - 1) / 2;

    for (let i = 0; i < ranks; i++) {
      const ox = ranks === 1 ? 0 : start + gap * i;
      // 后排略压暗、略小：一眼看出"行列"而不是一坨
      const depth = ranks === 1 ? 1 : 1 - Math.abs(i - (ranks - 1) / 2) * 0.08;
      const s = size * depth;
      for (const pass of [0, 1]) {
        ctx.save();
        ctx.translate(p.x + ox + (pass ? 0 : s * 0.16), p.y + (pass ? 0 : s * 0.22));
        ctx.rotate(-Math.PI / 2);
        ctx.beginPath();
        Renderer._armyPath(ctx, kind, s);
        ctx.fillStyle = pass ? color : shade(color, 0.45);
        ctx.fill();
        if (pass) {
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = isMine ? '#ffe9a8' : 'rgba(0,0,0,0.7)';
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    if (z > 0.6) {
      ctx.font = `${U.clamp(9 * z, 9, 12)}px "Noto Serif SC",serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(6,5,4,0.9)';
      const t = `${a.eta}月`;
      ctx.strokeText(t, p.x, p.y - size - 2);
      ctx.fillStyle = isMine ? '#ffe9a8' : '#e8c0b4';
      ctx.fillText(t, p.x, p.y - size - 2);
    }
  },

  drawCityDot(ctx, x, y, r, color, opts) {
    // 远景也要一点高度感：东南向软影 → 色点看着是“浮在地面上”而不是贴纸
    ctx.beginPath();
    ctx.ellipse(x + r * 0.45, y + r * 0.5, r * 0.95, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = opts.demesne ? 'rgba(224,185,58,0.95)' : 'rgba(0,0,0,0.55)';
    ctx.stroke();
    if (opts.sel || opts.hover) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = opts.sel ? '#fff3d0' : 'rgba(240,223,168,0.6)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  },

  /** 城池形制档次：0 县城 / 1 郡城 / 2 都城（势力治所） */
  cityTier(G, c) {
    if (Renderer._capitals && Renderer._capitals.has(c.id)) return 2;
    // 阈值随剧本数据走（相对分位），不写死绝对值
    if ((c.wallMax || 1) >= 3 || c.pop >= (Renderer._popHi || 140)) return 1;
    return 0;
  },

  /** 城池底平面尺寸：drawCity 与选中高亮共用这一份比例，别再各写一遍 */
  cityFoot(r, tier) {
    return { w: r * (tier === 2 ? 2.12 : 1.92), h: r * (tier === 2 ? 1.62 : 1.44) };
  },

  /**
   * 城池材质（docs/ART.md §1.3 ①）：城体是**建材**，不是势力色。
   * 势力色只留四处：旗 / 檐口 / 门匾 / 城下地环（+ 顶面 10% 染色，见 drawCity）。
   * 以前城体直接用势力色 → 地图上是一堆大色块，看不出是建筑。
   */
  CITY_MAT: {
    rammed: { base: '#6b6152', light: '#80745f', dark: '#443c32' },   // 夯土墙（县城）
    stone: { base: '#6e6a60', light: '#86806f', dark: '#48443c' },    // 砖石墙（郡城 / 都城）
    inner: { base: '#5c564a', light: '#6e6758', dark: '#3a352d' },    // 内城墙
    tileBlue: { base: '#3c4550', light: '#4e5867', dark: '#262c34' }, // 青瓦
    tileRed: { base: '#5a352f', light: '#71453b', dark: '#38201c' },  // 朱瓦（都城 / 帝都）
  },

  /** 档次定墙、档次+帝都定瓦 */
  cityMat(tier, imperial) {
    const M = Renderer.CITY_MAT;
    return {
      wall: tier >= 1 ? M.stone : M.rammed,
      roof: (imperial || tier >= 2) ? M.tileRed : M.tileBlue,
      inner: M.inner,
    };
  },

  /**
   * 双坡屋顶（ART.md §1.3 ②）：山墙朝南，西北来光 → 左坡受光。
   * bx/by = 墙身左上角，bw = 墙身宽，rise = 屋脊高，eave = 檐口色（势力色，可空）。
   */
  drawRoof(ctx, bx, by, bw, rise, mat, eave) {
    const inset = bw * 0.16;
    const ridge = by - rise;
    const mid = bx + bw / 2;
    // 左坡（受光）
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + inset, ridge);
    ctx.lineTo(mid, ridge); ctx.lineTo(mid, by);
    ctx.closePath();
    ctx.fillStyle = mat.light;
    ctx.fill();
    // 右坡（背光）
    ctx.beginPath();
    ctx.moveTo(mid, by); ctx.lineTo(mid, ridge);
    ctx.lineTo(bx + bw - inset, ridge); ctx.lineTo(bx + bw, by);
    ctx.closePath();
    ctx.fillStyle = mat.dark;
    ctx.fill();
    // 正脊高光
    if (bw >= 5) {
      ctx.beginPath();
      ctx.moveTo(bx + inset, ridge + 0.5);
      ctx.lineTo(bx + bw - inset, ridge + 0.5);
      ctx.strokeStyle = mat.light;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // 檐口：1px 压暗；给了 eave 就用势力色描一层（归属的“瓦当”感）
    ctx.fillStyle = eave ? eave : hexA(mat.dark, 0.9);
    ctx.fillRect(bx - 0.5, by - 1, bw + 1, 1);
  },

  /**
   * 城池符号：立面（南/东背光面）+ 顶面（外墙 + 雉堞 + 城门 + 院内暗影）
   * opts: { tier, wall, wallMax, demesne, player, z }
   * z = 立面高度（屏幕 px）。斜投影：顶面往光的反方向抬，露出南、东两面墙。
   */
  drawCity(ctx, x, y, r, color, opts) {
    const tier = opts.tier || 0;
    const mat = Renderer.cityMat(tier, opts.imperial);
    // 顶面染势力色：近景（lod2）只染 10%——城体靠材质与坡顶读，旗/门匾/檐口说归属；
    // 中景（lod1）不画门窗屋顶，且城只有十来个像素，颜色仍是唯一的归属线索，所以 tint=1 保留势力色。
    const wall = mixOf(mat.wall.base, color, opts.tint == null ? 0.1 : opts.tint);
    const foot = Renderer.cityFoot(r, tier);
    const w = foot.w;
    const h = foot.h;
    const top = y - h * 0.62;                 // 底平面（footprint 顶边）不动：命中/标签都还认这里
    const left = x - w / 2;
    const thick = Math.max(1.2, r * (0.14 + Math.min(5, opts.wall || 1) * 0.028));
    const merlon = Math.max(1.6, r * 0.22);
    const walls = tier === 2 ? 5 : tier === 1 ? 4 : 3;
    const bw = w / (walls + 2);

    const z = Math.max(0, opts.z || 0);
    const damaged = (opts.wallMax || 1) - (opts.wall || 1) > 0.5;   // 城墙被打过：缺堞 + 缺口
    const gapIdx = damaged ? Math.max(1, walls - 2) : -1;           // 塌掉的那一段（取中偏右，别贴着墙角）
    const dy = z;                              // 竖向抬升
    const dx = z * Renderer.ISO.skew;            // 横向偏移：露出东面墙（斜投影角度）

    // 地基阴影：往光的反方向（东南）拖，墙越高影子越长
    ctx.beginPath();
    ctx.ellipse(x + z * 0.5, y + h * 0.5 + z * 0.34, w * 0.62 + z * 0.18, h * 0.34 + z * 0.12,
      0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fill();

    // 护城河：城墙 3 级以上才成规模（docs/VISUAL.md §11.1）
    if (opts.detail !== false && (opts.wall || 1) >= 3) {
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.05, w / 2 + 5.5, h / 2 + 5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(70,110,120,0.55)';
      ctx.lineWidth = Math.max(1.6, r * 0.16);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(18,26,28,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // 帝都：一圈金边（谁挟天子，地图上一眼可辨）
    if (opts.imperial) {
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.05, w / 2 + 8, h / 2 + 7, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(224,185,58,0.75)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // 玩家直辖城光晕：底平面外扩一圈（城体只挡住中间，看起来仍是“脚下发光”）
    if (opts.glow) {
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.12, w / 2 + 7 + opts.glow * 2, h / 2 + 7 + opts.glow * 2, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(201,162,39,${0.10 + opts.glow * 0.07})`;
      ctx.fill();
    }

    // 选中/悬停：底平面高亮环（夹在地影与城体之间 —— 上弧被城挡、下弧不被地影盖）
    if (opts.ring) {
      ctx.beginPath();
      ctx.ellipse(x, y - h * 0.12, w / 2 + 5, h / 2 + 4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = opts.ring;
      ctx.lineWidth = opts.ringW || 1.5;
      ctx.stroke();
    }

    if (dy > 0.5) {
      // 立面 = 底平面到顶平面之间的侧面（平行四边形；顶面随后画，会盖住不该露的部分）
      // 西北来光 → 南面最暗、东面次暗
      const bt = top + h;                 // 底平面下边
      const tt = top + h - dy;            // 顶平面下边
      // 南面
      ctx.beginPath();
      ctx.moveTo(left, bt);
      ctx.lineTo(left + w, bt);
      ctx.lineTo(left + w + dx, tt);
      ctx.lineTo(left + dx, tt);
      ctx.closePath();
      ctx.fillStyle = shadeTint(wall, 0.62, -1);      // 南面：背光，偏冷
      ctx.fill();
      // 墙根 AO：下 1/3 再压一层，墙不再“飘”在地上
      ctx.beginPath();
      ctx.moveTo(left, bt - (bt - tt) * 0.34);
      ctx.lineTo(left + w, bt - (bt - tt) * 0.34);
      ctx.lineTo(left + w, bt);
      ctx.lineTo(left, bt);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fill();
      // 东面
      ctx.beginPath();
      ctx.moveTo(left + w, top);
      ctx.lineTo(left + w, bt);
      ctx.lineTo(left + w + dx, tt);
      ctx.lineTo(left + w + dx, top - dy);
      ctx.closePath();
      ctx.fillStyle = shadeTint(wall, 1.08, 1);       // 东面：受光，偏暖
      ctx.fill();
      // 城门：开在南面墙上，贴底边画（顶面盖不到）；高度约贴墙一半，门道才显气派
      const gw = Math.max(2.2, r * 0.34);
      const gh = Math.min(dy * 0.6, gw * 1.8);
      ctx.fillStyle = 'rgba(10,9,7,0.92)';
      ctx.fillRect(x - gw / 2, bt - gh, gw, gh);
      // 接地暗线
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(left, bt - 0.8, w + dx, 1.2);

      // 破损：南墙塌出一段缺口（与顶面少掉的那个雉堞同位置），前方散碎石
      if (gapIdx >= 0) {
        const gx = left + bw * 0.7 + gapIdx * ((w - bw * 1.4) / Math.max(1, walls - 1)) + dx * 0.5;
        const gwd = bw * 1.6, ght = dy * 0.62;
        ctx.fillStyle = 'rgba(8,7,5,0.5)';
        ctx.fillRect(gx - gwd / 2, bt - ght, gwd, ght);
        ctx.fillStyle = shadeTint(wall, 0.4, -1);
        for (let k = 0; k < 3; k++) {
          ctx.fillRect(gx - gwd / 2 + k * gwd * 0.34, bt - 1.4, gwd * 0.2, 1.4 + (k % 2));
        }
      }
    }

    // 顶面：整套原有画法，整体上抬 (dx, -dy)
    ctx.save();
    ctx.translate(dx, -dy);

    // 外墙
    ctx.fillStyle = wall;
    ctx.fillRect(left, top, w, h);
    // 院内（压暗，显出墙厚 = 城墙等级）
    ctx.fillStyle = 'rgba(12,10,8,0.34)';
    ctx.fillRect(left + thick, top + thick, w - thick * 2, h - thick * 2);

    // 雉堞
    ctx.fillStyle = wall;
    for (let i = 0; i < walls; i++) {
      if (i === gapIdx && tier > 0) continue;   // 塌掉一段
      const mx = left + bw * (0.7 + i * ((w - bw * 1.4) / Math.max(1, walls - 1)));
      ctx.fillRect(mx - bw * 0.32, top - merlon, bw * 0.64, merlon + 1);
    }

    const detail = opts.detail !== false;

    // 门楼：南墙正中一座小楼（城墙 2 级起），城越大越显眼
    if (detail && (opts.wall || 1) >= 2) {
      const gw = Math.max(3, w * 0.12), gh = Math.max(3, h * 0.16);
      const gx = left + w / 2 - gw / 2;
      const gy = top + h - gh * 0.35;
      ctx.fillStyle = mat.wall.light;
      ctx.fillRect(gx, gy, gw, gh);
      ctx.fillStyle = 'rgba(10,9,7,0.55)';
      ctx.fillRect(gx + gw * 0.3, gy + gh * 0.55, gw * 0.4, gh * 0.45);   // 门洞
      // 门匾：势力色，很小但一眼是“谁家城门”
      ctx.fillStyle = hexA(color, 0.85);
      ctx.fillRect(gx + gw * 0.28, gy + gh * 0.1, gw * 0.44, 1.5);
      // 坡顶门楼：天际线就在这里变好看
      Renderer.drawRoof(ctx, gx - gw * 0.06, gy, gw * 1.12, Math.max(1.6, gh * 0.62), mat.roof, hexA(color, 0.7));
    }

    // 角楼 / 箭楼：座数随城墙等级走（郡城 1~2 座后角，都城 2~4 座、前角即箭楼）
    if (detail && tier >= 1) {
      const t = Math.max(2, r * 0.3);
      const wallLv = opts.wall || 1;
      const towers = tier === 2
        ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].slice(0, wallLv >= 3 ? 4 : 2)
        : [[-1, -1], [1, -1]].slice(0, wallLv >= 2 ? 2 : 1);
      ctx.fillStyle = mat.wall.base;
      towers.forEach(([sx, sy], i) => {
        // 城墙被打塌：塌掉最后一座角楼，只在原地留一堆碎石
        if (damaged && i === towers.length - 1) return;
        const tx = sx < 0 ? left - t * 0.5 : left + w - t * 0.5;
        const ty = sy < 0 ? top - t * 0.5 : top + h - t * 0.5;
        ctx.fillRect(tx, ty, t, t);
        // 角楼檐帽：只画大一点的（小楼加了反而脏），势力色檐口
        if (t >= 5) Renderer.drawRoof(ctx, tx, ty, t, Math.max(1.4, t * 0.55), mat.roof, t >= 7 ? hexA(color, 0.55) : null);
      });
      if (damaged) {
        const [sx, sy] = towers[towers.length - 1];
        const tx = sx < 0 ? left - t * 0.5 : left + w - t * 0.5;
        const ty = sy < 0 ? top - t * 0.5 : top + h - t * 0.5;
        ctx.fillStyle = 'rgba(10,9,7,0.55)';
        ctx.fillRect(tx, ty, t, t);
        ctx.fillStyle = shadeTint(wall, 0.42, -1);
        for (let k = 0; k < 4; k++) {
          ctx.fillRect(tx - t * 0.2 + k * t * 0.36, ty + t * 0.72, t * 0.24, t * 0.3);
        }
      }
    }

    // 内城（都城）：内墙用更深的石色，主楼给朱瓦重檐
    if (detail && tier === 2) {
      const iw = w * 0.44, ih = h * 0.46;
      const iy = y - h * 0.16 - ih;
      ctx.fillStyle = mat.inner.base;
      ctx.fillRect(x - iw / 2, iy, iw, ih);
      ctx.fillStyle = 'rgba(12,10,8,0.42)';
      ctx.fillRect(x - iw / 2 + thick * 0.7, iy + thick * 0.7, iw - thick * 1.4, ih - thick * 1.4);
      // 内城雉堞：都城是"双重城墙"，顶上还有一圈小堞
      ctx.fillStyle = mat.inner.base;
      const inm = 5, imw = Math.max(1.2, bw * 0.4), imh = Math.max(1.2, merlon * 0.68);
      for (let i = 0; i < inm; i++) {
        const mx = x - iw / 2 + imw * 0.9 + i * ((iw - imw * 1.8) / (inm - 1));
        ctx.fillRect(mx - imw / 2, iy - imh, imw, imh + 1);
      }
      // 主楼：墙身 + 朱瓦坡顶（原来的平檐改成真正的屋顶）
      const hw = iw * 0.56, hh = ih * 0.4;
      const hx = x - hw / 2, hy = iy + ih * 0.16;
      ctx.fillStyle = mat.inner.light;
      ctx.fillRect(hx, hy, hw, hh);
      ctx.fillStyle = 'rgba(10,9,7,0.5)';
      ctx.fillRect(hx + hw * 0.34, hy + hh * 0.5, hw * 0.32, hh * 0.5);   // 主楼门洞
      Renderer.drawRoof(ctx, hx - hw * 0.08, hy, hw * 1.16, Math.max(2, r * 0.34), mat.roof, hexA(color, 0.6));
    }

    // 城门已画在南面墙上（见上）

    // 墙线
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);

    // 破损：墙体斜裂
    if (detail && damaged) {
      ctx.strokeStyle = 'rgba(10,9,7,0.75)';
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(left + w * 0.72, top + 1);
      ctx.lineTo(left + w * 0.82, top + h * 0.5);
      ctx.lineTo(left + w * 0.74, top + h - 1);
      ctx.stroke();
    }

    // 直辖：金边
    if (opts.demesne) {
      ctx.strokeStyle = 'rgba(224,185,58,0.95)';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(left - 1, top - 1, w + 2, h + 2);
    }
    // 我方势力：城内一点白
    if (opts.player) {
      ctx.beginPath();
      ctx.arc(x, y - h * 0.18, Math.max(1.2, r * 0.16), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
    }

    ctx.restore();   // 顶面结束

    // 南墙垛口：城头正面那排小方块，画在顶面之后才压得住屋顶前沿
    if (dy > 0.5 && opts.detail !== false) {
      const tt = top + h - dy;
      const mw = bw * 0.64;
      const mh = merlon * 0.8;
      ctx.fillStyle = shadeTint(wall, 0.72, -1);
      for (let i = 0; i < walls; i++) {
        if (i === gapIdx && tier > 0) continue;
        const mx = left + bw * (0.7 + i * ((w - bw * 1.4) / Math.max(1, walls - 1)));
        ctx.fillRect(mx - mw / 2 + dx, tt - mh, mw, mh + 1);
      }
    }
  },

  /** 城外营帐：驻军逼近兵额时出现，表示兵的规模 */
  drawCamp(ctx, x, y, r, count) {
    for (let i = 0; i < count; i++) {
      const px = x - r * 1.55 - i * r * 0.72;
      const py = y + r * 0.78 + (i % 2) * r * 0.22;
      const s = r * 0.34;
      ctx.beginPath();
      ctx.moveTo(px, py - s);
      ctx.lineTo(px + s * 0.85, py);
      ctx.lineTo(px - s * 0.85, py);
      ctx.closePath();
      ctx.fillStyle = 'rgba(216,203,178,0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,17,13,0.55)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  },

  /** 势力旗：旗色即势力色；旗面轻微飘动；放大时写势力首字；lift = 随城抬升量 */
  drawFlag(ctx, x, y, r, color, label, lift) {
    const px = x + r * 1.35;
    const up = lift || 0;
    const y0 = y - r * 1.55 - up;
    const fw = Math.max(8, r * 1.15);
    const fh = Math.max(5.5, r * 0.78);
    const flap = Math.sin(Renderer._t / 240 + x * 0.04) * Math.max(0.5, r * 0.09);

    ctx.strokeStyle = 'rgba(24,20,15,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(px, y + r * 0.2 - up);
    ctx.lineTo(px, y0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(px, y0);
    ctx.lineTo(px + fw + flap, y0 + fh * 0.18);
    ctx.lineTo(px + fw * 0.74 + flap * 0.6, y0 + fh * 0.5);
    ctx.lineTo(px + fw + flap, y0 + fh * 0.82);
    ctx.lineTo(px, y0 + fh);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    if (label) {
      ctx.fillStyle = 'rgba(252,246,230,0.95)';
      ctx.font = `${Math.round(fh * 0.74)}px "Noto Serif SC",serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, px + fw * 0.52 + flap * 0.5, y0 + fh * 0.52);
    }
  },

  _star(ctx, x, y, r, color) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? r * 0.45 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  },

  /**
   * 兵符图例：五种形状 + 单字，画在罗盘上方（屏幕坐标）。
   * 形状直接复用 _armyPath —— 图例与地图上的符号只有一份几何。
   */
  drawArmyKey(ctx, right, y) {
    const items = [['inf', '步'], ['arc', '弓'], ['cav', '骑'], ['nvy', '水'], ['siege', '器']];
    const s = 4.6, gap = 26;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '9px "Noto Serif SC",serif';
    items.forEach(([kind, label], i) => {
      const cx = right - (items.length - 1 - i) * gap;
      ctx.save();
      ctx.translate(cx, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = 'rgba(201,162,39,0.55)';
      ctx.beginPath();
      Renderer._armyPath(ctx, kind, s);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(201,162,39,0.7)';
      ctx.fillText(label, cx, y + 11);
    });
    ctx.restore();
  },

  /** 右下角罗盘：小幅地图仪器感，画在屏幕坐标系 */
  drawCompass(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(201,162,39,0.28)';
    ctx.fillStyle = 'rgba(201,162,39,0.30)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.stroke();

    // 四向针尖（上方为北）
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.rotate(i * Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(3.2, -6);
      ctx.lineTo(-3.2, -6);
      ctx.closePath();
      ctx.fillStyle = i === 0 ? 'rgba(224,185,58,0.75)' : 'rgba(201,162,39,0.35)';
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(224,185,58,0.75)';
    ctx.font = '9px "Noto Serif SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('北', 0, -27);
    ctx.restore();
  },
};

function rgbOf(hex) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexA(hex, a) {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** 压暗（k<1）：立面背光面用 —— 势力色千变万化，只能按比例算 */
function shade(hex, k) {
  const [r, g, b] = rgbOf(hex);
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

/**
 * 带色温的明暗（ART.md §1.3 ③）：立体感靠冷暖，不只靠明度。
 * warm = 1 → 往暖推（受光面），-1 → 往冷推（背光面）。
 */
function shadeTint(hex, k, warm) {
  const [r, g, b] = rgbOf(hex);
  const t = (warm || 0) * 5;
  return `rgb(${Math.round(U.clamp(r * k + t, 0, 255))},${Math.round(U.clamp(g * k + t * 0.4, 0, 255))},${Math.round(U.clamp(b * k - t, 0, 255))})`;
}

/** 两色混合：城池顶面 = 材质色 + 10% 势力色（返回 hex，下游 shadeTint/hexA 只认 hex） */
function mixOf(a, b, t) {
  const A = rgbOf(a), B = rgbOf(b);
  const m = i => Math.round(A[i] + (B[i] - A[i]) * t);
  return '#' + [m(0), m(1), m(2)].map(v => v.toString(16).padStart(2, '0')).join('');
}
