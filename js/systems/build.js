// 建造系统：队列推进、费用、工期
const Build = {

  costOf(G, c, key) {
    const f = G.factions[c.owner];
    const mul = f && f.bonus ? f.bonus.buildCost : 1;
    return buildCost(key, State.bld(c, key), mul);
  },

  turnsOf(G, key, curLevel, city) {
    const season = SEASON[U.season(G.meta.month)];
    const tal = city && city.grantedTo === PLAYER_HERO_ID ? talentOf(G) : {};
    return buildTurns(key, curLevel, season.build * (tal.buildFactor || 1));
  },

  /** 前置检查（不含资源） */
  reqCheck(G, c, key) {
    const d = BUILDINGS[key];
    if (!d) return { ok: false, why: '无此建筑' };
    if (State.bld(c, key) >= d.max) return { ok: false, why: '已达上限' };
    if (d.req) {
      const r = d.req(c, G);
      if (!r.ok) return { ok: false, why: r.why };
    }
    return { ok: true };
  },

  queueFree(c) {
    return c.buildQueue.length < State.buildSlots(c);
  },

  canBuild(G, c, key) {
    if (G.over) return { ok: false, why: '战局已终' };
    if (!Build.queueFree(c)) return { ok: false, why: '工程已满（府衙 3 级可并行）' };
    if ((c.buildQueue || []).some(j => j.key === key)) return { ok: false, why: '已在工程队列中' };
    const rq = Build.reqCheck(G, c, key);
    if (!rq.ok) return rq;
    const cost = Build.costOf(G, c, key);
    if (c.gold < cost.gold) return { ok: false, why: `钱不足（需 ${cost.gold}）` };
    if (c.mat < cost.mat) return { ok: false, why: `建材不足（需 ${cost.mat}）` };
    if (c.iron < cost.iron) return { ok: false, why: `铁不足（需 ${cost.iron}）` };
    return { ok: true, cost };
  },

  /** 立即开工（扣除资源） */
  start(G, c, key, silent) {
    const chk = Build.canBuild(G, c, key);
    if (!chk.ok) throw new Error(chk.why);
    const cost = chk.cost;
    c.gold -= cost.gold;
    c.mat -= cost.mat;
    c.iron -= cost.iron;
    const turns = Build.turnsOf(G, key, State.bld(c, key), c);
    c.buildQueue.push({
      key,
      to: State.bld(c, key) + 1,
      left: turns,
      total: turns,
    });
    if (!silent && c.grantedTo === PLAYER_HERO_ID) {
      State.log(G, 'good',
        `${c.name}开工${BUILDINGS[key].name}（至 ${State.bld(c, key) + 1} 级），工期 ${turns} 月。`);
    }
    return turns;
  },

  /** 每月推进 */
  advance(G, stamp) {
    for (const c of Object.values(G.cities)) {
      if (!c.buildQueue || !c.buildQueue.length) continue;
      const done = [];
      for (const job of c.buildQueue) {
        job.left--;
        if (job.left <= 0) done.push(job);
      }
      if (!done.length) continue;

      c.buildQueue = c.buildQueue.filter(j => !done.includes(j));
      for (const job of done) {
        c.buildings[job.key] = job.to;
        State.syncDerived(c);
        if (c.grantedTo === PLAYER_HERO_ID) {
          State.log(G, 'good', `${c.name}${BUILDINGS[job.key].name}建成，${job.to} 级。`);
        } else if (c.owner === G.player.factionId) {
          State.log(G, 'note', `${c.name}${BUILDINGS[job.key].name}建成，${job.to} 级。`);
        }
      }
    }
  },

  /** 给 AI / 太守用：按优先级找一个能开工的项目（缺料时先补基础设施） */
  autoPick(G, c, order) {
    const urgent = [];
    if (c.mat < 90 && State.bld(c, 'lumber') < 4) urgent.push('lumber');
    if (c.mat < 90 && State.bld(c, 'quarry') < 3) urgent.push('quarry');
    if (c.iron < 50 && State.bld(c, 'ironworks') < 3) urgent.push('ironworks');

    for (const key of urgent.concat(order)) {
      const chk = Build.canBuild(G, c, key);
      if (chk.ok) return key;
    }
    return null;
  },
};
