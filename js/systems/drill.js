// 校场训练：给闲置武将一条「有正事可做」的路（解 DESIGN §11.5「武将大量闲置」）。
//
// 设计取舍：
//   · 不引入经验条 —— 一次训练 = 选定那一项 +1，玩家当场看得见结果，也不用新增 xp 字段
//   · 三条闸门卡死成长速度：校场等级（每月几人）/ 单人上限 6 次 / 该项 95 封顶
//   · 训练顺带把 h.idle 归零、私交 +2 —— 闲置是有惩罚的（人情账会掉忠诚），训练是解法
//
// 状态只有两处：
//   h.train   已训练次数（0-6），HERO_DEFAULTS 兜底
//   c.trained { turn, used }  本城本月用掉几个训练位，回合变了当 0（与市肆同款懒重置）

const Drill = {

  /** 五维，也是训练方向 */
  DIRS: ['wu', 'tong', 'zhi', 'zheng', 'mei'],
  DIR_NAME: { wu: '武', tong: '统', zhi: '智', zheng: '政', mei: '魅' },
  PER_HERO_CAP: 6,      // 一人最多练出 6 点
  STAT_CAP: 95,         // 单项 95 封顶（不能把吕布练成神）

  /** 本城训练位：容量 = 校场等级，used 按月清零 */
  slots(G, c) {
    const cap = State.bld(c, 'drill');
    const t = c.trained;
    const used = (t && t.turn === G.meta.turn) ? (t.used || 0) : 0;
    return { cap, used, left: Math.max(0, cap - used) };
  },

  /** 训练一次的价格：越练越贵，校场越高级越便宜 */
  cost(G, c, h) {
    const n = h.train || 0;
    const lv = State.bld(c, 'drill');
    const base = 80 + n * 70;
    const off = 1 - 0.05 * Math.max(0, lv - 1);      // 校场每级 -5%
    return Math.max(20, Math.round(base * off));
  },

  /** 这名武将归不归本城管（守将或驻留本城） */
  atCity(c, h) {
    return h.cityId === c.id || c.governor === h.id;
  },

  /**
   * 能不能练。dir 省略时只查「这人还能不能练」，不查方向。
   * 返回 { ok, why, cost }
   */
  canTrain(G, c, h, dir) {
    const cost = Drill.cost(G, c, h);
    if (G.over) return { ok: false, why: '战局已终', cost };
    if (!h || !h.alive) return { ok: false, why: '无此武将', cost };
    if (h.factionId !== c.owner) return { ok: false, why: '非本方武将', cost };
    if (!Drill.atCity(c, h)) return { ok: false, why: '不在此城', cost };
    const lv = State.bld(c, 'drill');
    if (lv < 1) return { ok: false, why: '未建校场', cost };
    if ((h.train || 0) >= Drill.PER_HERO_CAP) {
      return { ok: false, why: `已练至上限（${Drill.PER_HERO_CAP} 次）`, cost };
    }
    const s = Drill.slots(G, c);
    if (s.left <= 0) return { ok: false, why: `本月训练位已满（校场 ${lv} 级 = ${lv} 人/月）`, cost };
    if (c.gold < cost) return { ok: false, why: `钱不足（需 ${cost}）`, cost };
    if (dir) {
      if (Drill.DIRS.indexOf(dir) < 0) return { ok: false, why: '无此训练方向', cost };
      if ((h[dir] || 0) >= Drill.STAT_CAP) {
        return { ok: false, why: `${Drill.DIR_NAME[dir]}已至 ${Drill.STAT_CAP}，练不动了`, cost };
      }
    }
    return { ok: true, cost };
  },

  /** 真练一次（规则层，不动命令层）：扣钱、涨项、占位 */
  apply(G, c, h, dir) {
    const chk = Drill.canTrain(G, c, h, dir);
    if (!chk.ok) throw new Error(chk.why);

    c.gold -= chk.cost;
    h[dir] = Math.min(Drill.STAT_CAP, (h[dir] || 0) + 1);
    h.train = (h.train || 0) + 1;
    h.bond = U.clamp((h.bond || 0) + 2, 0, 100);
    h.idle = 0;

    const t = c.trained;
    c.trained = {
      turn: G.meta.turn,
      used: ((t && t.turn === G.meta.turn) ? (t.used || 0) : 0) + 1,
    };
    return { cost: chk.cost, dir, value: h[dir] };
  },
};
