// 征兵：统一校验与扣费，供玩家命令 / 太守 / AI 共用
const Recruit = {

  /** 单兵种可募上限（受兵额、资源、人口限制） */
  maxAffordable(G, c, troop) {
    const caps = State.troopCapByType(G, c);
    const typeRoom = Math.max(0, caps[troop] - (c.garrison[troop] || 0));
    if (typeRoom <= 0) return 0;
    const totalRoom = Math.max(0, State.troopCapOf(G, c) - troopTotal(c.garrison));
    const t = TROOPS[troop];
    const byGold = Math.floor(c.gold / Math.max(0.0001, t.cost));
    const byPop = Math.floor(Math.max(0, c.pop - 15) / Math.max(0.0001, t.popCost));
    return Math.max(0, Math.min(typeRoom, totalRoom, byGold, byPop));
  },

  /** 校验（不扣费） */
  check(G, c, troop, amount) {
    if (G.over) throw new Error('战局已终');
    if (!TROOPS[troop]) throw new Error('兵种无效');
    amount = Math.floor(amount);
    if (!(amount > 0)) throw new Error('数量无效');
    if (troop === 'cav' && State.bld(c, 'stable') < 1) throw new Error(`${c.name}无马场，不可募骑兵`);
    if (troop === 'nvy' && State.bld(c, 'shipyard') < 1) throw new Error(`${c.name}无船坞，不可募水军`);

    const caps = State.troopCapByType(G, c);
    if ((c.garrison[troop] || 0) + amount > caps[troop]) {
      throw new Error(`${TROOPS[troop].name}兵额上限 ${caps[troop]}`);
    }
    const totalCap = State.troopCapOf(G, c);
    if (troopTotal(c.garrison) + amount > totalCap) {
      throw new Error(`民力已竭（此城兵额 ${totalCap}）`);
    }
    const cost = Economy.recruitCost(amount, troop);
    if (c.gold < cost.gold) throw new Error(`钱不足（需 ${cost.gold}）`);
    if (c.pop < cost.pop + 8) throw new Error(`丁口不足（需 ${cost.pop}，现有 ${Math.round(c.pop)}）`);
    return cost;
  },

  /** 执行募兵 */
  add(G, c, troop, amount, silent) {
    const cost = Recruit.check(G, c, troop, amount);
    c.gold -= cost.gold;
    c.pop -= cost.pop;
    c.garrison[troop] = (c.garrison[troop] || 0) + amount;
    c.order = U.clamp(c.order - 0.5, 0, 100);
    if (!silent) {
      State.log(G, 'good', `${c.name}募${TROOPS[troop].name}${U.num(amount)}，费钱${cost.gold}。`);
    }
    return cost;
  },

  /** 按缺口自动配兵（步 62 / 弓 26 / 骑 15 / 水 / 器），太守与 AI 用 */
  autoFill(G, c, want, silent) {
    if (want <= 0) return 0;
    // 粮草护栏：存粮不足三个月开销就不再加兵
    const upkeep = troopFood(c.garrison) + c.pop * 0.32;
    if (c.food < upkeep * 3) return 0;
    const order = ['inf', 'arc', 'cav', 'nvy', 'siege'];
    let left = Math.round(want);
    let added = 0;

    // 第一轮按目标配比
    const mix = { inf: 0.62, arc: 0.26, cav: 0.15, nvy: 0.10, siege: 0.04 };
    for (const k of order) {
      if (left <= 0) break;
      const room = Recruit.maxAffordable(G, c, k);
      if (room <= 0) continue;
      let take = Math.min(left, Math.round(want * mix[k]), room);
      if (take < 20) continue;
      try {
        Recruit.add(G, c, k, take, true);
        left -= take;
        added += take;
      } catch (e) { /* 资源不足，跳过 */ }
    }

    // 第二轮补余量（只补步弓）
    if (left >= 20) {
      for (const k of ['inf', 'arc']) {
        if (left < 20) break;
        const room = Recruit.maxAffordable(G, c, k);
        if (room < 20) continue;
        const take = Math.min(left, room);
        try {
          Recruit.add(G, c, k, take, true);
          left -= take;
          added += take;
        } catch (e) { }
      }
    }

    if (added > 0 && !silent) {
      State.log(G, 'note', `${c.name}募兵 ${U.num(added)}。`);
    }
    return added;
  },
};
