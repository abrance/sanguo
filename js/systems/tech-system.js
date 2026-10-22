// 科技系统：科研点累积 → 逐项研究（可排队）→ 势力乘数表
const TechSys = {

  MAX_QUEUE: 3,

  /** 重算势力乘数（存在 faction.bonus 上，供战斗/经济直接读取） */
  refresh(G) {
    for (const f of Object.values(G.factions)) {
      if (!f.tech) f.tech = { rp: 0, done: {}, current: null, queue: [] };
      if (!Array.isArray(f.tech.queue)) f.tech.queue = [];
      f.bonus = techMultipliers(f.tech.done);
    }
  },

  /** 单个城的科研产出（每月） */
  cityRate(G, c) {
    const ac = State.bld(c, 'academy');
    if (ac <= 0) return 1.5;
    const gov = c.governor ? G.heroes[c.governor] : null;
    return ac * 6 + (gov ? ac * (gov.zheng / 100) : 0);
  },

  /** 势力月度科研产出 */
  rate(G, fid) {
    let rp = 0;
    for (const c of State.factionCities(G, fid)) rp += this.cityRate(G, c);
    return rp;
  },

  /** 前置是否满足 */
  available(f, key) {
    const t = TECHS[key];
    if (!t) return false;
    if (f.tech.done[key]) return false;
    if (f.tech.current && f.tech.current.key === key) return false;
    if (f.tech.queue && f.tech.queue.indexOf(key) >= 0) return false;
    for (const r of t.req) if (!f.tech.done[r]) return false;
    return true;
  },

  busy(f) {
    return !!(f.tech.current && f.tech.current.key);
  },

  /** 开研：空闲则立即开，否则入队 */
  start(G, fid, key) {
    const f = G.factions[fid];
    if (!f) throw new Error('势力不存在');
    if (G.over) throw new Error('战局已终');
    if (!TechSys.available(f, key)) throw new Error('该项不可研（前置未成或已在研）');

    const entry = { key, left: TECHS[key].cost, total: TECHS[key].cost };

    if (!TechSys.busy(f)) {
      f.tech.current = entry;
      if (fid === G.player.factionId) {
        State.log(G, 'note', `开研《${TECHS[key].name}》，需 ${TECHS[key].cost} 科研点。`);
      }
      return { queued: false };
    }

    if (f.tech.queue.length >= TechSys.MAX_QUEUE) {
      throw new Error(`研习队列已满（最多 ${TechSys.MAX_QUEUE} 项）`);
    }
    f.tech.queue.push(entry);
    if (fid === G.player.factionId) {
      State.log(G, 'note', `《${TECHS[key].name}》入研习队列（第 ${f.tech.queue.length} 位）。`);
    }
    return { queued: true, position: f.tech.queue.length };
  },

  cancelQueued(G, fid, key) {
    const f = G.factions[fid];
    if (!f || !f.tech.queue) throw new Error('势力不存在');
    const i = f.tech.queue.findIndex(e => e.key === key);
    if (i < 0) throw new Error('队列中无此项');
    f.tech.queue.splice(i, 1);
  },

  /** 预计还需几个月 */
  eta(G, fid, entry) {
    if (!entry) return null;
    const rate = this.rate(G, fid);
    if (rate <= 0) return null;
    return Math.max(1, Math.ceil((entry.left || 0) / rate));
  },

  /** 每月：学宫产点 → 推进当前项目 → 完成则接队列 */
  advance(G, stamp) {
    for (const f of Object.values(G.factions)) {
      if (f.kind === 'free' || f.dead) continue;
      const cities = State.factionCities(G, f.id);
      if (!cities.length) continue;

      f.tech.rp = Math.min(99999, f.tech.rp + this.rate(G, f.id));

      if (!TechSys.busy(f)) {
        if (f.id !== G.player.factionId) TechSys._autoPick(G, f);
        else if (f.tech.queue.length) f.tech.current = f.tech.queue.shift();
      }

      const cur = f.tech.current;
      if (cur && cur.key) {
        const take = Math.min(f.tech.rp, cur.left);
        f.tech.rp -= take;
        cur.left -= take;
        if (cur.left <= 0.001) {
          f.tech.done[cur.key] = true;
          f.tech.current = null;
          if (f.id === G.player.factionId) {
            State.log(G, 'good', `【科技】《${TECHS[cur.key].name}》研成。`);
          }
          // 队列接续
          if (f.tech.queue.length) {
            f.tech.current = f.tech.queue.shift();
          }
        }
      }
    }
    TechSys.refresh(G);
  },

  _autoPick(G, f) {
    const cands = TECH_KEYS.filter(k => TechSys.available(f, k));
    if (!cands.length) return;
    const prefer = f.aggression > 0.45
      ? ['mil', 'ind', 'agr', 'com']
      : ['agr', 'com', 'ind', 'mil'];
    cands.sort((a, b) => {
      const pa = prefer.findIndex(p => TECHS[a].id.startsWith(p.slice(0, 3)));
      const pb = prefer.findIndex(p => TECHS[b].id.startsWith(p.slice(0, 3)));
      if (pa !== pb) return pa - pb;
      return TECHS[a].cost - TECHS[b].cost;
    });
    const pick = cands[0];
    f.tech.current = { key: pick, left: TECHS[pick].cost, total: TECHS[pick].cost };
  },

  doneList(f) {
    return Object.keys(f.tech.done || {}).filter(k => TECHS[k]);
  },
};
