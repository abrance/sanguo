// AI 内政：收税 → 募兵 → 营造
// 只读 AI.assess 给出的 plan（局势），不做自己的 State 扫描 —— 想加判断先加到 plan 里。
const AIEcon = {

  run(G, f, plan) {
    AIEcon.tax(G, f, plan.cities);
    AIEcon.recruit(G, f, plan);
    AIEcon.build(G, f, plan);
  },

  /** 收税：每月抽 12% 进府库（上限按城数封顶，防止无限攒钱） */
  tax(G, f, cities) {
    for (const c of cities) {
      const up = c.gold * 0.12;
      c.gold -= up;
      f.treasury += up;
    }
    f.treasury = Math.min(f.treasury, cities.length * 1100);
  },

  /** 募兵目标比例：受威胁城 > 战时 > 平时；侵略性只做小幅修正 */
  ratioFor(plan, c) {
    if (plan.threatened.some(t => t.cityId === c.id)) return 0.85;
    if (plan.atWar) return 0.70 + plan.faction.aggression * 0.10;
    return 0.45 + plan.faction.aggression * 0.15;
  },

  recruit(G, f, plan) {
    // 受威胁城先补（同一笔府库，先到先得）
    const hot = new Set(plan.threatened.map(t => t.cityId));
    const cities = [...plan.cities].sort((a, b) => (hot.has(b.id) ? 1 : 0) - (hot.has(a.id) ? 1 : 0));

    for (const c of cities) {
      const cap = State.troopCapOf(G, c);
      const cur = troopTotal(c.garrison);
      const target = cap * AIEcon.ratioFor(plan, c);
      if (cur >= target * 0.97) continue;

      const want = Math.min(Math.round(target - cur), Math.round(c.pop * 1.6));
      if (want < 20) continue;

      const before = c.gold;
      const added = Recruit.autoFill(G, c, want, true);
      if (added > 0 && c.gold < 60) {
        const take = Math.min(f.treasury, 120);
        c.gold += take;
        f.treasury -= take;
      }
      void before;
    }
  },

  /** 营造顺序：挨打在即先堆墙，其余按侵略性与局势分三档 */
  buildOrder(plan) {
    const f = plan.faction;
    if (plan.threatened.length) return ['wall', 'barracks', 'drill', 'farm', 'market', 'office', 'stable', 'ironworks'];
    if (f.aggression > 0.55) return ['barracks', 'farm', 'drill', 'stable', 'wall', 'ironworks', 'academy', 'office'];
    if (f.aggression > 0.35) return ['farm', 'market', 'barracks', 'wall', 'office', 'academy', 'drill', 'granary'];
    return ['farm', 'market', 'academy', 'office', 'granary', 'wall', 'barracks', 'customs'];
  },

  /** 营造：按顺序挑第一个能负担的项目；府库只补贴钱，建材铁料靠本地 */
  build(G, f, plan) {
    const order = AIEcon.buildOrder(plan);
    for (const c of plan.cities) {
      if (!Build.queueFree(c)) continue;
      if (c.mat < 40 && c.iron < 10) continue;

      for (const key of order) {
        const chk = Build.reqCheck(G, c, key);
        if (!chk.ok) continue;
        const cost = Build.costOf(G, c, key);

        if (c.gold < cost.gold) {
          const take = Math.min(f.treasury, cost.gold - c.gold);
          c.gold += take;
          f.treasury -= take;
        }
        if (c.gold < cost.gold || c.mat < cost.mat || c.iron < cost.iron) continue;

        try { Build.start(G, c, key, true); } catch (e) { }
        break;
      }
    }
  },
};
