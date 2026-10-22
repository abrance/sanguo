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
    GameMap._ox = ox;   // prerender 用同一套噪声偏移

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

  /** 预渲染地形：低分辨率平滑色床 + 全分辨率手绘细节（无方格感） */
  prerender(grid) {
    const W = GameMap.W, H = GameMap.H, CELL = GameMap.CELL;
    const ox = GameMap._ox || 0;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';

    // ── 1. 色床：0.4 倍分辨率逐像素上色（双线性取噪声，避开方块边） ──
    const S = 0.4;
    const LW = Math.round(W * S), LH = Math.round(H * S);
    const low = document.createElement('canvas');
    low.width = LW; low.height = LH;
    const lg = low.getContext('2d');
    const img = lg.createImageData(LW, LH);

    // 噪声格：低分辨率每 4 像素一格（= 世界 10 像素），足够平滑
    const STEP = 4;
    const NW = Math.ceil(LW / STEP) + 2, NH = Math.ceil(LH / STEP) + 2;
    const hf = new Float32Array(NW * NH);
    const wf = new Float32Array(NW * NH);
    for (let j = 0; j < NH; j++) {
      for (let i = 0; i < NW; i++) {
        const wx = (i * STEP) / S, wy = (j * STEP) / S;
        hf[j * NW + i] = GameMap._fbm(wx / 300 + ox, wy / 300 + ox);
        wf[j * NW + i] = GameMap._fbm(wx / 430 + 57 + ox, wy / 430 + 91 + ox);
      }
    }
    const field = (f, fx, fy) => {
      const i = Math.floor(fx), j = Math.floor(fy);
      const tx = fx - i, ty = fy - j;
      const a = f[j * NW + i], b = f[j * NW + i + 1];
      const c2 = f[(j + 1) * NW + i], d2 = f[(j + 1) * NW + i + 1];
      return (a + (b - a) * tx) * (1 - ty) + (c2 + (d2 - c2) * tx) * ty;
    };

    const C = {
      water: [28, 44, 56], waterHi: [48, 76, 94],
      marsh: [46, 60, 52],
      plain: [78, 88, 58], plainHi: [96, 104, 68],
      forest: [42, 58, 38], forestHi: [60, 78, 46],
      hill: [90, 82, 60],
      rock: [104, 98, 82], snow: [172, 166, 150],
      desert: [108, 94, 66], desertHi: [130, 116, 86],
    };
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    const data = img.data;
    const rows = grid.length, cols = grid[0].length;
    for (let y = 0; y < LH; y++) {
      const wy = y / S;
      const gy = Math.min(rows - 1, Math.floor(wy / CELL));
      for (let x = 0; x < LW; x++) {
        const wx = x / S;
        const key = grid[gy][Math.min(cols - 1, Math.floor(wx / CELL))];

        const fx = x / STEP, fy = y / STEP;
        const h = field(hf, fx, fy);
        const wet = field(wf, fx, fy);

        let col;
        if (key === 'water') col = mix(C.water, C.waterHi, U.clamp((h - 0.28) * 2.4, 0, 1));
        else if (key === 'marsh') col = mix(C.marsh, C.water, U.clamp(wet * 0.55, 0, 0.4));
        else if (key === 'forest') col = mix(C.forest, C.forestHi, wet);
        else if (key === 'hill') col = mix(C.hill, C.plain, U.clamp((0.56 - h) * 2.2, 0, 1));
        else if (key === 'mountain') col = mix(C.rock, C.snow, U.clamp((h - 0.6) * 3.2, 0, 0.8));
        else if (key === 'desert') col = mix(C.desert, C.desertHi, U.clamp(h * 1.7, 0, 1));
        else col = mix(C.plain, C.plainHi, U.clamp((wet - 0.34) * 2, 0, 1));

        // 西北来光的山体侧影
        const dhx = field(hf, fx + 1, fy) - field(hf, fx - 1, fy);
        const dhy = field(hf, fx, fy + 1) - field(hf, fx, fy - 1);
        const shade = U.clamp(0.5 + (dhx + dhy) * 2.6, 0.15, 1);
        const k = 0.86 + shade * 0.30;

        const n = (GameMap._hash(x * 3 + 7, y * 5 + 11) - 0.5) * 9;
        const o = (y * LW + x) * 4;
        data[o] = U.clamp(col[0] * k + n, 0, 255);
        data[o + 1] = U.clamp(col[1] * k + n, 0, 255);
        data[o + 2] = U.clamp(col[2] * k + n * 0.8, 0, 255);
        data[o + 3] = 255;
      }
    }

    lg.putImageData(img, 0, 0);
    g.drawImage(low, 0, 0, W, H);

    // ── 2. 河川：岸 / 水体 / 高光三叠 ──
    const pass = (pts, style, width, alpha) => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
      }
      const last = pts[pts.length - 1];
      g.lineTo(last[0], last[1]);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = style;
      g.globalAlpha = alpha;
      g.lineWidth = width;
      g.stroke();
      g.globalAlpha = 1;
    };
    for (const p of GameMap.RIVERS) {
      pass(p, '#2c4148', 30, 0.5);
      pass(p, '#3d6a7e', 16, 0.75);
      pass(p, '#7fb3c9', 3, 0.28);
    }

    // ── 3. 山形 / 树丛 / 沙丘：老地图式符号 ──
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r][c];
        const n1 = GameMap._hash(c * 11 + 5, r * 17 + 2);
        const bx = c * CELL, by = r * CELL;

        if (t === 'mountain') {
          if (n1 > 0.5) continue;
          const px = bx + CELL * (0.2 + GameMap._hash(c, r) * 0.6);
          const py = by + CELL * (0.34 + GameMap._hash(c + 3, r + 7) * 0.46);
          GameMap._peak(g, px, py, 9 + GameMap._hash(c + 9, r + 1) * 13);
        } else if (t === 'forest') {
          if (n1 > 0.55) continue;
          for (let k = 0; k < 3; k++) {
            const px = bx + 6 + GameMap._hash(c * 3 + k, r * 5 + k) * (CELL - 12);
            const py = by + 6 + GameMap._hash(c * 7 + k, r * 3 + k + 9) * (CELL - 12);
            GameMap._tree(g, px, py, 2.4 + GameMap._hash(c + k, r + k) * 1.6);
          }
        } else if (t === 'desert') {
          if (n1 > 0.35) continue;
          g.beginPath();
          const px = bx + CELL * 0.2, py = by + CELL * (0.3 + n1);
          g.moveTo(px, py);
          g.quadraticCurveTo(px + CELL * 0.3, py - 5, px + CELL * 0.62, py + 1);
          g.strokeStyle = 'rgba(190,170,130,0.16)';
          g.lineWidth = 1.4;
          g.stroke();
        }
      }
    }

    // ── 4. 纸纹与纤维 ──
    for (let i = 0; i < 5200; i++) {
      const n1 = GameMap._hash(i * 7 + 3, 101), n2 = GameMap._hash(i * 13 + 5, 211);
      const n3 = GameMap._hash(i * 17 + 9, 307);
      g.fillStyle = `rgba(242,234,212,${(0.010 + n3 * 0.022).toFixed(3)})`;
      g.fillRect(n1 * W, n2 * H, 1 + n3 * 1.6, 1);
    }
    for (let i = 0; i < 420; i++) {
      const n1 = GameMap._hash(i * 23 + 1, 401), n2 = GameMap._hash(i * 29 + 3, 503);
      g.strokeStyle = `rgba(30,26,20,${(0.010 + n1 * 0.02).toFixed(3)})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(n2 * W, n1 * H);
      g.lineTo(n2 * W + 8 + n1 * 26, n1 * H + 1);
      g.stroke();
    }

    // ── 5. 四周暗角 ──
    const grad = g.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.92);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.58)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    return cv;
  },

  /** 山峰符号：受光面 + 背光面 + 脊线 */
  _peak(g, x, y, s) {
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.82, y + s * 0.46);
    g.lineTo(x - s * 0.82, y + s * 0.46);
    g.closePath();
    g.fillStyle = 'rgba(46,43,35,0.66)';
    g.fill();

    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x - s * 0.82, y + s * 0.46);
    g.lineTo(x - s * 0.10, y + s * 0.18);
    g.closePath();
    g.fillStyle = 'rgba(196,186,162,0.26)';
    g.fill();

    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.1, y + s * 0.22);
    g.strokeStyle = 'rgba(18,16,12,0.30)';
    g.lineWidth = 1;
    g.stroke();
  },

  /** 树丛符号 */
  _tree(g, x, y, s) {
    g.beginPath();
    g.arc(x, y + s * 0.2, s, 0, Math.PI * 2);
    g.fillStyle = 'rgba(26,40,26,0.72)';
    g.fill();
    g.beginPath();
    g.arc(x - s * 0.28, y - s * 0.18, s * 0.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(74,98,58,0.5)';
    g.fill();
  },
};
