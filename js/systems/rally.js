// 持续调兵（补给线）：把某城每月抽一部分兵，持续送往目标城
const Rally = {

  // 目标城补到这个比例就暂停（每城可调：rallyFill）
  DEFAULT_FILL: 1.2,

  // 本城保护下限：本城兵力的 8%，且不低于 60 兵。
  // 取「本城兵力」为基数，保证「抽兵比例」永远是真正生效的那个旋钮
  // （若按兵额取基数，兵额大的城下限会高到把抽兵比例压死 —— 这正是之前的坑）。
  KEEP_FLOOR: 0.08,
  KEEP_MIN: 60,

  /** 本城必须保留的兵力 */
  floorOf(G, c) {
    const total = troopTotal(c.garrison);
    return Math.max(Rally.KEEP_MIN, Math.round(total * Rally.KEEP_FLOOR));
  },

  /** 每回合理政后执行一次 */
  run(G, stamp) {
    if (G.over) return;

    for (const c of State.demesne(G)) {
      if (!c.rallyTo) continue;

      const to = G.cities[c.rallyTo];
      if (!to || to.id === c.id) { c.rallyTo = null; continue; }

      // 同一源城到同一目标只保留一支在途，避免刷屏
      const inFlight = Object.values(G.armies).some(a =>
        a.factionId === G.player.factionId && a.from === c.id && a.to === c.rallyTo);
      if (inFlight) continue;

      const room = Rally.roomFor(G, c, to);
      if (room < 40) continue;

      // 目标城已非交战势力：停发，不替玩家白送背刺
      if (to.owner !== G.player.factionId && !Diplo.canAttack(G, G.player.factionId, to.owner)) {
        c.rallyTo = null;
        State.log(G, 'note', `${c.name}罢持续调兵：${to.name}已非可攻之城。`);
        continue;
      }

      const total = troopTotal(c.garrison);
      const floor = Rally.floorOf(G, c);
      if (total <= floor + 40) continue;

      const ratio = U.clamp(c.rallyRatio == null ? 0.5 : c.rallyRatio, 0.1, 1);
      const take = Math.min(total - floor, Math.round(total * ratio), room);
      if (take < 40) continue;

      const troops = Army.takeFromGarrison(c.garrison, take / total);

      const heroId = Rally._heroFor(G, c.id);

      Army.create(G, {
        factionId: G.player.factionId,
        heroId,
        from: c.id,
        to: c.rallyTo,
        troops,
        mission: to.owner === G.player.factionId ? 'reinforce' : 'attack',
      });
    }
  },

  _heroFor(G, cityId) {
    const busy = new Set(Object.values(G.armies).map(a => a.heroId).filter(Boolean));
    const cands = Object.values(G.heroes)
      .filter(h => h.factionId === G.player.factionId && h.cityId === cityId && !busy.has(h.id))
      .sort((a, b) => b.tong - a.tong);
    return cands.length ? cands[0].id : null;
  },

  /** 目标还能再接多少兵 */
  roomFor(G, c, to) {
    const fill = c.rallyFill == null ? Rally.DEFAULT_FILL : c.rallyFill;
    const limit = Math.round(State.troopCapOf(G, to) * fill);
    let inbound = 0;
    for (const a of Object.values(G.armies)) {
      if (a.factionId === G.player.factionId && a.to === to.id) inbound += troopTotal(a.troops);
    }
    return limit - troopTotal(to.garrison) - inbound;
  },

  /** UI 预估：本次会送多少（目标已满则 0） */
  estimate(G, c, toId) {
    const tid = toId === undefined ? c.rallyTo : toId;
    const to = tid ? G.cities[tid] : null;
    const keep = Rally.floorOf(G, c);
    const total = troopTotal(c.garrison);
    const ratio = U.clamp(c.rallyRatio == null ? 0.5 : c.rallyRatio, 0.1, 1);
    if (total <= keep + 40) return 0;
    let n = Math.min(total - keep, Math.round(total * ratio));
    if (to) n = Math.min(n, Math.max(0, Rally.roomFor(G, c, to)));
    return n < 40 ? 0 : n;
  },

  /** 本次输送的完整拆解：谁在限制、实际送多少、送后双方多少 */
  detail(G, c, toId) {
    const tid = toId === undefined ? c.rallyTo : toId;
    const to = tid ? G.cities[tid] : null;
    const cap = State.troopCapOf(G, c);
    const keep = Rally.floorOf(G, c);
    const total = troopTotal(c.garrison);
    const ratio = U.clamp(c.rallyRatio == null ? 0.5 : c.rallyRatio, 0.1, 1);

    const byKeep = Math.max(0, total - keep);              // 高于保护下限的部分
    const byRatio = Math.round(total * ratio);             // 抽兵比例允许的部分
    const room = to ? Math.max(0, Rally.roomFor(G, c, to)) : Infinity;

    let send = Math.min(total, byKeep, byRatio);
    let bind = byKeep < byRatio ? 'keep' : 'ratio';
    if (room < send) { send = room; bind = 'room'; }
    if (send < 40) send = 0;

    const dstCap = to ? State.troopCapOf(G, to) : 0;
    const fill = c.rallyFill == null ? Rally.DEFAULT_FILL : c.rallyFill;

    return {
      cap, total, keep, ratio, byKeep, byRatio, room, send, bind, keepPct: cap ? keep / cap : 0,
      after: total - send,
      dst: to ? { name: to.name, have: troopTotal(to.garrison), cap: dstCap, limit: Math.round(dstCap * fill) } : null,
    };
  },

  /** 当前状态（供 UI 显示，避免玩家以为没生效） */
  status(G, c) {
    if (!c.rallyTo) return { code: 'off', text: '未设定' };
    const to = G.cities[c.rallyTo];
    if (!to) return { code: 'off', text: '目标城池不存在' };

    const inFlight = Object.values(G.armies).filter(a =>
      a.factionId === G.player.factionId && a.from === c.id && a.to === c.rallyTo);
    if (inFlight.length) {
      const n = inFlight.reduce((s, a) => s + troopTotal(a.troops), 0);
      return { code: 'moving', text: `输送中：${U.num(n)} 兵在途，${inFlight[0].eta} 月抵达` };
    }

    const d = Rally.detail(G, c, to.id);

    if (d.total <= d.keep + 40) {
      const gate = d.keep + 40;
      return {
        code: 'low',
        text: `暂停：本城仅 ${U.num(d.total)} 兵，未达发送门槛 ${U.num(gate)}`
          + `（保护下限 ${U.num(d.keep)}，另留 40 兵余量）。`
          + `募兵补到 ${U.num(gate)} 以上即可开始输送。`,
      };
    }

    if (d.room < 40) {
      return {
        code: 'full',
        text: `暂缓：${to.name}已到补给上限 ${U.num(d.dst.have)}/${U.num(d.dst.limit)}`
          + `（兵额 ${Math.round((c.rallyFill || Rally.DEFAULT_FILL) * 100)}%）。待该城掉兵后自动恢复。`,
      };
    }

    const bindTxt = d.bind === 'keep' ? `受保护下限限制（抽 ${Math.round(d.ratio * 100)}% 超过可动份额）`
      : d.bind === 'ratio' ? `按抽 ${Math.round(d.ratio * 100)}%`
      : '受目标剩余容量限制';
    return {
      code: 'ready',
      text: `就绪：下回合送出 ${U.num(d.send)} 兵，本城留 ${U.num(d.after)}。${bindTxt}。`,
    };
  },
};
