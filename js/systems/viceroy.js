// 太守委任：设置了方针的直辖城，每月由太守自动理政（建造 + 征兵）
const Viceroy = {

  run(G, stamp) {
    for (const c of State.demesne(G)) {
      if (!c.policy) continue;
      const P = POLICIES[c.policy];
      if (!P) continue;

      // 1 建造（留 150 钱周转）
      if (Build.queueFree(c) && c.gold > 150) {
        const key = Build.autoPick(G, c, P.buildOrder);
        if (key) {
          const chk = Build.canBuild(G, c, key);
          if (chk.ok && c.gold - chk.cost.gold >= 150) {
            try { Build.start(G, c, key, true); } catch (e) { }
          }
        }
      }

      // 2 征兵到方针比例
      const cap = State.troopCapOf(G, c);
      const target = cap * P.recruitRatio;
      const cur = troopTotal(c.garrison);
      if (cur < target * 0.97 && c.gold > 80) {
        const want = Math.min(Math.round(target - cur), Math.round(c.pop * 1.2));
        if (want >= 20) Recruit.autoFill(G, c, want, true);
      }

      // 3 士气恢复（有校场更快）
      const drill = State.bld(c, 'drill');
      c.morale = U.clamp(c.morale + 1 + drill * 0.6, 0, 100);
    }
  },
};
