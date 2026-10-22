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

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = Renderer.canvas.getBoundingClientRect();
    Renderer.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    Renderer.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    Renderer._dpr = dpr;
    Renderer.cw = rect.width;
    Renderer.ch = rect.height;
  },

  attach(G) {
    Renderer.G = G;
    Renderer.terrain = GameMap.prerender(GameMap.generate(G.meta.seed), Object.values(G.cities));
    const home = G.cities[G.player.homeCityId];
    if (home) Renderer.centerOn(home.x, home.y);
  },

  centerOn(x, y) { Renderer.cam.x = x; Renderer.cam.y = y; },

  /** 缓动飞行到世界坐标（小地图/定位/回中都用它） */
  flyTo(x, y, ms) {
    Renderer._inertia = null;
    Renderer._fly = {
      x0: Renderer.cam.x, y0: Renderer.cam.y,
      x1: U.clamp(x, -200, GameMap.W + 200),
      y1: U.clamp(y, -200, GameMap.H + 200),
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

  zoomBy(f) {
    const z = U.clamp(Renderer.cam.zoom * f, 0.28, 2.2);
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

  /** 命中城池 */
  pick(G, sx, sy) {
    const z = Renderer.cam.zoom;
    let best = null, bestD = Infinity;
    for (const c of Object.values(G.cities)) {
      const p = Renderer.toScreen(c.x, c.y);
      const r = (7 + c.pop / 45) * Math.max(0.75, z) + 8;
      const d = U.dist(sx, sy, p.x, p.y);
      if (d < r && d < bestD) { best = c; bestD = d; }
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

    // 城池
    for (const c of Object.values(G.cities)) {
      const p = Renderer.toScreen(c.x, c.y);
      if (p.x < -60 || p.y < -60 || p.x > cw + 60 || p.y > ch + 60) continue;

      const f = G.factions[c.owner];
      const color = f ? f.color : '#888';
      const isPlayer = c.owner === playerFid;
      const isDemesne = c.grantedTo === PLAYER_HERO_ID;
      const isSel = c.id === Renderer.selectedId;
      const isHover = c.id === Renderer.hoverId;

      const r = (7 + c.pop / 45) * Math.max(0.75, z);
      // 标记 LOD：远看色点，中看城+旗，近看字与兵数
      const lod = z < 0.5 ? 0 : z < 0.8 ? 1 : 2;

      // 玩家直辖城光晕
      if (isDemesne) {
        const pulse = 0.5 + 0.5 * Math.sin(Renderer._t / 600);
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
      Renderer.drawCity(ctx, p.x, p.y, r, color, {
        tier: Renderer.cityTier(G, c),
        wall: c.wall,
        wallMax: State.wallMaxOf(c),
        detail: lod >= 2,
        demesne: isDemesne,
        player: isPlayer,
      });

      // 驻军规模：城外营帐（近景才画）
      if (lod >= 2) {
        const fill = troopTotal(c.garrison) / Math.max(1, Renderer.capOf(G, c, Renderer._now));
        if (fill > 0.6) Renderer.drawCamp(ctx, p.x, p.y, r, fill > 1.15 ? 3 : fill > 0.85 ? 2 : 1);
      }

      // 势力旗：旗色即势力色，放大时旗上写势力首字
      if (f && c.owner !== 'free') {
        Renderer.drawFlag(ctx, p.x, p.y, r, color, lod >= 2 ? f.name.slice(0, 1) : '');
      }

      // 治所：城头一颗小星（近景才画）
      if (lod >= 2 && Renderer._capitals && Renderer._capitals.has(c.id)) {
        Renderer._star(ctx, p.x, p.y - r * 1.15, Math.max(2.6, r * 0.28), 'rgba(240,223,168,0.9)');
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

      // 选中/悬停
      if (isSel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff3d0';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else if (isHover) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = Renderer.targeting ? 'rgba(224,96,80,0.9)' : 'rgba(240,223,168,0.55)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
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

    // 军队标记
    for (const a of Object.values(G.armies)) {
      const p = Renderer.toScreen(a.x, a.y);
      if (p.x < -40 || p.y < -40 || p.x > cw + 40 || p.y > ch + 40) continue;
      const f = G.factions[a.factionId];
      const color = f ? f.color : '#888';
      const isMine = a.factionId === playerFid;
      const size = U.clamp(7 * Math.max(0.8, z), 6, 13);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(size, 0);
      ctx.lineTo(-size * 0.7, size * 0.75);
      ctx.lineTo(-size * 0.7, -size * 0.75);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = isMine ? '#ffe9a8' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
      ctx.restore();

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
    }

    // 目标选择模式的十字说明
    if (Renderer.targeting) {
      ctx.fillStyle = 'rgba(224,96,80,0.9)';
      ctx.font = '13px "Noto Serif SC",serif';
      ctx.textAlign = 'center';
      ctx.fillText('选择进军目标（Esc 取消）', cw / 2, 26);
    }

    Renderer.drawFx(ctx, G);
    Renderer.drawCompass(ctx, cw - 44, ch - 44);
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
    const best = {};
    for (const c of Object.values(G.cities)) {
      if (!c.owner || c.owner === 'free') continue;
      const w = c.pop + c.wall * 60;
      if (!best[c.owner] || w > best[c.owner].w) best[c.owner] = { w, id: c.id };
    }
    return new Set(Object.values(best).map(b => b.id));
  },

  /** 远景城池：只画一个色点（带直辖金环与选中反馈） */
  drawCityDot(ctx, x, y, r, color, opts) {
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

  /**
   * 城池符号：外墙（势力色）+ 雉堞（按档次 3/4/5 个）+ 城门 + 院内暗影
   * opts: { tier, wall, wallMax, demesne, player }
   */
  drawCity(ctx, x, y, r, color, opts) {
    const tier = opts.tier || 0;
    const w = r * (tier === 2 ? 2.12 : 1.92);
    const h = r * (tier === 2 ? 1.62 : 1.44);
    const top = y - h * 0.62;
    const left = x - w / 2;
    const thick = Math.max(1.2, r * (0.14 + Math.min(5, opts.wall || 1) * 0.028));
    const merlon = Math.max(1.6, r * 0.22);
    const walls = tier === 2 ? 5 : tier === 1 ? 4 : 3;
    const bw = w / (walls + 2);

    // 地基阴影
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.56, w * 0.6, h * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fill();

    // 外墙
    ctx.fillStyle = color;
    ctx.fillRect(left, top, w, h);
    // 院内（压暗，显出墙厚 = 城墙等级）
    ctx.fillStyle = 'rgba(12,10,8,0.34)';
    ctx.fillRect(left + thick, top + thick, w - thick * 2, h - thick * 2);

    // 雉堞
    ctx.fillStyle = color;
    const damaged = (opts.wallMax || 1) - (opts.wall || 1) > 0.5;
    for (let i = 0; i < walls; i++) {
      if (damaged && i === walls - 1 && tier > 0) continue;   // 塌掉一段
      const mx = left + bw * (0.7 + i * ((w - bw * 1.4) / Math.max(1, walls - 1)));
      ctx.fillRect(mx - bw * 0.32, top - merlon, bw * 0.64, merlon + 1);
    }

    const detail = opts.detail !== false;

    // 角楼（郡城起）
    if (detail && tier >= 1) {
      const t = Math.max(2, r * 0.3);
      ctx.fillStyle = color;
      ctx.fillRect(left - t * 0.5, top - t * 0.5, t, t);
      ctx.fillRect(left + w - t * 0.5, top - t * 0.5, t, t);
    }

    // 内城（都城）
    if (detail && tier === 2) {
      const iw = w * 0.44, ih = h * 0.46;
      ctx.fillStyle = color;
      ctx.fillRect(x - iw / 2, y - h * 0.16 - ih, iw, ih);
      ctx.fillStyle = 'rgba(12,10,8,0.42)';
      ctx.fillRect(x - iw / 2 + thick * 0.7, y - h * 0.16 - ih + thick * 0.7, iw - thick * 1.4, ih - thick * 1.4);
      // 主楼檐顶
      ctx.fillStyle = 'rgba(20,16,12,0.75)';
      ctx.fillRect(x - iw * 0.58, y - h * 0.16 - ih - Math.max(1.4, r * 0.14), iw * 1.16, Math.max(1.4, r * 0.14));
    }

    // 城门
    const gw = Math.max(2.2, r * 0.34);
    ctx.fillStyle = 'rgba(10,9,7,0.9)';
    ctx.fillRect(x - gw / 2, y + h * 0.06, gw, h * 0.34);

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

  /** 势力旗：旗色即势力色；旗面轻微飘动；放大时写势力首字 */
  drawFlag(ctx, x, y, r, color, label) {
    const px = x + r * 1.35;
    const y0 = y - r * 1.55;
    const fw = Math.max(8, r * 1.15);
    const fh = Math.max(5.5, r * 0.78);
    const flap = Math.sin(Renderer._t / 240 + x * 0.04) * Math.max(0.5, r * 0.09);

    ctx.strokeStyle = 'rgba(24,20,15,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(px, y + r * 0.2);
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

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
