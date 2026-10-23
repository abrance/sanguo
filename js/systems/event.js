// 事件系统（docs/EVENTS.md）：抽取 → 选项 → 延迟后果 → 连锁
//
// 设计口径：
//   · 每回合最多抽 2 条（季度抽 2，其余 1），上一批没选完就不再抽（队列上限 2）
//   · 选项必须在选之前就能看到代价（costText），不可选要写原因（why）
//   · 延迟后果只存 {due, eventId, optionKey, cityId}（函数不能进存档），到期回查事件表执行
//   · 连锁最多 3 层
const EventSys = {

  MAX_QUEUE: 2,
  MAX_PENDING: 40,
  MAX_CHAIN: 3,
  SCOPE_MUL: { player: 3.0, faction: 1.5, world: 1.0 },

  /** 回合末：先兑现到期后果，再抽新事件（排在他处结算之后，不能影响本月已算完的经济） */
  tick(G) {
    EventSys.flushPending(G);
    if (G.over) return;
    if ((G.events.queue || []).length >= EventSys.MAX_QUEUE) return;

    const want = G.meta.turn % 4 === 0 ? 2 : 1;
    for (let i = 0; i < want; i++) {
      if (G.events.queue.length >= EventSys.MAX_QUEUE) break;
      const pick = EventSys.draw(G, 0);
      if (!pick) break;
      G.events.queue.push(pick);
      G.events.seen[pick.eventId] = G.meta.turn;
      G.stats.eventsSeen = (G.stats.eventsSeen || 0) + 1;
    }
  },

  /** 抽一条：权重 × scope 系数；同 id 冷却中 / once 已触发过 / cond 为假 都丢弃 */
  draw(G, chainDepth) {
    const turn = G.meta.turn;
    const cands = [];
    for (const id of EVENT_KEYS) {
      const ev = EVENTS[id];
      const seen = G.events.seen[id];

      let cityIds = [];
      if (ev.scope === 'player') {
        cityIds = State.demesne(G).map(c => c.id);
        if (!cityIds.length) continue;
      } else if (ev.scope === 'faction') {
        cityIds = State.factionCities(G, G.player.factionId).map(c => c.id);
        if (!cityIds.length) continue;
      } else {
        cityIds = [null];
      }

      for (const cityId of cityIds) {
        const ctx = EventSys.context(G, cityId);
        if (ev.once && seen) continue;
        if (!ev.once && seen && turn - seen < (ev.cooldown || 0)) continue;
        if ((G.events.queue || []).some(q => q.eventId === id)) continue;
        if (chainDepth > EventSys.MAX_CHAIN) continue;
        if (ev.cond && !ev.cond(G, ctx)) continue;
        cands.push({ id, cityId, w: ev.weight * (EventSys.SCOPE_MUL[ev.scope] || 1) });
        break;   // 同一条事件只取第一个满足条件的城
      }
    }
    if (!cands.length) return null;

    const total = cands.reduce((s, c) => s + c.w, 0);
    let roll = RNG.next() * total;
    for (const c of cands) {
      roll -= c.w;
      if (roll <= 0) return { eventId: c.id, cityId: c.cityId, turn };
    }
    const last = cands[cands.length - 1];
    return { eventId: last.id, cityId: last.cityId, turn };
  },

  context(G, cityId) {
    return {
      city: cityId ? G.cities[cityId] : null,
      cityId: cityId || null,
      faction: G.factions[G.player.factionId],
    };
  },

  /** 当前待决的那一条（界面与接口都读它） */
  current(G) {
    const q = G.events.queue || [];
    if (!q.length) return null;
    const item = q[0];
    const ev = EVENTS[item.eventId];
    if (!ev) return null;
    return { item, ev, ctx: EventSys.context(G, item.cityId) };
  },

  /** 选项可用性（界面渲染与命令校验共用） */
  options(G) {
    const cur = EventSys.current(G);
    if (!cur) return [];
    const { item, ev, ctx } = cur;
    return ev.options.map(o => {
      let cost = null, why = o.why || null;
      try { cost = o.cost ? o.cost(G, ctx) : {}; } catch (e) { cost = null; }
      if (cost == null) {
        return { key: o.key, label: o.label, costText: o.costText, ok: false, why: why || '条件不足' };
      }
      return { key: o.key, label: o.label, costText: o.costText, ok: true, why: null };
    });
  },

  /** 玩家选择：扣代价 → 立刻效果 → 记延迟后果 → 出队 */
  choose(G, optionKey) {
    const cur = EventSys.current(G);
    if (!cur) throw new Error('此刻并无待决之事');
    const { item, ev, ctx } = cur;
    const opt = ev.options.find(o => o.key === optionKey);
    if (!opt) throw new Error('无此选项');

    const avail = EventSys.options(G).find(o => o.key === optionKey);
    if (!avail || !avail.ok) throw new Error(avail ? avail.why : '此选项不可用');

    const cost = opt.cost ? (opt.cost(G, ctx) || {}) : {};
    if (cost.gold && ctx.city) {
      if (ctx.city.gold < cost.gold) throw new Error(`钱不足（需 ${cost.gold}）`);
      ctx.city.gold -= cost.gold;
    }
    if (cost.food && ctx.city) {
      if (ctx.city.food < cost.food) throw new Error(`粮不足（需 ${cost.food}）`);
      ctx.city.food -= cost.food;
    }

    const res = (opt.apply ? opt.apply(G, ctx) : {}) || {};
    for (const line of (res.logs || [])) State.log(G, 'note', line);

    if (opt.delay && opt.delay.turns > 0) {
      G.events.pending.push({
        due: G.meta.turn + opt.delay.turns,
        eventId: ev.id, optionKey: opt.key,
        cityId: item.cityId || null,
        turns: opt.delay.turns,
      });
      if (G.events.pending.length > EventSys.MAX_PENDING) {
        // 超上限：最早的一条立刻兑现，绝不静默丢弃
        G.events.pending.sort((a, b) => a.due - b.due);
        const first = G.events.pending.shift();
        EventSys._applyPending(G, first);
      }
    }

    G.events.history = (G.events.history || []);
    G.events.history.push({
      turn: G.meta.turn, eventId: ev.id, optionKey: opt.key,
      cityId: item.cityId || null, name: ev.name, label: opt.label,
    });
    if (G.events.history.length > 60) G.events.history.shift();

    G.events.queue.shift();
    if (ev.chain) EventSys.chain(G, ev.id);
    return { eventId: ev.id, optionKey: opt.key };
  },

  /** 到期后果：必写一条纪事（哪怕只是数值变化，也不许暗改） */
  flushPending(G) {
    const list = G.events.pending || [];
    if (!list.length) return;
    const due = list.filter(p => p.due <= G.meta.turn).sort((a, b) => a.due - b.due);
    G.events.pending = list.filter(p => p.due > G.meta.turn);
    for (const p of due) EventSys._applyPending(G, p);
  },

  _applyPending(G, p) {
    const ev = EVENTS[p.eventId];
    const opt = ev && ev.options.find(o => o.key === p.optionKey);
    const delay = opt && opt.delay;
    if (!delay) return;
    const ctx = EventSys.context(G, p.cityId);
    try { if (delay.fx) delay.fx(G, ctx); } catch (e) { /* 城没了之类，忽略效果但照记日志 */ }
    const text = typeof delay.log === 'function' ? delay.log(G, ctx) : delay.log;
    if (text) State.log(G, 'note', text);
  },

  /**
   * 玩家一直不选（直接结束回合）：替他拍板 —— 优先 fallback 选项，其次第一个可选的。
   * 放在回合推进之前调用，避免卡片跨月挂着。
   */
  autoResolve(G) {
    let guard = 0;
    while ((G.events.queue || []).length && guard++ < 8) {
      const opts = EventSys.options(G);
      const pick = opts.find(o => o.ok && (EVENTS[EventSys.current(G).ev.id].options
        .find(x => x.key === o.key) || {}).fallback)
        || opts.find(o => o.ok);
      if (!pick) { G.events.queue.shift(); break; }   // 一个都选不了：跳过这条
      try { EventSys.choose(G, pick.key); } catch (e) { G.events.queue.shift(); }
    }
  },

  /** 连锁：某事件结算后把下一条塞进优先池（当前只用于蝗灾 → 流民） */
  chain(G, eventId) {
    const ev = EVENTS[eventId];
    if (!ev || !ev.chain) return;
    const next = ev.chain;
    if (!EVENTS[next]) return;
    if ((G.events.queue || []).length >= EventSys.MAX_QUEUE) return;
    if (G.events.seen[next] != null) return;
    const cityId = State.demesne(G)[0] ? State.demesne(G)[0].id : null;
    G.events.queue.push({ eventId: next, cityId, turn: G.meta.turn });
  },
};
