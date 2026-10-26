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

    // 地形色函数：写进 out（预分配的 3 元数组），避免逐像素分配
    const CA = new Float32Array(3), CB = new Float32Array(3);
    const CC = new Float32Array(3), CD = new Float32Array(3);
    const colFor = (key, h, wet, out) => {
      let a, b, t;
      if (key === 'water') { a = C.water; b = C.waterHi; t = U.clamp((h - 0.28) * 2.4, 0, 1); }
      else if (key === 'marsh') { a = C.marsh; b = C.water; t = U.clamp(wet * 0.55, 0, 0.4); }
      else if (key === 'forest') { a = C.forest; b = C.forestHi; t = wet; }
      else if (key === 'hill') { a = C.hill; b = C.plain; t = U.clamp((0.56 - h) * 2.2, 0, 1); }
      else if (key === 'mountain') { a = C.rock; b = C.snow; t = U.clamp((h - 0.6) * 3.2, 0, 0.8); }
      else if (key === 'desert') { a = C.desert; b = C.desertHi; t = U.clamp(h * 1.7, 0, 1); }
      else { a = C.plain; b = C.plainHi; t = U.clamp((wet - 0.34) * 2, 0, 1); }
      out[0] = a[0] + (b[0] - a[0]) * t;
      out[1] = a[1] + (b[1] - a[1]) * t;
      out[2] = a[2] + (b[2] - a[2]) * t;
      return out;
    };

    const data = img.data;
    const rows = grid.length, cols = grid[0].length;
    for (let y = 0; y < LH; y++) {
      const wy = y / S;
      const gy = Math.min(rows - 1, Math.floor(wy / CELL));
      const rowBase = y * LW;
      // 按格心位置取 4 邻（一像素也不会走出数组）
      const cyF = wy / CELL - 0.5;
      const r0 = U.clamp(Math.floor(cyF), 0, rows - 1);
      const r1 = Math.min(rows - 1, r0 + 1);
      const ty0 = U.clamp(cyF - r0, 0, 1);
      const gRow0 = grid[r0], gRow1 = grid[r1];
      for (let x = 0; x < LW; x++) {
        const wx = x / S;

        const i = rowBase + x;
        const h = HF[i];
        const wet = WF[i];

        // ── 软权重混合（ART.md §2.2 ①）：按格心插值取 4 邻地形色。
        // 原来是「按 40px 网格硬分类」—— 地形边界是一圈直角台阶，放大就能看出棋盘格。
        // 权重再叠一层 hash 抖动（±0.08）：边界变成手绘毛边，而不是数学上的等值线。
        const cxF = wx / CELL - 0.5;
        const c0 = U.clamp(Math.floor(cxF), 0, cols - 1);
        const c1 = Math.min(cols - 1, c0 + 1);
        const wob = (GameMap._hash(x * 7 + 3, y * 11 + 5) - 0.5) * 0.16;
        const tx = U.clamp(cxF - c0 + wob, 0, 1);
        const ty = U.clamp(ty0 + wob, 0, 1);
        colFor(gRow0[c0], h, wet, CA);
        colFor(gRow0[c1], h, wet, CB);
        colFor(gRow1[c0], h, wet, CC);
        colFor(gRow1[c1], h, wet, CD);
        const col0 = (CA[0] + (CB[0] - CA[0]) * tx) * (1 - ty) + (CC[0] + (CD[0] - CC[0]) * tx) * ty;
        const col1 = (CA[1] + (CB[1] - CA[1]) * tx) * (1 - ty) + (CC[1] + (CD[1] - CC[1]) * tx) * ty;
        const col2 = (CA[2] + (CB[2] - CA[2]) * tx) * (1 - ty) + (CC[2] + (CD[2] - CC[2]) * tx) * ty;

        // 西北来光的山体侧影（差分步长必须仍是噪声格 STEP，否则光照强度会变）
        const dhx = (x + STEP < LW ? HF[i + STEP] : h) - (x >= STEP ? HF[i - STEP] : h);
        const dhy = (y + STEP < LH ? HF[i + STEP * LW] : h) - (y >= STEP ? HF[i - STEP * LW] : h);
        const shade = U.clamp(0.5 + (dhx + dhy) * 2.6, 0.15, 1);
        const k = 0.86 + shade * 0.30;

        const n = (GameMap._hash(x * 3 + 7, y * 5 + 11) - 0.5) * 9;
        const o = i * 4;
        data[o] = U.clamp(col0 * k + n, 0, 255);
        data[o + 1] = U.clamp(col1 * k + n, 0, 255);
        data[o + 2] = U.clamp(col2 * k + n * 0.8, 0, 255);
        data[o + 3] = 255;
      }
    }

    lg.putImageData(img, 0, 0);
    g.drawImage(low, 0, 0, W, H);

    // ── 2. 河川：岸 / 水体 / 高光三叠（宽随流程渐变，源窄尾宽）──
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

    /** 沿同一套平滑曲线采样成折线 —— 变宽只能逐段描，单次 stroke 只能一个宽度 */
    const samplePath = (pts, perSeg) => {
      const out = [];
      let prev = pts[0];
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        for (let k = 0; k < perSeg; k++) {
          const t = k / perSeg, mt = 1 - t;
          out.push([
            mt * mt * prev[0] + 2 * mt * t * pts[i][0] + t * t * mx,
            mt * mt * prev[1] + 2 * mt * t * pts[i][1] + t * t * my,
          ]);
        }
        prev = [mx, my];
      }
      out.push(pts[pts.length - 1]);
      return out;
    };

    /** 渐变宽度描边（ART.md §2.2 ④）：原来是等宽 15/6px，河像一根绳子 */
    const passTaper = (pts, style, w0, w1, alpha) => {
      const line = samplePath(pts, 10);
      g.strokeStyle = style;
      g.globalAlpha = alpha;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (let i = 1; i < line.length; i++) {
        const t = i / (line.length - 1);
        g.lineWidth = w0 + (w1 - w0) * t;
        g.beginPath();
        g.moveTo(line[i - 1][0], line[i - 1][1]);
        g.lineTo(line[i][0], line[i][1]);
        g.stroke();
      }
      g.globalAlpha = 1;
    };

    // 主干：滩涂 → 湿岸 → 水体 → 高光（四叠，宽度按流程 0.55× → 1.15× 渐变）
    for (const p of GameMap.RIVERS) {
      passTaper(p, 'rgba(112,100,72,0.34)', 42 * 0.55, 42 * 1.15, 1);
      passTaper(p, 'rgba(58,74,70,0.65)', 24 * 0.5, 24 * 1.15, 1);
      passTaper(p, '#3d6a7e', 15 * 0.5, 15 * 1.15, 0.92);
      pass(p, 'rgba(127,179,201,0.30)', 3, 1);
    }
    // 支流：细一档，只有湿岸 + 水体，同样渐变
    for (const p of GameMap.TRIBUTARIES) {
      passTaper(p, 'rgba(112,100,72,0.20)', 20 * 0.5, 20 * 1.0, 1);
      passTaper(p, 'rgba(58,74,70,0.48)', 11 * 0.45, 11 * 1.0, 1);
      passTaper(p, '#3d6a7e', 6 * 0.45, 6 * 1.0, 0.85);
    }

    // 沙洲：主河道里零星几块浅滩 —— 没有这个，河道就是一条均匀的帯
    for (const p of GameMap.RIVERS) {
      for (let i = 1; i < p.length; i++) {
        if (GameMap._hash(i * 17 + 3, 29) > 0.5) continue;
        const rw = 3 + GameMap._hash(i * 7 + 1, 41) * 4;
        g.beginPath();
        g.ellipse(p[i][0] + (GameMap._hash(i, 7) - 0.5) * 8, p[i][1] + (GameMap._hash(i, 13) - 0.5) * 8,
          rw, rw * 0.55, GameMap._hash(i, 3) * Math.PI, 0, Math.PI * 2);
        g.fillStyle = 'rgba(118,106,78,0.42)';
        g.fill();
        g.strokeStyle = 'rgba(150,180,190,0.18)';
        g.lineWidth = 1;
        g.stroke();
      }
    }

    // ── 3. 山形 / 树丛 / 沙丘：按低频聚簇分布（ART.md §2.2 ③）──
    // 原来是每格二值随机（n1 > 0.5），密度均匀 → 看过去像均匀贴纸，读不出山脉与林地。
    // 现在用一层波长 ≈ 460px 的 fbm 当密度遮罩：同一片山会堆成山，空地就是空地。
    const clusterAt = (wx, wy) => GameMap._fbm(wx / 460 + 311 + ox, wy / 460 + 173 + ox);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r][c];
        const n1 = GameMap._hash(c * 11 + 5, r * 17 + 2);
        const bx = c * CELL, by = r * CELL;
        const cl = clusterAt(bx + CELL / 2, by + CELL / 2);

        if (t === 'mountain') {
          if (n1 > 0.14 + cl * 1.35) continue;
          const px = bx + CELL * (0.18 + GameMap._hash(c, r) * 0.64);
          const py = by + CELL * (0.34 + GameMap._hash(c + 3, r + 7) * 0.46);
          const roll = GameMap._hash(c + 17, r + 23);
          // 三档尺寸：大峰是“山”，小峰是“丘”
          const s = roll > 0.82 ? 19 + GameMap._hash(c + 31, r + 3) * 9
            : roll > 0.45 ? 12 + GameMap._hash(c + 41, r + 11) * 4
              : 7 + GameMap._hash(c + 53, r + 19) * 3;
          // 两种形态：单峰 / 连峰（山脊）
          if (GameMap._hash(c + 5, r + 9) > 0.58) GameMap._ridge(g, px, py, s);
          else GameMap._peak(g, px, py, s);
        } else if (t === 'forest') {
          if (n1 > 0.12 + cl * 1.45) continue;
          const nTree = 2 + Math.floor(GameMap._hash(c + 3, r + 5) * 4);
          for (let k = 0; k < nTree; k++) {
            const px = bx + 5 + GameMap._hash(c * 3 + k, r * 5 + k) * (CELL - 10);
            const py = by + 5 + GameMap._hash(c * 7 + k, r * 3 + k + 9) * (CELL - 10);
            const sz = GameMap._hash(c + k, r + k);
            GameMap._tree(g, px, py,
              2.2 + sz * 2.2,
              GameMap._hash(c + 11 + k, r + 13 + k) > 0.55);   // true = 尖冠
          }
        } else if (t === 'desert') {
          if (n1 > 0.12 + cl * 0.5) continue;
          g.beginPath();
          const px = bx + CELL * 0.2, py = by + CELL * (0.3 + n1 * 0.5);
          // 沙丘：两三道平行弧，而不是单根弧线
          for (let k = 0; k < 3; k++) {
            g.moveTo(px, py + k * 4);
            g.quadraticCurveTo(px + CELL * 0.3, py - 5 + k * 4, px + CELL * (0.62 - k * 0.08), py + 1 + k * 4);
          }
          g.strokeStyle = 'rgba(190,170,130,0.15)';
          g.lineWidth = 1.3;
          g.stroke();
        }
      }
    }

    // ── 3.5 等高线（ART.md §2.2 ②）：只在山地/丘陵里画
    // 一开始写成一个一个 1px 点，实测在 0.4 倍色床上降采样后基本看不见（全图只差 1.5 万px）。
    // 改成「按梯度取切向、连成短线段」+ 按高程档分两档深浅，才真的像等高线。
    {
      const LEVELS = [0.30, 0.36, 0.42, 0.48, 0.54, 0.60, 0.66, 0.72];
      const pts = LEVELS.map(() => []);
      const terrainOf = (wx, wy) => {
        const gy2 = Math.min(rows - 1, Math.floor(wy / CELL));
        const gx2 = Math.min(cols - 1, Math.floor(wx / CELL));
        return grid[gy2][gx2];
      };
      for (let y = 1; y < LH - 1; y++) {
        const wy = y / S;
        for (let x = 1; x < LW - 1; x++) {
          const wx = x / S;
          const tt = terrainOf(wx, wy);
          if (tt !== 'mountain' && tt !== 'hill') continue;
          const i = y * LW + x;
          const h = HF[i];
          for (let li = 0; li < LEVELS.length; li++) {
            const L = LEVELS[li];
            if ((h - L) * (HF[i + 1] - L) >= 0 && (h - L) * (HF[i + LW] - L) >= 0) continue;
            // 切向垂直于梯度：线段方向 = 等值线方向（不然点阵会散成一团沙子）
            const gx2 = HF[i + 1] - HF[i - 1];
            const gy2 = HF[i + LW] - HF[i - LW];
            const m = Math.hypot(gx2, gy2) || 1;
            const tx = (-gy2 / m) * 1.9, ty = (gx2 / m) * 1.9;
            pts[li].push(wx - tx, wy - ty, wx + tx, wy + ty);
            break;
          }
        }
      }
      LEVELS.forEach((L, li) => {
        const a = pts[li];
        if (!a.length) return;
        g.beginPath();
        for (let i = 0; i < a.length; i += 4) {
          g.moveTo(a[i], a[i + 1]);
          g.lineTo(a[i + 2], a[i + 3]);
        }
        g.strokeStyle = li % 2 ? 'rgba(58,46,32,0.30)' : 'rgba(58,46,32,0.21)';
        g.lineWidth = 1;
        g.stroke();
      });
    }

    // ── 4. 州界与州名印章 ──
    GameMap.drawRegions(g, cities);

    // ── 4.5 纸的三层（ART.md §2.2 ⑤）：大尺度淡渍 → 折痕 → 纤维 → 细颗粒 ──
    // 原只有后两层，纸面平得像一张贴图；加一层低频“水渍”与旧地图折痕才有层次。
    {
      const ox2 = GameMap._ox || 0;
      const SS = 0.12;                       // 低分辨率算渍后放大，省得逐像素画
      const sw = Math.round(W * SS), sh = Math.round(H * SS);
      const st = document.createElement('canvas');
      st.width = sw; st.height = sh;
      const sg = st.getContext('2d');
      const simg = sg.createImageData(sw, sh);
      const sd = simg.data;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const n = GameMap._fbm((x / SS) / 520 + 91 + ox2, (y / SS) / 520 + 43 + ox2);
        // 只取一个窄带：渍是一圈“边”，不是整片刷一层
        const band = Math.max(0, 1 - Math.abs(n - 0.58) * 9);
        const o = (y * sw + x) * 4;
        sd[o] = 120; sd[o + 1] = 96; sd[o + 2] = 60;
        sd[o + 3] = band * 26;
      }
      sg.putImageData(simg, 0, 0);
      g.drawImage(st, 0, 0, W, H);
    }
    // 折痕：旧地图对折过的那种软暗带（竖 2 道 + 横 1 道），比画法更便宜且不出错
    const fold = (x0, y0, x1, y1) => {
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, 'rgba(40,30,18,0)');
      gr.addColorStop(0.5, 'rgba(40,30,18,0.055)');
      gr.addColorStop(1, 'rgba(40,30,18,0)');
      return gr;
    };
    const FW = 34;
    g.fillStyle = fold(W * 0.34 - FW, 0, W * 0.34 + FW, 0);
    g.fillRect(W * 0.34 - FW, 0, FW * 2, H);
    g.fillStyle = fold(W * 0.67 - FW, 0, W * 0.67 + FW, 0);
    g.fillRect(W * 0.67 - FW, 0, FW * 2, H);
    g.fillStyle = fold(0, H * 0.5 - FW, 0, H * 0.5 + FW);
    g.fillRect(0, H * 0.5 - FW, W, FW * 2);

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
    // 试过改成暖褐 rgba(58,44,28,.46)，实测角/心亮度比从 0.77 变成 1.06 —— 暖色不够沉，
    // 暗角直接失效（四角反而比中心亮）。所以保留黑底，另叠一层很淡的暖色只去“死黑”感。
    const grad = g.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.92);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.58)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const warm = g.createRadialGradient(W / 2, H / 2, H * 0.40, W / 2, H / 2, H * 0.95);
    warm.addColorStop(0, 'rgba(72,52,28,0)');
    warm.addColorStop(1, 'rgba(72,52,28,0.10)');
    g.fillStyle = warm;
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
    // 山脚投影：东南向，与城池/军队同一光向（不然整张图的光是散的）
    g.beginPath();
    g.ellipse(x + s * 0.3, y + s * 0.46, s * 0.92, s * 0.26, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(26,24,19,0.20)';
    g.fill();

    // 山体（暗）
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.82, y + s * 0.46);
    g.lineTo(x - s * 0.82, y + s * 0.46);
    g.closePath();
    g.fillStyle = 'rgba(46,43,35,0.66)';
    g.fill();

    // 西北受光面
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x - s * 0.82, y + s * 0.46);
    g.lineTo(x - s * 0.10, y + s * 0.18);
    g.closePath();
    g.fillStyle = 'rgba(196,186,162,0.26)';
    g.fill();

    // 东南背光面：单独压暗一层，山峰才有“两个坡”而不是两块色
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.82, y + s * 0.46);
    g.lineTo(x + s * 0.10, y + s * 0.18);
    g.closePath();
    g.fillStyle = 'rgba(14,12,9,0.22)';
    g.fill();

    // 脊线
    g.beginPath();
    g.moveTo(x, y - s);
    g.lineTo(x + s * 0.1, y + s * 0.22);
    g.strokeStyle = 'rgba(18,16,12,0.30)';
    g.lineWidth = 1;
    g.stroke();
  },

  /** 连峰：三个高矮不一的山尖沿西北→东南排开，天然比单峰更像“山脉” */
  _ridge(g, x, y, s) {
    const hi = s, mid = s * 0.72, lo = s * 0.5;
    GameMap._peak(g, x - s * 0.62, y + s * 0.1, mid);
    GameMap._peak(g, x + s * 0.66, y + s * 0.16, lo);
    GameMap._peak(g, x, y, hi);
  },

  /** 树丛符号：两种冠形（圆冠 / 尖冠），尖冠更像松柏，混用才不会一片“圆点” */
  _tree(g, x, y, s, pointed) {
    // 树脚投影
    g.beginPath();
    g.ellipse(x + s * 0.25, y + s * 0.62, s * 0.8, s * 0.24, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(22,26,18,0.18)';
    g.fill();

    if (pointed) {
      g.beginPath();
      g.moveTo(x, y - s * 1.1);
      g.lineTo(x + s * 0.72, y + s * 0.7);
      g.lineTo(x - s * 0.72, y + s * 0.7);
      g.closePath();
      g.fillStyle = 'rgba(26,40,26,0.74)';
      g.fill();
      // 受光侧
      g.beginPath();
      g.moveTo(x, y - s * 1.1);
      g.lineTo(x - s * 0.72, y + s * 0.7);
      g.lineTo(x - s * 0.12, y + s * 0.3);
      g.closePath();
      g.fillStyle = 'rgba(74,98,58,0.44)';
      g.fill();
      return;
    }

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
