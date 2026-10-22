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

      // 外圈
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,9,7,0.75)';
      ctx.fill();

      // 主体
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = isDemesne ? 2 : 1;
      ctx.strokeStyle = isDemesne ? '#e0b93a' : hexA('#000000', 0.55);
      ctx.stroke();

      // 我方势力标记
      if (isPlayer) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fill();
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
      } else if (isHover && Renderer.targeting) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(224,96,80,0.9)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      // 名称
      const fs = U.clamp(11 * z + 2, 10, 15);
      ctx.font = `${fs}px "Noto Serif SC",serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = 'rgba(6,5,4,0.92)';
      ctx.strokeText(c.name, p.x, p.y + r + 3);
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
  },
};

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
