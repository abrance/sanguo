// 地图生成：地形网格 + 预渲染
const GameMap = {
  W: 2400, H: 1800,
  CELL: 40,
  get cols() { return GameMap.W / GameMap.CELL; },
  get rows() { return GameMap.H / GameMap.CELL; },

  // ── 山脉（折线） ──
  RIDGES: [
    // 秦岭
    [[700, 782], [800, 772], [900, 766], [1000, 762]],
    // 太行
    [[1008, 470], [1016, 560], [1032, 652]],
    // 燕山
    [[1288, 242], [1400, 216], [1520, 200], [1650, 192]],
    // 大巴 / 巫山
    [[676, 900], [706, 968], [742, 1042]],
    // 南岭
    [[1040, 1332], [1140, 1332], [1246, 1344]],
    // 阴山
    [[618, 300], [740, 262], [862, 232]],
    // 祁连
    [[248, 604], [352, 562], [452, 542]],
    // 天目
    [[1478, 1100], [1542, 1152], [1600, 1180]],
  ],

  // ── 河流（折线） ──
  RIVERS: [
    // 黄河
    [[600, 622], [720, 602], [840, 600], [962, 612], [1042, 652], [1152, 700], [1262, 692], [1382, 652], [1502, 612], [1622, 602]],
    // 长江
    [[478, 1142], [622, 1132], [762, 1162], [902, 1182], [1042, 1152], [1162, 1122], [1302, 1152], [1442, 1172], [1562, 1202], [1662, 1242]],
  ],

  // 点到折线的最近距离
  _distToPath(x, y, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      let t = ((x - x1) * dx + (y - y1) * dy) / len2;
      t = U.clamp(t, 0, 1);
      const px = x1 + dx * t, py = y1 + dy * t;
      const d = U.dist(x, y, px, py);
      if (d < best) best = d;
    }
    return best;
  },

  // ── 值噪声 ──
  _hash(ix, iy) {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  },

  _smooth(t) { return t * t * (3 - 2 * t); },

  _noise(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = GameMap._smooth(x - x0), fy = GameMap._smooth(y - y0);
    const a = GameMap._hash(x0, y0), b = GameMap._hash(x0 + 1, y0);
    const c = GameMap._hash(x0, y0 + 1), d = GameMap._hash(x0 + 1, y0 + 1);
    return U.lerp(U.lerp(a, b, fx), U.lerp(c, d, fx), fy);
  },

  _fbm(x, y) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < 4; i++) {
      v += GameMap._noise(x * f, y * f) * amp;
      f *= 2.05; amp *= 0.5;
    }
    return v; // 约 0..1
  },

  /** 生成地形网格 grid[row][col] = terrainKey */
  generate(seed) {
    const cols = GameMap.cols, rows = GameMap.rows, CELL = GameMap.CELL;
    const grid = [];
    const ox = (seed % 1000) * 0.37;

    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const x = c * CELL + CELL / 2;
        const y = r * CELL + CELL / 2;

        const h = GameMap._fbm(x / 320 + ox, y / 320 + ox);
        const moist = GameMap._fbm(x / 420 + 57 + ox, y / 420 + 91 + ox);

        let ridgeD = Infinity;
        for (const p of GameMap.RIDGES) ridgeD = Math.min(ridgeD, GameMap._distToPath(x, y, p));
        let riverD = Infinity;
        for (const p of GameMap.RIVERS) riverD = Math.min(riverD, GameMap._distToPath(x, y, p));

        let t;
        if (riverD < 16) t = 'water';
        else if (riverD < 46) t = 'marsh';
        else if (ridgeD < 26) t = 'mountain';
        else if (ridgeD < 78) t = 'hill';
        else if (x < 540 && y < 660) t = 'desert';
        else if (h > 0.605) t = 'mountain';
        else if (h > 0.515) t = 'hill';
        else if (moist > 0.565) t = 'forest';
        else if (moist < 0.33) t = 'marsh';
        else t = 'plain';

        row.push(t);
      }
      grid.push(row);
    }
    return grid;
  },

  terrainAt(grid, x, y) {
    const c = Math.floor(x / GameMap.CELL);
    const r = Math.floor(y / GameMap.CELL);
    if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length) return 'plain';
    return grid[r][c];
  },

  /** 预渲染地形到底图 canvas */
  prerender(grid) {
    const cv = document.createElement('canvas');
    cv.width = GameMap.W; cv.height = GameMap.H;
    const g = cv.getContext('2d');

    // 底色
    g.fillStyle = '#2a2b22';
    g.fillRect(0, 0, GameMap.W, GameMap.H);

    const CELL = GameMap.CELL;
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[r].length; c++) {
        const t = grid[r][c];
        const base = TERRAIN[t].color;
        g.fillStyle = base;
        g.fillRect(c * CELL, r * CELL, CELL + 1, CELL + 1);

        // 细碎纹理
        const n = GameMap._hash(c * 7 + 1, r * 13 + 3);
        g.fillStyle = `rgba(255,255,255,${(n * 0.045).toFixed(3)})`;
        g.fillRect(c * CELL, r * CELL, CELL + 1, CELL + 1);

        if (t === 'mountain') {
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.beginPath();
          g.moveTo(c * CELL + CELL * 0.5, r * CELL + CELL * 0.18);
          g.lineTo(c * CELL + CELL * 0.86, r * CELL + CELL * 0.86);
          g.lineTo(c * CELL + CELL * 0.14, r * CELL + CELL * 0.86);
          g.closePath();
          g.fill();
        } else if (t === 'forest') {
          g.fillStyle = 'rgba(10,25,10,0.22)';
          const n2 = GameMap._hash(c * 3, r * 5);
          for (let k = 0; k < 3; k++) {
            const px = c * CELL + 6 + ((n2 * (k + 1) * 97) % (CELL - 12));
            const py = r * CELL + 8 + ((n2 * (k + 2) * 61) % (CELL - 14));
            g.beginPath();
            g.arc(px, py, 3.2, 0, Math.PI * 2);
            g.fill();
          }
        } else if (t === 'water') {
          g.fillStyle = 'rgba(120,180,220,0.10)';
          g.fillRect(c * CELL, r * CELL + CELL * 0.4, CELL, 2);
        }
      }
    }

    // 河流高光
    g.strokeStyle = 'rgba(120,175,215,0.42)';
    g.lineWidth = 9;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const p of GameMap.RIVERS) {
      g.beginPath();
      g.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
      g.stroke();
    }

    // 山脉描边
    g.strokeStyle = 'rgba(20,18,14,0.35)';
    g.lineWidth = 26;
    for (const p of GameMap.RIDGES) {
      g.beginPath();
      g.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]);
      g.stroke();
    }

    // 四周暗角
    const grad = g.createRadialGradient(
      GameMap.W / 2, GameMap.H / 2, GameMap.H * 0.35,
      GameMap.W / 2, GameMap.H / 2, GameMap.H * 0.9);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, GameMap.W, GameMap.H);

    return cv;
  },
};
