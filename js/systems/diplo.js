// 外交系统：关系值 / 状态机 / 唯一开战闸门 / AI 议和宣战结盟 / 玩家行动支撑
// 稀疏存储：G.diplo["<fidA>|<fidB>"] = { rel, status, until, since, border, treaty, grudge, lastPeace }
const Diplo = {

  WAR: 'war', NEUTRAL: 'neutral', TRUCE: 'truce', ALLY: 'ally',

  COOLDOWN: 3,          // 同一目标国 3 回合冷却
  MAX_ALLIES: 2,
  TRUCE_MONTHS: 12,
  PACT_MONTHS: 12,
  BORDER_DIST: 235,     // 与 State.neighbors 同口径

  // ───────── 基础 ─────────
  key(a, b) { return a < b ? a + '|' + b : b + '|' + a; },

  ensure(G) {
    if (!G.diplo) G.diplo = {};
    const p = G.player;
    if (!p.diploCooldown) p.diploCooldown = {};
    if (!Array.isArray(p.pacts)) p.pacts = [];
    if (p.usurp == null) p.usurp = 0;
    return G;
  },

  /** 开局：全员中立，唯董卓为天下所仇 */
  init(G) {
    Diplo.ensure(G);
    const fids = Object.keys(G.factions).filter(id => id !== 'free');
    for (let i = 0; i < fids.length; i++) {
      for (let j = i + 1; j < fids.length; j++) {
        const x = Diplo.pair(G, fids[i], fids[j]);
        if (fids[i] === 'dongzhuo' || fids[j] === 'dongzhuo') x.rel = -45;
      }
    }
    Diplo.borders(G);
  },

  pair(G, a, b) {
    if (!a || !b || a === b) return null;
    Diplo.ensure(G);
    const k = Diplo.key(a, b);
    let x = G.diplo[k];
    if (!x) {
      x = G.diplo[k] = {
        rel: 0, status: Diplo.NEUTRAL, until: 0, since: G.meta.turn,
        border: -1, treaty: null, grudge: false, lastPeace: -99,
      };
    }
    return x;
  },

  statusOf(G, a, b) {
    const x = Diplo.pair(G, a, b);
    if (!x) return Diplo.NEUTRAL;
    if (x.status === Diplo.TRUCE && G.meta.turn > x.until) return Diplo.NEUTRAL;
    return x.status;
  },

  relationOf(G, a, b) {
    const x = Diplo.pair(G, a, b);
    return x ? x.rel : 0;
  },

  /** 唯一闸门：行军落地、AI 出兵、上命征讨都只认它 */
  canAttack(G, a, b) {
    if (!a || !b || a === b) return false;
    if (b === 'free') return true;
    return Diplo.statusOf(G, a, b) === Diplo.WAR;
  },

  warCount(G, fid) {
    let n = 0;
    for (const other of Object.keys(G.factions)) {
      if (other === fid || other === 'free') continue;
      if (Diplo.statusOf(G, fid, other) === Diplo.WAR) n++;
    }
    return n;
  },

  allies(G, fid) {
    const out = [];
    for (const other of Object.keys(G.factions)) {
      if (other === fid || other === 'free') continue;
      if (Diplo.statusOf(G, fid, other) === Diplo.ALLY) out.push(other);
    }
    return out;
  },

  hasPact(G, fid) {
    const t = G.meta.turn;
    return (G.player.pacts || []).some(p => p.fid === fid && t <= p.until);
  },

  strength(G, fid) {
    return State.factionTroops(G, fid) + State.factionCities(G, fid).length * 200;
  },

  commonEnemy(G, a, b) {
    for (const other of Object.keys(G.factions)) {
      if (other === 'free' || other === a || other === b) continue;
      if (Diplo.statusOf(G, a, other) === Diplo.WAR && Diplo.statusOf(G, b, other) === Diplo.WAR) return true;
    }
    return false;
  },

  // ───────── 边界（每 6 回合重算） ─────────
  borders(G) {
    const fids = Object.keys(G.factions).filter(id => id !== 'free');
    for (let i = 0; i < fids.length; i++) {
      for (let j = i + 1; j < fids.length; j++) {
        const x = Diplo.pair(G, fids[i], fids[j]);
        if (x) x.border = Diplo.borderCount(G, fids[i], fids[j]);
      }
    }
  },

  borderCount(G, a, b) {
    const A = State.factionCities(G, a);
    const B = State.factionCities(G, b);
    let n = 0;
    for (const ca of A) {
      for (const cb of B) {
        if (U.dist(ca.x, ca.y, cb.x, cb.y) <= Diplo.BORDER_DIST) { n++; break; }
      }
      if (n >= 3) break;
    }
    return n;
  },

  // ───────── 状态转移 ─────────
  /** 天下侧目：fid 与所有其他国家的关系一并下滑 */
  _repute(G, fid, delta) {
    for (const other of Object.keys(G.factions)) {
      if (other === 'free' || other === fid) continue;
      const y = Diplo.pair(G, fid, other);
      if (y) y.rel = U.clamp(y.rel + delta, -100, 100);
    }
  },

  declareWar(G, a, b, opts) {
    const backstab = !!(opts && opts.backstab);
    const x = Diplo.pair(G, a, b);
    if (!x || x.status === Diplo.WAR) return x;
    x.status = Diplo.WAR;
    x.since = G.meta.turn;
    x.until = 0;
    x.treaty = null;
    x.rel = U.clamp(x.rel - (backstab ? 40 : 30), -100, 100);
    if (backstab) x.grudge = true;
    Diplo._repute(G, a, backstab ? -12 : -4);
    return x;
  },

  makePeace(G, a, b) {
    const x = Diplo.pair(G, a, b);
    if (!x) return null;
    x.status = Diplo.TRUCE;
    x.until = G.meta.turn + Diplo.TRUCE_MONTHS;
    x.since = G.meta.turn;
    x.lastPeace = G.meta.turn;
    x.rel = U.clamp(x.rel + 10, -100, 100);
    return x;
  },

  formAlliance(G, a, b) {
    const x = Diplo.pair(G, a, b);
    if (!x) return { ok: false, why: '无此国' };
    const st = Diplo.statusOf(G, a, b);
    if (st === Diplo.ALLY) return { ok: false, why: '已结同盟' };
    if (st === Diplo.WAR) return { ok: false, why: '正在交战' };
    if (x.grudge) return { ok: false, why: '旧怨未消（曾被背刺）' };
    if (x.rel < 40) return { ok: false, why: `关系不足（需 40，现 ${Math.round(x.rel)}）` };
    if (Diplo.allies(G, a).length >= Diplo.MAX_ALLIES) return { ok: false, why: '我方盟友已满 2 家' };
    if (Diplo.allies(G, b).length >= Diplo.MAX_ALLIES) return { ok: false, why: '对方盟友已满 2 家' };
    x.status = Diplo.ALLY;
    x.since = G.meta.turn;
    x.until = 0;
    x.treaty = { since: G.meta.turn };
    return { ok: true };
  },

  breakAlliance(G, a, b) {
    const x = Diplo.pair(G, a, b);
    if (!x || Diplo.statusOf(G, a, b) !== Diplo.ALLY) return { ok: false, why: '并无同盟可解' };
    x.status = Diplo.NEUTRAL;
    x.since = G.meta.turn;
    x.treaty = null;
    x.rel = U.clamp(x.rel - 20, -100, 100);
    Diplo._repute(G, a, -6);
    return { ok: true };
  },

  /** 对方是否接受求和 */
  willAcceptPeace(G, defender, attacker) {
    return Diplo.relationOf(G, defender, attacker) > -70 || Diplo.warCount(G, defender) >= 2;
  },

  /** 君主是否采纳玩家的上表 */
  respond(G, fid, action) {
    const p = G.player;
    const myFaction = G.factions[p.factionId];
    const myStr = Diplo.strength(G, p.factionId);
    const theirStr = Diplo.strength(G, fid);

    let score = (p.favor == null ? 60 : p.favor) / 100;
    if (action === 'war') score += theirStr < myStr * 0.8 ? 0.25 : -0.10;
    if (action === 'peace') {
      score += (myStr < theirStr || Diplo.warCount(G, p.factionId) >= 2) ? 0.30 : 0;
    }
    if (action === 'ally') score += Diplo.commonEnemy(G, p.factionId, fid) ? 0.30 : 0;
    if (myFaction) score += (myFaction.aggression - 0.5) * (action === 'war' ? 0.3 : -0.1);

    return RNG.chance(U.clamp(0.15 + score, 0.05, 0.95));
  },

  /** 执行一项势力外交动作（上表被采纳 / 代君行令共用） */
  apply(G, action, fid) {
    const pf = G.player.factionId;
    const target = G.factions[fid];
    if (!target) return { ok: false, why: '无此势力' };

    if (action === 'war') {
      if (Diplo.statusOf(G, pf, fid) === Diplo.WAR) return { ok: false, why: '已在交战' };
      Diplo.declareWar(G, pf, fid);
      State.log(G, 'bad', `${G.factions[pf].name}向${target.name}宣战。`);
      return { ok: true };
    }

    if (action === 'peace') {
      if (Diplo.statusOf(G, pf, fid) !== Diplo.WAR) return { ok: false, why: '并未交战' };
      Diplo.makePeace(G, pf, fid);
      State.log(G, 'good', `与${target.name}罢兵，停战 12 月。`);
      return { ok: true };
    }

    if (action === 'ally') {
      const r = Diplo.formAlliance(G, pf, fid);
      if (!r.ok) return r;
      State.log(G, 'good', `与${target.name}结为同盟。`);
      return { ok: true };
    }

    if (action === 'intrigue') {
      const other = Diplo.strongestRival(G, fid);
      if (!other) return { ok: false, why: '其无可挑拨之邻' };
      const x = Diplo.pair(G, fid, other);
      x.rel = U.clamp(x.rel - 20, -100, 100);
      State.log(G, 'note', `密使离间${target.name}与${G.factions[other].name}，两国遂生嫌隙。`);
      return { ok: true };
    }

    return { ok: false, why: '无此提案' };
  },

  strongestRival(G, fid) {
    let best = null;
    for (const other of Object.keys(G.factions)) {
      if (other === 'free' || other === fid || G.factions[other].dead) continue;
      if (other === G.player.factionId) continue;
      const x = Diplo.pair(G, fid, other);
      if (!x || x.border <= 0) continue;
      const s = Diplo.strength(G, other);
      if (!best || s > best.s) best = { id: other, s };
    }
    return best ? best.id : null;
  },

  // ───────── 每月推进 ─────────
  advance(G) {
    Diplo.ensure(G);
    Diplo.expire(G);
    if (G.meta.turn % 6 === 0) Diplo.borders(G);
    Diplo.drift(G);
    Diplo.ai(G);
  },

  expire(G) {
    for (const x of Object.values(G.diplo)) {
      if (x.status === Diplo.TRUCE && G.meta.turn > x.until) {
        x.status = Diplo.NEUTRAL;
        x.since = G.meta.turn;
      }
    }
    const t = G.meta.turn;
    const pacts = G.player.pacts || [];
    const live = pacts.filter(p => p.until >= t);
    if (live.length !== pacts.length) {
      G.player.pacts = live;
      State.log(G, 'note', '密约期满，对方不再受旧约约束。');
    }
  },

  drift(G) {
    const fids = Object.keys(G.factions).filter(id => id !== 'free');
    for (let i = 0; i < fids.length; i++) {
      for (let j = i + 1; j < fids.length; j++) {
        const a = fids[i], b = fids[j];
        const x = Diplo.pair(G, a, b);
        if (!x) continue;
        const st = Diplo.statusOf(G, a, b);

        let d = 0;
        if (st === Diplo.WAR) d -= 3;
        else if (st === Diplo.TRUCE) d += 2;
        else if (st === Diplo.ALLY) d += 4;
        if (Diplo.commonEnemy(G, a, b)) d += 6;
        d -= 5 * Math.min(x.border, 3);

        // 强弱悬殊：弱者更愿意示好
        const sa = Diplo.strength(G, a), sb = Diplo.strength(G, b);
        if (sa > sb * 1.5 || sb > sa * 1.5) d += 2;

        x.rel = U.clamp(x.rel + U.clamp(d, -10, 10), -100, 100);
      }
    }
  },

  threat(G, fid) {
    let max = 0;
    const myStr = Diplo.strength(G, fid);
    for (const other of Object.keys(G.factions)) {
      if (other === 'free' || other === fid) continue;
      const x = Diplo.pair(G, fid, other);
      if (!x || x.border <= 0) continue;
      const s = Diplo.strength(G, other) * (Diplo.statusOf(G, fid, other) === Diplo.WAR ? 2 : 1);
      if (s > max) max = s;
    }
    return Math.max(max, myStr * 0.4);
  },

  // ───────── AI 外交 ─────────
  _phase(fid) {
    let h = 0;
    for (let i = 0; i < fid.length; i++) h = (h * 31 + fid.charCodeAt(i)) % 997;
    return h % 3;
  },

  ai(G) {
    for (const f of Object.values(G.factions)) {
      if (f.kind === 'free' || f.dead) continue;
      if (Diplo._phase(f.id) !== G.meta.turn % 3) continue;
      if (!State.factionCities(G, f.id).length) continue;

      const wars = [];
      for (const other of Object.keys(G.factions)) {
        if (other === 'free' || other === f.id) continue;
        if (Diplo.statusOf(G, f.id, other) === Diplo.WAR) wars.push(other);
      }

      // 1 多线作战或打不过 → 向最强的敌国求和
      if (wars.length) {
        const enemies = wars.map(id => ({ id, s: Diplo.strength(G, id) })).sort((a, b) => b.s - a.s);
        const worst = enemies[0];
        const losing = wars.length >= 2 || Diplo.strength(G, f.id) < worst.s * 0.85;
        if (losing && Diplo.willAcceptPeace(G, worst.id, f.id)) {
          const pay = Math.min(f.treasury, 400);
          f.treasury -= pay;
          Diplo.makePeace(G, f.id, worst.id);
          Diplo._log(G, f, worst.id,
            `【停战】${f.name}遣使向${G.factions[worst.id].name}求和，纳钱 ${U.num(pay)}，罢兵 12 月。`);
          continue;
        }
      }

      // 2 强邻逼境 → 找人结盟（上限 2）
      if (Diplo.threat(G, f.id) > Diplo.strength(G, f.id) * 1.5
          && Diplo.allies(G, f.id).length < Diplo.MAX_ALLIES) {
        const cands = Object.keys(G.factions)
          .filter(id => id !== 'free' && id !== f.id && !G.factions[id].dead)
          .filter(id => {
            const st = Diplo.statusOf(G, f.id, id);
            if (st === Diplo.ALLY || st === Diplo.WAR) return false;
            const x = Diplo.pair(G, f.id, id);
            return x && !x.grudge && x.rel >= 25;
          })
          .sort((a, b) => Diplo.relationOf(G, f.id, b) - Diplo.relationOf(G, f.id, a));

        if (cands.length && RNG.chance(0.5)) {
          const r = Diplo.formAlliance(G, f.id, cands[0]);
          if (r.ok) {
            Diplo._log(G, f, cands[0],
              `【结盟】${f.name}与${G.factions[cands[0]].name}结为同盟，共御外侮。`);
          }
        }
      }

      // 3 睦邻不攻；有可乘之机才兴兵问罪
      if (RNG.chance(f.aggression * 0.5)) {
        const myStr = Diplo.strength(G, f.id);
        const targets = Object.keys(G.factions)
          .filter(id => id !== 'free' && id !== f.id && !G.factions[id].dead)
          .filter(id => {
            const x = Diplo.pair(G, f.id, id);
            return x && x.border > 0 && x.rel < -40
              && Diplo.statusOf(G, f.id, id) === Diplo.NEUTRAL
              && myStr > Diplo.strength(G, id) * 1.8;
          })
          .sort((a, b) => Diplo.strength(G, a) - Diplo.strength(G, b));

        if (targets.length) {
          const t = targets[0];
          f.treasury = Math.max(0, f.treasury - 500);
          Diplo.declareWar(G, f.id, t);
          Diplo._log(G, f, t, `【宣战】${f.name}以${G.factions[t].name}屡犯边境为辞，兴兵问罪。`);
          continue;
        }
      }

      // 4 盟友有难 → 出兵相援（mission: aid）
      Diplo._aidAlly(G, f);
    }
  },

  _aidAlly(G, f) {
    if (Object.values(G.armies).some(a => a.factionId === f.id && a.mission === 'aid')) return;
    const mine = Diplo.allies(G, f.id).filter(id => !G.factions[id].dead);
    for (const allyId of mine) {
      if (Diplo.warCount(G, allyId) === 0) continue;
      if (!RNG.chance(0.5)) continue;

      let best = null;
      for (const c of State.factionCities(G, allyId)) {
        const d = Combat.defenseScore(G, c);
        if (!best || d < best.d) best = { c, d };
      }
      if (!best) continue;

      const sent = Diplo.sendAid(G, f.id, best.c.id, 0.30);
      if (sent) {
        Diplo._log(G, f, allyId,
          `【援军】${f.name}遣兵 ${U.num(sent)} 驰援${G.factions[allyId].name}之${best.c.name}。`);
      }
      return;
    }
  },

  _log(G, f, otherFid, text) {
    if (f.id !== G.player.factionId && otherFid !== G.player.factionId) return;
    State.log(G, 'note', text);
  },

  /** 从 fromFid 最强城抽 ratio 兵，走 aid 军赴 toCityId（抵达并入守军） */
  sendAid(G, fromFid, toCityId, ratio) {
    const target = G.cities[toCityId];
    if (!target) return 0;
    const src = State.factionCities(G, fromFid)
      .map(c => ({ c, t: troopTotal(c.garrison) }))
      .sort((a, b) => b.t - a.t)[0];
    if (!src || src.t < 200) return 0;

    const troops = Army.takeFromGarrison(src.c.garrison, U.clamp(ratio == null ? 0.3 : ratio, 0.1, 0.5));
    const total = troopTotal(troops);
    if (total < 100) {
      for (const k of TROOP_KEYS) src.c.garrison[k] += troops[k] || 0;
      return 0;
    }
    Army.create(G, {
      factionId: fromFid, heroId: null, from: src.c.id, to: toCityId, troops, mission: 'aid',
    });
    return total;
  },

  // ───────── 玩家侧支撑 ─────────
  layer(G) {
    const p = G.player;
    if (p.route === 'independent' || p.rank >= 6) return 'direct';
    if (p.rank >= 4) return 'petition';
    return 'personal';
  },

  cooldownLeft(G, fid) {
    const t = (G.player.diploCooldown || {})[fid];
    if (t == null) return 0;
    return Math.max(0, Diplo.COOLDOWN - (G.meta.turn - t));
  },

  touch(G, fid) { G.player.diploCooldown[fid] = G.meta.turn; },

  target(G, fid) {
    const f = G.factions[fid];
    if (!f) throw new Error('无此势力');
    if (f.kind === 'free') throw new Error('在野无主之地，无从外交');
    if (f.dead) throw new Error(`${f.name}已覆灭`);
    if (fid === G.player.factionId) throw new Error('不可与本势力外交');
    return f;
  },

  open(G, fid) {
    const f = Diplo.target(G, fid);
    const left = Diplo.cooldownLeft(G, fid);
    if (left > 0) throw new Error(`与${f.name}的使者刚回，尚需 ${left} 月方可再遣`);
    return f;
  },

  spendGold(G, amount) {
    const cities = State.demesne(G);
    let have = 0;
    for (const c of cities) have += c.gold;
    if (have < amount) {
      throw new Error(`私库钱不足（需 ${U.num(amount)}，现有 ${U.num(Math.round(have))}）`);
    }
    let left = amount;
    for (const c of cities) {
      const take = Math.min(c.gold, Math.round(amount * (c.gold / have)));
      c.gold -= take;
      left -= take;
    }
    for (const c of cities) {
      if (left <= 0) break;
      const take = Math.min(c.gold, left);
      c.gold -= take;
      left -= take;
    }
    if (left > 0) throw new Error('私库钱不足');
  },

  /** 代君行令：直接以国家名义行事 */
  playerDirect(G, action, fid) {
    if (Diplo.layer(G) !== 'direct') throw new Error(`官未至三公，只能上表言事`);
    const f = Diplo.target(G, fid);
    const left = Diplo.cooldownLeft(G, fid);
    if (left > 0) throw new Error(`与${f.name}的使者刚回，尚需 ${left} 月`);

    const COST = { war: 500, peace: 300, ally: 1000, call: 500, break: 0 };
    const cost = COST[action] || 0;
    if (cost) Diplo.spendGold(G, cost);

    let res;
    if (action === 'break') res = Diplo.breakAlliance(G, G.player.factionId, fid);
    else if (action === 'call') res = Diplo.callToArms(G, fid);
    else res = Diplo.apply(G, action, fid);
    if (!res.ok) throw new Error(res.why);

    Diplo.touch(G, fid);
    if (G.player.route !== 'independent') {
      G.player.favor = U.clamp(G.player.favor - 5, 0, 100);
      G.player.usurp = (G.player.usurp || 0) + 1;
      if (G.player.usurp >= 5) {
        G.player.usurp = 0;
        G.player.favor = U.clamp(G.player.favor - 25, 0, 100);
        State.log(G, 'bad', '【猜忌】权柄屡用，君主疑你有异志。（好感 -25）');
      }
    }
    return res;
  },

  /** 请盟出兵：盟友派兵赴我方最危急的直辖城 */
  callToArms(G, allyFid) {
    if (Diplo.statusOf(G, G.player.factionId, allyFid) !== Diplo.ALLY) {
      return { ok: false, why: '并非同盟' };
    }
    let best = null;
    for (const c of State.demesne(G)) {
      const d = Combat.defenseScore(G, c);
      if (!best || d < best.d) best = { c, d };
    }
    if (!best) return { ok: false, why: '你无可守之城' };

    const sent = Diplo.sendAid(G, allyFid, best.c.id, 0.40);
    if (!sent) return { ok: false, why: '盟友兵力空虚，无兵可派' };
    State.log(G, 'good', `${G.factions[allyFid].name}应盟约之请，遣兵 ${U.num(sent)} 赴${best.c.name}。`);
    return { ok: true, sent };
  },

  // ───────── 上命目标挑选 ─────────
  envoyTarget(G) {
    const pf = G.player.factionId;
    const cands = Object.keys(G.factions).filter(id => {
      if (id === 'free' || id === pf || G.factions[id].dead) return false;
      const x = Diplo.pair(G, pf, id);
      return x && Diplo.statusOf(G, pf, id) !== Diplo.WAR && x.rel < 40;
    });
    if (!cands.length) return null;
    cands.sort((a, b) => Diplo.relationOf(G, pf, b) - Diplo.relationOf(G, pf, a));
    return cands[0];
  },

  intrigueTarget(G) {
    const pf = G.player.factionId;
    const ids = Object.keys(G.factions).filter(id => id !== 'free' && id !== pf && !G.factions[id].dead);
    let best = null;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const x = Diplo.pair(G, ids[i], ids[j]);
        if (!x || x.border <= 0 || x.rel < -50) continue;
        if (!best || x.rel > best.rel) best = { a: ids[i], b: ids[j], rel: x.rel };
      }
    }
    return best;
  },
};
