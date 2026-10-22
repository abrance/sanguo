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
    Renderer.terrain = GameMap.prerender(GameMap.generate(G.meta.seed));
    const home = G.cities[G.player.homeCityId];
    if (home) Renderer.centerOn(home.x, home.y);
  },

  centerOn(x, y) { Renderer.cam.x = x; Renderer.cam.y = y; },

  zoomBy(f) {
    const z = U.clamp(Renderer.cam.zoom * f, 0.28, 2.2);
    Renderer.cam.zoom = z;
  },

  panBy(dxScreen, dyScreen) {
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
      ctx.drawImage(Renderer.terrain, 0, 0);
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
      ctx.drawImage(Renderer.territoryLayer(G), 0, 0, GameMap.W, GameMap.H);
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

      // 玩家直辖城光晕
      if (isDemesne) {
        const pulse = 0.5 + 0.5 * Math.sin(Renderer._t / 600);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 7 + pulse * 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(201,162,39,${0.10 + pulse * 0.07})`;
        ctx.fill();
      }

      // 城池：城墙 + 雉堞 + 城门（矩形读作城，不是色点）
      Renderer.drawCity(ctx, p.x, p.y, r, color, { demesne: isDemesne, player: isPlayer });

      // 势力旗：旗色即势力色，放大时旗上写势力首字
      if (f && c.owner !== 'free') {
        Renderer.drawFlag(ctx, p.x, p.y, r, color, z > 0.72 ? f.name.slice(0, 1) : '');
      }

      // 治所：城头一颗小星
      if (Renderer._capitals && Renderer._capitals.has(c.id)) {
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
      if (z > 0.72) {
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

    Renderer.drawCompass(ctx, cw - 44, ch - 44);
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
    Renderer._capitals = Renderer.capitals(G);
    return cv;
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

  /** 城池符号：外墙（势力色）+ 雉堞 + 城门 + 院内暗影 */
  drawCity(ctx, x, y, r, color, opts) {
    const w = r * 1.92, h = r * 1.44;
    const top = y - h * 0.62;
    const left = x - w / 2;
    const merlon = Math.max(1.6, r * 0.22);
    const bw = w / 5;

    // 地基阴影
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.56, w * 0.6, h * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.fill();

    // 外墙
    ctx.fillStyle = color;
    ctx.fillRect(left, top, w, h);
    // 院内（压暗，显出墙厚）
    ctx.fillStyle = 'rgba(12,10,8,0.34)';
    ctx.fillRect(left + merlon * 0.7, top + merlon * 0.7, w - merlon * 1.4, h - merlon * 1.4);

    // 雉堞
    ctx.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      const mx = left + bw * (0.55 + i * 1.45);
      ctx.fillRect(mx, top - merlon, bw * 0.9, merlon + 1);
    }

    // 城门
    const gw = Math.max(2.2, r * 0.34);
    ctx.fillStyle = 'rgba(10,9,7,0.9)';
    ctx.fillRect(x - gw / 2, y + h * 0.06, gw, h * 0.34);

    // 墙线
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);

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

  /** 势力旗：旗色即势力色；放大时旗面写势力首字 */
  drawFlag(ctx, x, y, r, color, label) {
    const px = x + r * 1.35;
    const y0 = y - r * 1.55;
    const fw = Math.max(8, r * 1.15);
    const fh = Math.max(5.5, r * 0.78);

    ctx.strokeStyle = 'rgba(24,20,15,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.moveTo(px, y + r * 0.2);
    ctx.lineTo(px, y0);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(px, y0);
    ctx.lineTo(px + fw, y0 + fh * 0.18);
    ctx.lineTo(px + fw * 0.74, y0 + fh * 0.5);
    ctx.lineTo(px + fw, y0 + fh * 0.82);
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
      ctx.fillText(label, px + fw * 0.52, y0 + fh * 0.52);
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
