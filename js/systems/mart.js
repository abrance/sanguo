// 市肆：货架生成、价格折算、可买性判定。
//
// 关键约束：**shelf() 必须是纯函数**。
//   · 面板渲染、命令层校验都调它，两边必须得到同一份货架（否则「看到 153 钱、扣 158」）
//   · 所以不用全局 RNG（那是存档里的序列游标，读一次就错位），
//     改成由 (seed, cityId, 回合) 哈希出来的**局部**序列
//   · 唯一持久化的是「这月买过什么」：c.mart = { turn, bought: [] }
//
// 存档兼容：c.mart 走 State.syncDerived 兜底，旧档读入后当「本月没买过」。

const Mart = {

  /** 本月是否已经换过货（回合变了就当没买过） */
  _state(G, c) {
    const m = c.mart;
    if (!m || m.turn !== G.meta.turn) return { turn: G.meta.turn, bought: [] };
    if (!Array.isArray(m.bought)) return { turn: G.meta.turn, bought: [] };
    return m;
  },

  bought(G, c) {
    return Mart._state(G, c).bought;
  },

  /** 局部确定性序列：同 seed + 城 + 回合 → 同货架 */
  rand(G, cityId) {
    const str = `${G.meta.seed}|${cityId}|${G.meta.turn}`;
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    let s = h || 1;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /** 货位数：市集 1 级 2 个，每 2 级多 1 个，关市每 2 级再 +1（最多 6 —— 货就那么多）*/
  slotCount(c) {
    const extra = Math.min(2, Math.floor(State.bld(c, 'customs') / 2));
    return Math.min(MART_ALWAYS.length + MART_POOL.length,
      2 + Math.floor(State.bld(c, 'market') / 2) + extra);
  },

  /** 价格乘数，逐项摊开给面板用（加成必须看得见） */
  multipliers(G, c) {
    const m = State.bld(c, 'market');
    const cu = State.bld(c, 'customs');
    const tal = c.grantedTo === PLAYER_HERO_ID ? talentOf(G) : {};
    const season = MART_SEASON[U.season(G.meta.month)] || 1;
    return {
      market: 1 - 0.03 * Math.max(0, m - 1),   // 市集每级 -3%（1 级无折扣）
      customs: 1 - 0.05 * cu,                  // 关市每级 -5%
      season,                                  // 秋 0.90 / 冬 1.08
      talent: tal.id === 'merchant' ? 0.85 : 1,// 商人天赋（只作用于直辖城）
    };
  },

  mulOf(mul) {
    return mul.market * mul.customs * mul.season * mul.talent;
  },

  /** 这件货现在能不能上架 */
  offerable(G, c, id, market) {
    const d = MART_GOODS[id];
    if (!d) return false;
    if (market < (d.minMarket || 1)) return false;
    if (d.bld && State.bld(c, d.bld) < 1) return false;
    if (d.kind === 'treasure' && !State.freeTreasures(G).length) return false;
    return true;
  },

  /** 单件货：量、基准价、实付价、买不买得了 */
  slotOf(G, c, id, bought, mul) {
    const d = MART_GOODS[id];
    const m = State.bld(c, 'market');
    const amt = d.amt(m);
    let base = d.base(m);
    let relicId = null;

    if (d.kind === 'treasure') {
      const free = State.freeTreasures(G);
      relicId = free[Math.floor(Mart.rand(G, c.id)() * free.length)] || null;
      if (!relicId) return null;
      base = MART_GOODS.relic.base() + (TREASURES[relicId].rare || 1) * 380;
    }

    const price = Math.max(1, Math.round(base * Mart.mulOf(mul)));
    const sold = bought.indexOf(id) >= 0;
    return {
      id,
      kind: d.kind,
      name: d.name,
      unitName: d.unitName,
      about: d.about,
      amt,
      base,
      price,
      relicId,
      sold,
      reason: Mart.reason(G, c, d, { amt, price, sold, relicId }),
    };
  },

  /** 为什么买不了（null = 能买）。与命令层共用，面板不自己判断 */
  reason(G, c, d, slot) {
    if (slot.sold) return '已售罄（下月换货）';
    if (G.over) return '战局已终';
    if (c.gold < slot.price) return `钱不足（需 ${slot.price}）`;
    if (d.kind === 'craft' && !c.buildQueue.length) return '本城无在建工程';
    if (d.kind === 'troop') {
      // 佣兵走步兵额：骑兵 / 水军要是也能买，就绕过了「无马场不可募骑」那道门
      const room = State.troopCapByType(G, c).inf - (c.garrison.inf || 0);
      if (room <= 0) return '步兵兵额已满';
      if (room < slot.amt) return `步兵兵额只容 ${Math.floor(room)}`;
    }
    if (d.kind === 'res') {
      const P = Economy.project(G, c);
      const cap = { mat: P.matCap, food: P.foodCap, iron: P.ironCap }[d.key];
      if (cap != null && c[d.key] + slot.amt > cap) {
        return `${d.unitName}满仓（上限 ${U.num(Math.round(cap))}）`;
      }
    }
    return null;
  },

  /**
   * 本月货架。市集未建成 → 空货架（市集是商店的门）。
   *
   * 常驻的料 / 粮先占位，但要**按「现在买了有没有用」排序**：
   * 粮仓满了、兵额满了、没在建工程…这些沉底，把货位让给佣兵 / 良匠 / 稀珍。
   * （实测：不排的话成熟城池的货架上一半是「满仓」死货，钱根本花不出去）
   */
  shelf(G, c) {
    const m = State.bld(c, 'market');
    if (m < 1) return [];
    const bought = Mart.bought(G, c);
    const mul = Mart.multipliers(G, c);
    const rnd = Mart.rand(G, c.id);

    const always = MART_ALWAYS.filter(id => Mart.offerable(G, c, id, m));
    const pool = MART_POOL.filter(id => Mart.offerable(G, c, id, m));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }

    const slots = always.concat(pool)
      .map(id => Mart.slotOf(G, c, id, bought, mul))
      .filter(Boolean);

    // 稳定排序：能买的在前（同组保持洗牌后的顺序）
    const dead = s => (s.reason && !s.sold) ? 1 : 0;
    slots.sort((a, b) => dead(a) - dead(b));

    return slots.slice(0, Mart.slotCount(c));
  },

  /** 命令层入口：按 id 取货，取不到就报错 */
  find(G, c, slotId) {
    const slot = Mart.shelf(G, c).find(s => s.id === slotId);
    if (!slot) throw new Error('本月货架上没有这件货');
    return slot;
  },
};
