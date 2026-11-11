// 城池内景（A 档：程序矢量等距图）
//
// 只回答一个问题：**这座城长什么样**。
// 15 块地（16 种建筑里除去城墙）+ 一圈城墙走外圈：
//   · 等级换体量与装饰件（0 级是空地虚线地基，6 级能看出排场）
//   · 在建挂脚手架，城墙受损塌垛口
//   · 点建筑直接跳到「营造」页并高亮那一行
//
// 坐标全是逻辑像素（W×H），canvas 宽高属性乘了 dpr，CSS 只负责按容器宽度缩放。
// 颜色一律来自 style.css `:root` 的 --city-* token —— canvas 拿不到 CSS 继承，
// 所以在第一次绘制时读一次缓存（STYLE.md 红线 3：JS 里不写颜色字面量）。

const CityView = {
  W: 416,
  H: 214,
  TILE_W: 56,
  TILE_H: 26,
  CX: 180,   // 菱形网格原点（col-0,row-0 的中心）
  CY: 48,

  // token 短名 → style.css 里的 --city-* 后缀
  TOKENS: {
    grass: 'grass', grass2: 'grass-2', earth: 'earth', earth2: 'earth-2', road: 'road',
    wall: 'wall', wallLit: 'wall-lit', wallDark: 'wall-dark',
    roof: 'roof', roofLit: 'roof-lit', roofGold: 'roof-gold',
    beam: 'beam', plaster: 'plaster', wood: 'wood', woodDark: 'wood-dark',
    stone: 'stone', stoneDark: 'stone-dark',
    field: 'field', field2: 'field-2', water: 'water', fire: 'fire', empty: 'empty', gold: 'gold',
    shadow: 'shadow',
  },

  /** 15 块地：坐标是 7×5 菱形网格（col,row），城墙另走外圈 */
  PLOTS: [
    { key: 'academy', col: 2, row: 0 },
    { key: 'office', col: 3, row: 0 },
    { key: 'granary', col: 4, row: 0 },
    { key: 'clinic', col: 0, row: 1 },
    { key: 'market', col: 1, row: 1 },
    { key: 'customs', col: 5, row: 1 },
    { key: 'barracks', col: 0, row: 2 },
    { key: 'drill', col: 2, row: 2 },
    { key: 'ironworks', col: 4, row: 2 },
    { key: 'beacon', col: 6, row: 2 },
    { key: 'farm', col: 0, row: 3 },
    { key: 'stable', col: 2, row: 3 },
    { key: 'shipyard', col: 4, row: 3 },
    { key: 'lumber', col: 1, row: 4 },
    { key: 'quarry', col: 5, row: 4 },
  ],

  // 街巷：中间一条南北道（南门 → 府衙），横一条东西街
  ROADS: [[3, 1], [3, 2], [3, 3], [3, 4], [1, 2], [5, 2]],

  // 零散点缀（树 / 井 / 车），只为了不形成方格
  DECOR: [
    [0, 0, 'tree'], [5, 0, 'tree'], [6, 0, 'tree'], [2, 1, 'well'], [4, 1, 'cart'],
    [1, 3, 'tree'], [6, 1, 'tree'], [0, 4, 'tree'], [4, 4, 'tree'], [6, 4, 'tree'],
  ],

  _pal: null,

  pal() {
    if (this._pal) return this._pal;
    const p = {};
    const hasDom = typeof document !== 'undefined' && typeof getComputedStyle === 'function';
    const cs = hasDom ? getComputedStyle(document.documentElement) : null;
    for (const short in this.TOKENS) {
      p[short] = cs ? cs.getPropertyValue('--city-' + this.TOKENS[short]).trim() : '';
    }
    this._pal = p;
    return p;
  },

  // ───────────────────────── 几何 ─────────────────────────

  _p(col, row) {
    return {
      x: this.CX + (col - row) * (this.TILE_W / 2),
      y: this.CY + (col + row) * (this.TILE_H / 2),
    };
  },

  _hw(s) { return this.TILE_W / 2 * s; },
  _hh(s) { return this.TILE_H / 2 * s; },

  /** 屏幕坐标 → 网格浮点行列（超出网格则不在地块上） */
  _cellOf(x, y) {
    const a = (x - this.CX) / (this.TILE_W / 2);
    const b = (y - this.CY) / (this.TILE_H / 2);
    return { col: (a + b) / 2, row: (b - a) / 2 };
  },

  /** 草皮散点的确定性哈希：同一座城每次画一样，不闪 */
  _hash(i) {
    const v = Math.sin(i * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  },

  /** 菱形面（顶面 / 地块） */
  _dia(ctx, x, y, s) {
    const hw = this._hw(s);
    const hh = this._hh(s);
    ctx.beginPath();
    ctx.moveTo(x, y - hh);
    ctx.lineTo(x + hw, y);
    ctx.lineTo(x, y + hh);
    ctx.lineTo(x - hw, y);
    ctx.closePath();
  },

  /** 等距立方体：只画看得见的南西面 / 南东面 / 顶面 */
  _prism(ctx, x, y, s, h, P, topCol, litCol, darkCol) {
    const hw = this._hw(s);
    const hh = this._hh(s);
    ctx.fillStyle = darkCol || P.wallDark;
    ctx.beginPath();
    ctx.moveTo(x - hw, y);
    ctx.lineTo(x, y + hh);
    ctx.lineTo(x, y + hh - h);
    ctx.lineTo(x - hw, y - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = litCol || P.wall;
    ctx.beginPath();
    ctx.moveTo(x, y + hh);
    ctx.lineTo(x + hw, y);
    ctx.lineTo(x + hw, y - h);
    ctx.lineTo(x, y + hh - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = topCol || P.wallLit;
    this._dia(ctx, x, y - h, s);
    ctx.fill();
  },

  /** 四角攒尖顶：两个南向坡面 + 檐线 */
  _roof(ctx, x, y, s, h, rh, P, colA, colB) {
    const hw = this._hw(s);
    const hh = this._hh(s);
    const by = y - h;
    const apex = by - rh;
    ctx.fillStyle = colB;
    ctx.beginPath();
    ctx.moveTo(x - hw, by);
    ctx.lineTo(x, by + hh);
    ctx.lineTo(x, apex);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = colA;
    ctx.beginPath();
    ctx.moveTo(x, by + hh);
    ctx.lineTo(x + hw, by);
    ctx.lineTo(x, apex);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = P.wallDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - hw, by);
    ctx.lineTo(x, by + hh);
    ctx.lineTo(x + hw, by);
    ctx.stroke();
  },

  /** 屋身 + 屋顶的最小完整体 */
  _hall(ctx, x, y, s, h, rh, P, roofA, roofB) {
    this._prism(ctx, x, y, s, h, P, P.plaster, P.plaster, P.beam);
    this._roof(ctx, x, y, s, h, rh, P, roofA || P.roofLit, roofB || P.roof);
  },

  /** 立柱（朱柱）：在南侧面画两根 */
  _posts(ctx, x, y, s, h, P) {
    const hw = this._hw(s);
    const hh = this._hh(s);
    ctx.strokeStyle = P.beam;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - hw * 0.45, y + hh * 0.45);
    ctx.lineTo(x - hw * 0.45, y + hh * 0.45 - h);
    ctx.moveTo(x + hw * 0.45, y + hh * 0.45);
    ctx.lineTo(x + hw * 0.45, y + hh * 0.45 - h);
    ctx.stroke();
  },

  /** 在建脚手架：两根斜杆 + 一条横杆 */
  _scaffold(ctx, x, y, s, h, P, w) {
    const hw = this._hw(s);
    const hh = this._hh(s);
    ctx.strokeStyle = P.gold;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x - hw, y);
    ctx.lineTo(x + hw * 0.35, y + hh * 0.2 - h);
    ctx.moveTo(x + hw, y);
    ctx.lineTo(x - hw * 0.35, y + hh * 0.2 - h);
    ctx.stroke();
    if (w > 0.5) {
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x - hw * 0.4, y + hh * 0.1 - h * 0.55);
      ctx.lineTo(x + hw * 0.75, y - hh * 0.15 - h * 0.55);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // ───────────────────────── 数据 ─────────────────────────

  /**
   * 纯函数：把城摊成 15 个绘制节点。
   * 返回 [{key,name,col,row,x,y,lv,max,under,water}]，按 y 升序（后画的挡前面的）。
   */
  nodes(G, c) {
    const out = this.PLOTS.map(p => {
      const b = BUILDINGS[p.key];
      const pt = this._p(p.col, p.row);
      const lv = State.bld(c, p.key);
      const q = c.buildQueue.find(j => j.key === p.key);
      return {
        key: p.key,
        name: b.name,
        col: p.col,
        row: p.row,
        x: pt.x,
        y: pt.y,
        lv,
        max: b.max,
        under: q ? Math.round((1 - q.left / q.total) * 100) : 0,
        water: p.key === 'shipyard' ? State.isRiverCity(G, c) : false,
      };
    });
    out.sort((a, b) => a.y - b.y);
    return out;
  },

  /** 城墙状态：等级 / 受损比例 */
  wallOf(c) {
    const lv = State.bld(c, 'wall');
    const max = State.wallMaxOf(c);
    return { lv, max, hp: max > 0 ? Math.max(0, Math.min(1, c.wall / max)) : 1 };
  },

  // ───────────────────────── 绘制 ─────────────────────────

  paint(ctx, nodes, c) {
    const P = this.pal();
    ctx.clearRect(0, 0, this.W, this.H);

    // 天光：上亮下暗，给整块图一个纵深
    const sky = ctx.createLinearGradient(0, 0, 0, this.H);
    sky.addColorStop(0, P.grass2);
    sky.addColorStop(1, P.earth2);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.W, this.H);

    this._ground(ctx, P);
    this._wall(ctx, c, P, 'back');

    // 网格外的点缀先画（在城墙内侧，y 小的先画）
    for (const [col, row, kind] of this.DECOR) {
      const pt = this._p(col, row);
      this._prop(ctx, pt.x, pt.y, kind, P);
    }

    for (const n of nodes) this._plot(ctx, n, P);

    this._wall(ctx, c, P, 'front');
  },

  /** 城内台基 + 街巷 */
  _ground(ctx, P) {
    // 台基：把城墙菱形外扩一点，做出「城墙里一块高地」
    const k = this._wallCorners();
    const push = (p, d) => ({ x: p.x + (p.x - this.CX) * d, y: p.y + (p.y - this.CY) * d });
    const poly = arr => {
      ctx.beginPath();
      ctx.moveTo(arr[0].x, arr[0].y);
      for (let i = 1; i < arr.length; i++) ctx.lineTo(arr[i].x, arr[i].y);
      ctx.closePath();
    };
    ctx.fillStyle = P.earth2;
    poly([push(k.n, 0.05), push(k.e, 0.05), push(k.s, 0.05), push(k.w, 0.05)]);
    ctx.fill();
    ctx.fillStyle = P.earth;
    poly([push(k.n, 0.028), push(k.e, 0.028), push(k.s, 0.028), push(k.w, 0.028)]);
    ctx.fill();

    ctx.fillStyle = P.grass;
    poly([push(k.n, -0.02), push(k.e, -0.02), push(k.s, -0.02), push(k.w, -0.02)]);
    ctx.fill();

    // 草皮散点：确定性哈希进网格，同一座城每次画都一样，不会闪
    ctx.fillStyle = P.grass2;
    for (let i = 0; i < 220; i++) {
      const col = -0.5 + this._hash(i) * 7;
      const row = -0.5 + this._hash(i + 977) * 5;
      if (col < -0.45 || col > 6.45 || row < -0.45 || row > 4.45) continue;
      const pt = this._p(col, row);
      ctx.fillRect(pt.x, pt.y, 1.4, 0.9);
    }

    for (const [col, row] of this.ROADS) {
      const pt = this._p(col, row);
      ctx.fillStyle = P.road;
      ctx.globalAlpha = 0.55;
      this._dia(ctx, pt.x, pt.y, 0.94);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  /** 外圈城墙：back 先画（被建筑挡住），front 后画（挡住建筑） */
  _wall(ctx, c, P, layer) {
    const w = this.wallOf(c);
    const tall = 4 + w.lv * 1.5;
    const corners = this._wallCorners();

    // 四个方位角：N → E → S → W
    const edges = [
      { a: corners.n, b: corners.e, back: true },
      { a: corners.w, b: corners.n, back: true },
      { a: corners.e, b: corners.s, back: false },
      { a: corners.s, b: corners.w, back: false },
    ];

    for (const e of edges) {
      if (e.back !== (layer === 'back')) continue;
      this._wallEdge(ctx, e.a, e.b, tall, w, P);
    }
    if (layer !== 'front') return;

    // 城门：南角（正门）
    this._gate(ctx, corners.s, tall, w, P);
  },

  _wallCorners() {
    const hw = this.TILE_W / 2;
    const hh = this.TILE_H / 2;
    // 网格 col 0..6 / row 0..4 的菱形外框四角
    const n = this._p(0, 0);
    const e = this._p(6, 0);
    const s = this._p(6, 4);
    const w = this._p(0, 4);
    return {
      n: { x: n.x, y: n.y - hh },
      e: { x: e.x + hw, y: e.y },
      s: { x: s.x, y: s.y + hh },
      w: { x: w.x - hw, y: w.y },
    };
  },

  _wallEdge(ctx, a, b, tall, w, P) {
    // 受损：中间塌一段
    const gap = w.hp < 0.75;
    const t0 = gap ? 0.34 : 0;
    const t1 = gap ? 0.66 : 1;
    const seg = (u0, u1) => {
      const p0 = { x: a.x + (b.x - a.x) * u0, y: a.y + (b.y - a.y) * u0 };
      const p1 = { x: a.x + (b.x - a.x) * u1, y: a.y + (b.y - a.y) * u1 };
      // 墙面
      ctx.fillStyle = P.wallDark;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p1.x, p1.y - tall);
      ctx.lineTo(p0.x, p0.y - tall);
      ctx.closePath();
      ctx.fill();
      // 顶面（一条窄带）
      ctx.strokeStyle = P.wallLit;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y - tall);
      ctx.lineTo(p1.x, p1.y - tall);
      ctx.stroke();
      // 垛口
      const n = Math.max(2, Math.round((u1 - u0) * 7));
      ctx.fillStyle = P.wallLit;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const mx = p0.x + (p1.x - p0.x) * t;
        const my = p0.y + (p1.y - p0.y) * t;
        ctx.fillRect(mx - 1.4, my - tall - 2.6, 2.8, 3);
      }
    };
    if (!gap) { seg(0, 1); return; }
    seg(0, t0);
    seg(t1, 1);
    // 塌掉的一段：碎石
    const mid = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
    ctx.fillStyle = P.stone;
    for (let i = 0; i < 5; i++) {
      const t = i / 4 - 0.5;
      ctx.fillRect(mid.x + (b.x - a.x) * t * 0.6 - 1, mid.y + (b.y - a.y) * t * 0.6 - 1, 2.4, 2);
    }
  },

  _gate(ctx, s, tall, w, P) {
    // 城门楼：门洞 + 一层短楼
    const gw = 15;
    const gh = tall + 5 + w.lv;
    ctx.fillStyle = P.wall;
    ctx.beginPath();
    ctx.moveTo(s.x - gw, s.y - 2);
    ctx.lineTo(s.x, s.y + 4);
    ctx.lineTo(s.x + gw, s.y - 2);
    ctx.lineTo(s.x + gw, s.y - 2 - gh);
    ctx.lineTo(s.x, s.y + 4 - gh);
    ctx.lineTo(s.x - gw, s.y - 2 - gh);
    ctx.closePath();
    ctx.fill();
    // 门洞
    ctx.fillStyle = P.woodDark;
    ctx.beginPath();
    ctx.moveTo(s.x - 4, s.y + 0.5);
    ctx.lineTo(s.x, s.y + 2.5);
    ctx.lineTo(s.x + 4, s.y + 0.5);
    ctx.lineTo(s.x + 4, s.y - 7);
    ctx.lineTo(s.x, s.y - 5);
    ctx.lineTo(s.x - 4, s.y - 7);
    ctx.closePath();
    ctx.fill();
    // 楼顶
    this._roof(ctx, s.x, s.y - gh + 4, 0.52, 0, 7, P, P.roofLit, P.roof);
    ctx.strokeStyle = P.wallLit;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s.x - gw, s.y - 2 - gh);
    ctx.lineTo(s.x, s.y + 4 - gh);
    ctx.lineTo(s.x + gw, s.y - 2 - gh);
    ctx.stroke();
  },

  _plot(ctx, n, P) {
    // 投影：让房子踩在地上而不是浮着
    if (n.lv > 0) {
      ctx.fillStyle = P.shadow;
      ctx.globalAlpha = 0.5;
      this._dia(ctx, n.x + 2.5, n.y + 2, 0.86);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 空地：虚线地基
    if (n.lv <= 0) {
      ctx.fillStyle = P.empty;
      this._dia(ctx, n.x, n.y, 0.82);
      ctx.fill();
      ctx.strokeStyle = P.road;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      this._dia(ctx, n.x, n.y, 0.82);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const draw = this['_b_' + n.key];
    if (draw) draw.call(this, ctx, n, P);
    else this._hall(ctx, n.x, n.y, 0.8, 10 + n.lv * 2, 6 + n.lv, P);

    if (n.under) this._scaffold(ctx, n.x, n.y, 0.86, 12 + n.lv * 2, P, 1);
  },

  // ───────── 各建筑剪影：等级只影响体量与装饰件数量 ─────────

  _b_farm(ctx, n, P) {
    const hw = this._hw(0.92);
    const hh = this._hh(0.92);
    ctx.fillStyle = P.field;
    this._dia(ctx, n.x, n.y, 0.92);
    ctx.fill();
    const rows = 2 + n.lv;
    ctx.strokeStyle = P.field2;
    ctx.lineWidth = 1.1;
    for (let i = 1; i <= rows; i++) {
      const t = i / (rows + 1);
      ctx.beginPath();
      ctx.moveTo(n.x - hw + hw * t, n.y - hh * t);
      ctx.lineTo(n.x + hw * t, n.y + hh - hh * t);
      ctx.stroke();
    }
    if (n.lv >= 2) {
      // 田埂上的看田小舍
      this._hall(ctx, n.x - hw * 0.42, n.y - hh * 0.1, 0.24, 5, 4, P, P.roofLit, P.roof);
    }
  },

  _b_market(ctx, n, P) {
    const s = 0.3 + n.lv * 0.035;
    const offs = [[-0.34, 0.16], [0.28, 0.02], [-0.02, -0.3]];
    const cnt = Math.min(3, 1 + Math.floor(n.lv / 2));
    for (let i = 0; i < cnt; i++) {
      const o = offs[i];
      const x = n.x + o[0] * this.TILE_W * 0.8;
      const y = n.y + o[1] * this.TILE_H * 1.4;
      this._prism(ctx, x, y, s, 5, P, P.wood, P.wood, P.woodDark);
      this._roof(ctx, x, y, s, 5, 4, P, P.beam, P.woodDark);
    }
  },

  _b_granary(ctx, n, P) {
    const cnt = Math.min(3, 1 + Math.floor(n.lv / 2));
    const s = 0.34;
    const offs = [[-0.42, -0.16], [0.4, -0.16], [-0.02, 0.3]];
    for (let i = 0; i < cnt; i++) {
      const o = offs[i];
      const x = n.x + o[0] * this.TILE_W * 0.8;
      const y = n.y + o[1] * this.TILE_H * 1.4;
      const h = 9 + n.lv;
      ctx.fillStyle = P.plaster;
      ctx.beginPath();
      ctx.moveTo(x - this._hw(s), y);
      ctx.lineTo(x, y + this._hh(s));
      ctx.lineTo(x, y + this._hh(s) - h);
      ctx.lineTo(x - this._hw(s), y - h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = P.wood;
      ctx.beginPath();
      ctx.moveTo(x, y + this._hh(s));
      ctx.lineTo(x + this._hw(s), y);
      ctx.lineTo(x + this._hw(s), y - h);
      ctx.lineTo(x, y + this._hh(s) - h);
      ctx.closePath();
      ctx.fill();
      this._roof(ctx, x, y, s, h, 7, P, P.wood, P.woodDark);
    }
  },

  _b_lumber(ctx, n, P) {
    // 木料堆 + 几棵树
    this._prism(ctx, n.x, n.y, 0.62, 3, P, P.earth, P.earth, P.earth2);
    ctx.strokeStyle = P.woodDark;
    ctx.lineWidth = 2.4;
    for (let i = 0; i < Math.min(4, 1 + n.lv); i++) {
      const oy = -i * 2.6;
      ctx.beginPath();
      ctx.moveTo(n.x - 13 + i * 2.4, n.y - 2 + oy);
      ctx.lineTo(n.x + 9 - i * 2.4, n.y - 5 + oy);
      ctx.stroke();
    }
    const trees = Math.min(3, Math.floor(n.lv / 2));
    for (let i = 0; i < trees; i++) {
      this._tree(ctx, n.x + 15 + i * 6, n.y - 8 - i * 3, 0.9 - i * 0.15, P);
    }
  },

  _b_quarry(ctx, n, P) {
    // 采石坑：挖下去的一块 + 料石
    ctx.fillStyle = P.stoneDark;
    this._dia(ctx, n.x, n.y + 2, 0.7);
    ctx.fill();
    ctx.fillStyle = P.earth2;
    this._dia(ctx, n.x, n.y + 1, 0.5);
    ctx.fill();
    ctx.fillStyle = P.stone;
    const cnt = Math.min(6, 1 + n.lv);
    for (let i = 0; i < cnt; i++) {
      const t = (i % 3) - 1;
      const r = Math.floor(i / 3);
      ctx.fillRect(n.x + t * 9 - 2.5, n.y - 1 - r * 3.4, 5, 3);
    }
  },

  _b_ironworks(ctx, n, P) {
    this._prism(ctx, n.x - 3, n.y + 1, 0.6, 9 + n.lv, P, P.stone, P.stone, P.stoneDark);
    // 烟囱
    const cx = n.x + 8;
    const cy = n.y - 3;
    const h = 16 + n.lv * 2.2;
    ctx.fillStyle = P.stoneDark;
    ctx.fillRect(cx - 2.2, cy - h, 4.4, h);
    ctx.fillStyle = P.stone;
    ctx.fillRect(cx - 2.2, cy - h, 2, h);
    // 烟（等级越高越浓）
    ctx.fillStyle = P.wall;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < Math.min(4, n.lv); i++) {
      ctx.beginPath();
      ctx.arc(cx + i * 2.6 - 1, cy - h - 4 - i * 4.4, 2.6 + i * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 炉火
    ctx.fillStyle = P.fire;
    ctx.fillRect(cx - 4.5, cy - 5, 3, 3);
  },

  _b_stable(ctx, n, P) {
    // 围栏 + 一匹马
    const hw = this._hw(0.78);
    const hh = this._hh(0.78);
    ctx.strokeStyle = P.wood;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(n.x - hw, n.y);
    ctx.lineTo(n.x, n.y + hh);
    ctx.lineTo(n.x + hw, n.y);
    ctx.stroke();
    ctx.strokeStyle = P.woodDark;
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const t = i / 5;
      const x = n.x - hw + hw * t * 2;
      const y = n.y + (t < 0.5 ? hh * t * 2 : hh * (2 - t * 2));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 4);
      ctx.stroke();
    }
    if (n.lv >= 1) this._horse(ctx, n.x - 4, n.y - 2, P);
    if (n.lv >= 3) this._horse(ctx, n.x + 9, n.y - 6, P);
    if (n.lv >= 1) this._hall(ctx, n.x + 14, n.y - 10, 0.3, 6, 5, P, P.roofLit, P.roof);
  },

  _horse(ctx, x, y, P) {
    ctx.fillStyle = P.woodDark;
    ctx.beginPath();
    ctx.ellipse(x, y - 4, 5.5, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 4, y - 3, 1.4, 4);
    ctx.fillRect(x + 2.6, y - 3, 1.4, 4);
    ctx.fillRect(x + 4.2, y - 8, 1.6, 4.6);
  },

  _b_barracks(ctx, n, P) {
    // 长条营房 + 一排门洞 + 枪架
    const s = 0.72;
    const h = 8 + n.lv * 1.2;
    this._prism(ctx, n.x, n.y, s, h, P, P.wood, P.wood, P.woodDark);
    this._roof(ctx, n.x, n.y, s, h, 6, P, P.roofLit, P.roof);
    ctx.fillStyle = P.woodDark;
    const doors = Math.min(4, 1 + Math.floor(n.lv / 2));
    for (let i = 0; i < doors; i++) {
      const t = (i + 0.5) / doors;
      ctx.fillRect(n.x - this._hw(s) + this._hw(s) * t * 2 - 1.4, n.y + this._hh(s) * 0.5 - 4, 2.8, 4);
    }
    ctx.strokeStyle = P.stone;
    ctx.lineWidth = 1;
    for (let i = 0; i < Math.min(3, n.lv); i++) {
      ctx.beginPath();
      ctx.moveTo(n.x + 13 + i * 3, n.y - 2);
      ctx.lineTo(n.x + 15 + i * 3, n.y - 12);
      ctx.stroke();
    }
  },

  _b_drill(ctx, n, P) {
    // 夯土校场 + 旗下 + 木人
    ctx.fillStyle = P.earth;
    this._dia(ctx, n.x, n.y, 0.86);
    ctx.fill();
    ctx.strokeStyle = P.wall;
    ctx.lineWidth = 1;
    this._dia(ctx, n.x, n.y, 0.6);
    ctx.stroke();
    for (let i = 0; i < Math.min(3, n.lv); i++) {
      const x = n.x - 10 + i * 10;
      ctx.strokeStyle = P.woodDark;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, n.y);
      ctx.lineTo(x, n.y - 12);
      ctx.stroke();
      ctx.fillStyle = P.wood;
      ctx.fillRect(x - 3, n.y - 15, 6, 3.4);
    }
    // 军旗
    const fx = n.x + 15;
    ctx.strokeStyle = P.woodDark;
    ctx.beginPath();
    ctx.moveTo(fx, n.y + 2);
    ctx.lineTo(fx, n.y - 20 - n.lv);
    ctx.stroke();
    ctx.fillStyle = P.beam;
    ctx.beginPath();
    ctx.moveTo(fx, n.y - 20 - n.lv);
    ctx.lineTo(fx + 9, n.y - 17 - n.lv);
    ctx.lineTo(fx, n.y - 13 - n.lv);
    ctx.closePath();
    ctx.fill();
  },

  _b_office(ctx, n, P) {
    // 府衙：全城最高，两重檐，官式瓦
    const h = 15 + n.lv * 1.6;
    this._prism(ctx, n.x, n.y, 0.92, h, P, P.plaster, P.plaster, P.beam);
    this._posts(ctx, n.x, n.y, 0.92, h, P);
    this._roof(ctx, n.x, n.y, 0.92, h, 9, P, P.roofGold, P.woodDark);
    if (n.lv >= 2) {
      this._prism(ctx, n.x, n.y, 0.5, h + 8, P, P.plaster, P.plaster, P.beam);
      this._roof(ctx, n.x, n.y, 0.5, h + 8, 8, P, P.roofGold, P.woodDark);
    }
    // 治所星标
    ctx.fillStyle = P.gold;
    const sy = n.y - h - (n.lv >= 2 ? 24 : 15);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      const a2 = a + Math.PI / 5;
      ctx.lineTo(n.x + Math.cos(a) * 4.2, sy + Math.sin(a) * 4.2);
      ctx.lineTo(n.x + Math.cos(a2) * 1.8, sy + Math.sin(a2) * 1.8);
    }
    ctx.closePath();
    ctx.fill();
  },

  _b_academy(ctx, n, P) {
    const s = 0.8;
    const h = 11 + n.lv * 1.2;
    this._prism(ctx, n.x, n.y, s, h, P, P.plaster, P.plaster, P.beam);
    this._roof(ctx, n.x, n.y, s, h, 7, P, P.roofGold, P.roof);
    // 三座门洞
    ctx.fillStyle = P.woodDark;
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      ctx.fillRect(n.x - this._hw(s) + this._hw(s) * t * 2 - 1.6,
        n.y + this._hh(s) * 0.5 - 5, 3.2, 5);
    }
    // 碑
    ctx.fillStyle = P.stone;
    ctx.fillRect(n.x + 15, n.y - 9, 4, 9);
    ctx.fillStyle = P.stoneDark;
    ctx.fillRect(n.x + 15.6, n.y - 8, 2.8, 1);
  },

  _b_clinic(ctx, n, P) {
    this._hall(ctx, n.x, n.y, 0.72, 9 + n.lv, 6, P, P.roofLit, P.roof);
    // 药幌
    const bx = n.x + 13;
    ctx.strokeStyle = P.woodDark;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(bx, n.y + 3);
    ctx.lineTo(bx, n.y - 17);
    ctx.stroke();
    ctx.fillStyle = P.plaster;
    ctx.fillRect(bx, n.y - 17, 6, 9);
    ctx.fillStyle = P.beam;
    ctx.fillRect(bx + 2.2, n.y - 15.4, 1.6, 5.4);
    ctx.fillRect(bx + 0.8, n.y - 13.6, 4.4, 1.6);
  },

  _b_beacon(ctx, n, P) {
    // 烽燧：瘦高台，二级以上点火
    const s = 0.34;
    const h = 20 + n.lv * 3;
    this._prism(ctx, n.x, n.y, s, h, P, P.stone, P.stone, P.stoneDark);
    // 台顶垛口
    ctx.fillStyle = P.stone;
    ctx.fillRect(n.x - 5, n.y - h - 2, 10, 2);
    if (n.lv >= 2) {
      const fy = n.y - h - 3;
      const grad = ctx.createLinearGradient(0, fy - 9, 0, fy);
      grad.addColorStop(0, P.fire);
      grad.addColorStop(1, P.wall);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(n.x - 3.4, fy);
      ctx.quadraticCurveTo(n.x - 1.6, fy - 7, n.x, fy - 10 - n.lv * 0.7);
      ctx.quadraticCurveTo(n.x + 2, fy - 6, n.x + 3.4, fy);
      ctx.closePath();
      ctx.fill();
    }
  },

  _b_shipyard(ctx, n, P) {
    if (!n.water) {
      // 不临水：只留空地与料木
      ctx.fillStyle = P.earth2;
      this._dia(ctx, n.x, n.y, 0.8);
      ctx.fill();
      ctx.strokeStyle = P.woodDark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(n.x - 8, n.y + 1);
      ctx.lineTo(n.x + 6, n.y - 2);
      ctx.stroke();
      return;
    }
    // 水面 + 栈桥 + 船
    const hw = this._hw(0.86);
    const hh = this._hh(0.86);
    ctx.fillStyle = P.water;
    this._dia(ctx, n.x, n.y + 3, 0.86);
    ctx.fill();
    ctx.strokeStyle = P.woodDark;
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const yy = n.y - 1 + i * 4;
      const t = 0.24 - i * 0.06;
      ctx.beginPath();
      ctx.moveTo(n.x - hw * (1 - t), yy);
      ctx.lineTo(n.x + hw * (1 - t), yy - hh * 0.1);
      ctx.stroke();
    }
    // 栈桥
    ctx.fillStyle = P.wood;
    ctx.beginPath();
    ctx.moveTo(n.x - 2, n.y - 1);
    ctx.lineTo(n.x + 4, n.y - 4);
    ctx.lineTo(n.x + 18, n.y - 1);
    ctx.lineTo(n.x + 12, n.y + 2);
    ctx.closePath();
    ctx.fill();
    // 船
    if (n.lv >= 1) {
      const bx = n.x + 8;
      const by = n.y - 6;
      ctx.fillStyle = P.woodDark;
      ctx.beginPath();
      ctx.moveTo(bx - 9, by);
      ctx.quadraticCurveTo(bx, by + 5, bx + 9, by);
      ctx.lineTo(bx + 6, by - 2);
      ctx.lineTo(bx - 6, by - 2);
      ctx.closePath();
      ctx.fill();
      if (n.lv >= 2) {
        ctx.strokeStyle = P.woodDark;
        ctx.beginPath();
        ctx.moveTo(bx, by - 2);
        ctx.lineTo(bx, by - 13);
        ctx.stroke();
        ctx.fillStyle = P.plaster;
        ctx.beginPath();
        ctx.moveTo(bx, by - 13);
        ctx.lineTo(bx + 6, by - 9);
        ctx.lineTo(bx, by - 6);
        ctx.closePath();
        ctx.fill();
      }
    }
  },

  _b_customs(ctx, n, P) {
    // 关：两柱一门 + 稽查小舍
    const h = 12 + n.lv * 1.4;
    ctx.strokeStyle = P.beam;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(n.x - 10, n.y + 3);
    ctx.lineTo(n.x - 10, n.y + 3 - h);
    ctx.moveTo(n.x + 8, n.y - 2);
    ctx.lineTo(n.x + 8, n.y - 2 - h);
    ctx.stroke();
    ctx.fillStyle = P.wood;
    ctx.beginPath();
    ctx.moveTo(n.x - 13, n.y + 1 - h);
    ctx.lineTo(n.x + 11, n.y - 4 - h);
    ctx.lineTo(n.x + 11, n.y - 7 - h);
    ctx.lineTo(n.x - 13, n.y - 2 - h);
    ctx.closePath();
    ctx.fill();
    this._hall(ctx, n.x + 14, n.y + 1, 0.32, 6, 4, P, P.roofLit, P.roof);
  },

  // ───────── 点缀 ─────────

  _tree(ctx, x, y, k, P) {
    ctx.fillStyle = P.woodDark;
    ctx.fillRect(x - 0.8 * k, y - 5 * k, 1.6 * k, 5 * k);
    ctx.fillStyle = P.grass;
    ctx.beginPath();
    ctx.arc(x, y - 8 * k, 4.2 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = P.grass2;
    ctx.beginPath();
    ctx.arc(x + 1.6 * k, y - 6.6 * k, 2.6 * k, 0, Math.PI * 2);
    ctx.fill();
  },

  _prop(ctx, x, y, kind, P) {
    if (kind === 'tree') { this._tree(ctx, x, y, 0.9, P); return; }
    if (kind === 'well') {
      ctx.strokeStyle = P.stone;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(x, y, 4.4, 2.2, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = P.water;
      ctx.beginPath();
      ctx.ellipse(x, y, 3.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    // 车
    ctx.fillStyle = P.woodDark;
    ctx.fillRect(x - 5, y - 5, 10, 3);
    ctx.beginPath();
    ctx.arc(x - 3, y - 1.4, 1.8, 0, Math.PI * 2);
    ctx.arc(x + 3, y - 1.4, 1.8, 0, Math.PI * 2);
    ctx.fill();
  },

  // ───────────────────────── 挂载 ─────────────────────────

  /**
   * 把内景画进 canvas 并接上点击：点建筑 → 跳「营造」页并高亮那一行。
   * 测试里没有真 DOM，一律靠 getContext 判断而不是 try/catch。
   *
   * 尺寸：CSS 给的是不定高（clamp），这里按 contain 缩放进这个盒子，
   * 所以窗口矮的时候整座城同时缩小，不会被 pane 裁掉半截建筑。
   */
  mount(el, G, c) {
    if (!el || !el.getContext) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;

    const nodes = this.nodes(G, c);
    const view = { k: 1, ox: 0, oy: 0 };
    el._cv = { G, c, nodes, hover: -1, ctx, view };

    const fit = () => {
      const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
      const cw = el.clientWidth || this.W;
      const ch = el.clientHeight || this.H;
      const k = Math.min(cw / this.W, ch / this.H);
      el.width = Math.max(1, Math.round(cw * dpr));
      el.height = Math.max(1, Math.round(ch * dpr));
      view.k = k;
      view.ox = (cw - this.W * k) / 2;
      view.oy = (ch - this.H * k) / 2;
      view.dpr = dpr;
      view.cw = cw;
      view.ch = ch;
    };

    const paint = () => {
      const v = el._cv.view;
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      ctx.clearRect(0, 0, v.cw, v.ch);
      ctx.setTransform(v.dpr * v.k, 0, 0, v.dpr * v.k, v.dpr * v.ox, v.dpr * v.oy);
      this.paint(ctx, nodes, c);
      if (el._cv.hover >= 0) this._label(ctx, nodes[el._cv.hover]);
    };

    const repaint = (hover) => {
      el._cv.hover = hover;
      paint();
    };

    fit();
    paint();

    const toLocal = (ev) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !el._cv.view.k) return null;
      return {
        x: ((ev.clientX - r.left) - el._cv.view.ox) / el._cv.view.k,
        y: ((ev.clientY - r.top) - el._cv.view.oy) / el._cv.view.k,
      };
    };

    const pick = (pt) => {
      if (!pt) return -1;
      const cell = this._cellOf(pt.x, pt.y);
      // 点在地块上、且竖直方向够得着建筑本体（屋顶最高约 40px）
      if (cell.col < -0.5 || cell.col > 6.5 || cell.row < -0.5 || cell.row > 4.5) return -1;
      let best = -1;
      let bestD = 1e9;
      nodes.forEach((n, i) => {
        if (Math.abs(pt.x - n.x) / this._hw(0.95) > 1) return;
        if (pt.y > n.y + this._hh(0.95)) return;
        if (pt.y < n.y - 40 - this._hh(0.95)) return;
        const d = Math.abs(pt.x - n.x) + Math.abs(pt.y - n.y);
        if (d < bestD) { bestD = d; best = i; }
      });
      return best;
    };

    el.onmousemove = (ev) => {
      const i = pick(toLocal(ev));
      if (i === el._cv.hover) return;
      el.classList.toggle('hot', i >= 0);
      repaint(i);
    };
    el.onmouseleave = () => {
      if (el._cv.hover !== -1) {
        el.classList.remove('hot');
        repaint(-1);
      }
    };
    el.onclick = (ev) => {
      const i = pick(toLocal(ev));
      if (i < 0) return;
      const key = nodes[i].key;
      UI.cityTab = 'build';
      UI.syncTabs();
      UI.render(G);
      const pane = UI.$('cityPane');
      const btn = pane && pane.querySelector ? pane.querySelector(`button[data-build="${key}"]`) : null;
      const row = btn && btn.closest ? btn.closest('.brow') : null;
      if (row) {
        row.classList.add('hl');
        if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
      }
    };
  },

  /** 悬停时左上角的建筑名 + 等级 */
  _label(ctx, n) {
    const P = this.pal();
    const text = `${n.name} ${n.lv}/${n.max}${n.under ? ' · 在建 ' + n.under + '%' : ''}`;
    ctx.font = '11px sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = P.empty;
    ctx.globalAlpha = 0.86;
    ctx.fillRect(6, 6, w, 16);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = P.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(6.5, 6.5, w, 15);
    ctx.fillStyle = P.wallLit;
    ctx.fillText(text, 11, 18);
  },
};
