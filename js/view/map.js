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

  // ── 支流（只作视觉，不参与地形分类）──
  TRIBUTARIES: [
    [[700, 762], [792, 736], [880, 700], [966, 644]],     // 渭水
    [[742, 1002], [822, 1078], [902, 1150], [966, 1182]], // 汉水
    [[1120, 902], [1204, 964], [1292, 1012], [1386, 1058]], // 淮水
    [[1176, 722], [1232, 822], [1264, 902]],              // 泗水
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
  prerender(grid, cities) {
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

    // 先把噪声格双线性展开到整张低分辨率画布，主循环里就只剩数组读取
    const HF = new Float32Array(LW * LH);
    const WF = new Float32Array(LW * LH);
    for (let y = 0; y < LH; y++) {
      const fy = y / STEP;
      for (let x = 0; x < LW; x++) {
        const i = y * LW + x;
        HF[i] = field(hf, x / STEP, fy);
        WF[i] = field(wf, x / STEP, fy);
      }
    }

    const data = img.data;
    const rows = grid.length, cols = grid[0].length;
    for (let y = 0; y < LH; y++) {
      const wy = y / S;
      const gy = Math.min(rows - 1, Math.floor(wy / CELL));
      const rowBase = y * LW;
      const up = y > 0 ? -LW : 0;
      const dn = y < LH - 1 ? LW : 0;
      for (let x = 0; x < LW; x++) {
        const wx = x / S;
        const key = grid[gy][Math.min(cols - 1, Math.floor(wx / CELL))];

        const i = rowBase + x;
        const h = HF[i];
        const wet = WF[i];

        let col;
        if (key === 'water') col = mix(C.water, C.waterHi, U.clamp((h - 0.28) * 2.4, 0, 1));
        else if (key === 'marsh') col = mix(C.marsh, C.water, U.clamp(wet * 0.55, 0, 0.4));
        else if (key === 'forest') col = mix(C.forest, C.forestHi, wet);
        else if (key === 'hill') col = mix(C.hill, C.plain, U.clamp((0.56 - h) * 2.2, 0, 1));
        else if (key === 'mountain') col = mix(C.rock, C.snow, U.clamp((h - 0.6) * 3.2, 0, 0.8));
        else if (key === 'desert') col = mix(C.desert, C.desertHi, U.clamp(h * 1.7, 0, 1));
        else col = mix(C.plain, C.plainHi, U.clamp((wet - 0.34) * 2, 0, 1));

        // 西北来光的山体侧影（差分步长必须仍是噪声格 STEP，否则光照强度会变）
        const dhx = (x + STEP < LW ? HF[i + STEP] : h) - (x >= STEP ? HF[i - STEP] : h);
        const dhy = (y + STEP < LH ? HF[i + STEP * LW] : h) - (y >= STEP ? HF[i - STEP * LW] : h);
        const shade = U.clamp(0.5 + (dhx + dhy) * 2.6, 0.15, 1);
        const k = 0.86 + shade * 0.30;

        const n = (GameMap._hash(x * 3 + 7, y * 5 + 11) - 0.5) * 9;
        const o = i * 4;
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
    // 主干：滩涂 → 湿岸 → 水体 → 高光（宽到窄四叠，才有水岸过渡）
    for (const p of GameMap.RIVERS) {
      pass(p, 'rgba(112,100,72,0.34)', 42, 1);
      pass(p, 'rgba(58,74,70,0.65)', 24, 1);
      pass(p, '#3d6a7e', 15, 0.92);
      pass(p, 'rgba(127,179,201,0.30)', 3, 1);
    }
    // 支流：细一档，只有湿岸 + 水体
    for (const p of GameMap.TRIBUTARIES) {
      pass(p, 'rgba(112,100,72,0.20)', 20, 1);
      pass(p, 'rgba(58,74,70,0.48)', 11, 1);
      pass(p, '#3d6a7e', 6, 0.85);
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

    // ── 4. 州界与州名印章 ──
    GameMap.drawRegions(g, cities);

    // ── 5. 纸纹与纤维 ──
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

    // ── 6. 四周暗角 ──
    const grad = g.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.92);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.58)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    return cv;
  },

  /**
   * 州界与州名印章：按「最近城池所属州」铺一张 24px 的州属场，
   * 相邻格州不同处画一段带抖动的手绘虚线；每州质心盖一枚方印。
   * 只依赖城池坐标与固定州属，与势力易主无关，预渲染一次即可。
   */
  drawRegions(g, cities) {
    if (!cities || !cities.length) return;

    const STEP = 24;
    const cols = Math.ceil(GameMap.W / STEP);
    const rows = Math.ceil(GameMap.H / STEP);

    const names = [];
    const idxOf = new Map();      // 州名 → 序号
    const riOf = new Map();       // cityId → 州序号
    for (const c of cities) {
      if (!idxOf.has(c.region)) { idxOf.set(c.region, names.length); names.push(c.region); }
      riOf.set(c.id, idxOf.get(c.region));
    }

    // 州属场：每格取最近城池的州。用 200px 空间桶把 70 城 × 7500 格降到常数级
    const BUCKET = 200;
    const bw = Math.ceil(GameMap.W / BUCKET);
    const bh = Math.ceil(GameMap.H / BUCKET);
    const buckets = new Array(bw * bh);
    for (const c of cities) {
      const bi = Math.floor(c.y / BUCKET) * bw + Math.floor(c.x / BUCKET);
      (buckets[bi] || (buckets[bi] = [])).push(c);
    }
    const nearest = (wx, wy) => {
      const bx = Math.floor(wx / BUCKET), by = Math.floor(wy / BUCKET);
      let best = Infinity, ri = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx, y = by + dy;
          if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
          const list = buckets[y * bw + x];
          if (!list) continue;
          for (const c of list) {
            const ddx = c.x - wx, ddy = c.y - wy;
            const d = ddx * ddx + ddy * ddy;
            if (d < best) { best = d; ri = riOf.get(c.id); }
          }
        }
      }
      return ri;
    };

    const field = new Int16Array(cols * rows);
    for (let r = 0; r < rows; r++) {
      const wy = r * STEP + STEP / 2;
      for (let c = 0; c < cols; c++) {
        field[r * cols + c] = nearest(c * STEP + STEP / 2, wy);
      }
    }

    // 边界：格边中点连线，位置带 ±1.5px 抖动 → 手绘感而不是台阶
    g.save();
    g.strokeStyle = 'rgba(52,40,28,0.30)';
    g.lineWidth = 1.1;
    g.setLineDash([7, 6]);
    g.lineCap = 'round';
    g.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const cx = c * STEP + STEP / 2;
        const cy = r * STEP + STEP / 2;
        if (c + 1 < cols && field[i] !== field[i + 1]) {
          const j = (GameMap._hash(c, r) - 0.5) * 3;
          g.moveTo(cx + STEP / 2 + j, cy - STEP / 2);
          g.lineTo(cx + STEP / 2 + j, cy + STEP / 2);
        }
        if (r + 1 < rows && field[i] !== field[i + cols]) {
          const j = (GameMap._hash(c + 7, r + 3) - 0.5) * 3;
          g.moveTo(cx - STEP / 2, cy + STEP / 2 + j);
          g.lineTo(cx + STEP / 2, cy + STEP / 2 + j);
        }
      }
    }
    g.stroke();
    g.restore();

    // 州名印章：质心盖一枚朱印
    const acc = names.map(() => ({ x: 0, y: 0, n: 0 }));
    for (const c of cities) {
      const a = acc[riOf.get(c.id)];
      a.x += c.x; a.y += c.y; a.n++;
    }
    for (let i = 0; i < names.length; i++) {
      const a = acc[i];
      if (!a.n) continue;
      let x = a.x / a.n, y = a.y / a.n;

      // 质心离城太近就绕着一圈找空位，别压住城池标记
      const minDist = (px, py) => {
        let m = Infinity;
        for (const c of cities) {
          const d = U.dist(c.x, c.y, px, py);
          if (d < m) m = d;
        }
        return m;
      };
      let bestD = minDist(x, y);
      if (bestD < 46) {
        let bx = x, by = y;
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          for (const rad of [58, 78, 96]) {
            const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
            if (px < 40 || py < 40 || px > GameMap.W - 40 || py > GameMap.H - 40) continue;
            const d = minDist(px, py);
            if (d > bestD) { bestD = d; bx = px; by = py; }
          }
        }
        x = bx; y = by;
      }
      GameMap._seal(g, x, y, names[i]);
    }
  },

  /** 朱印：方框 + 州名（去掉「州」字），略微倾斜 */
  _seal(g, x, y, name) {
    const w = 34, h = 34;
    g.save();
    g.translate(x, y);
    g.rotate(-0.05);
    g.fillStyle = 'rgba(150,74,58,0.07)';
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = 'rgba(150,74,58,0.32)';
    g.lineWidth = 1.8;
    g.strokeRect(-w / 2, -h / 2, w, h);
    g.fillStyle = 'rgba(158,92,72,0.5)';
    g.font = '15px "Noto Serif SC", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(name).replace('州', ''), 0, 1);
    g.restore();
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
