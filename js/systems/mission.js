// 上级任务系统：派发、上缴、超期、抗命
const Mission = {

  /** 每回合推进 */
  tick(G) {
    const p = G.player;
    if (G.over) return;

    // 自立后不再受上命
    if (p.route === 'independent') {
      if (p.mission) {
        p.mission = null;
        p.missionCooldown = 0;
      }
      return;
    }

    if (p.mission) {
      if (this._checkDiplo(G)) return;
      if (G.meta.turn > p.mission.expireTurn) this._fail(G);
      return;
    }

    if (p.missionCooldown > 0) { p.missionCooldown--; return; }
    if (G.meta.turn < 4) return;
    this.issue(G);
  },

  issue(G) {
    const p = G.player;
    if (p.mission) return;

    let key = pickMissionType();
    let m = MISSION_TYPES[key].make(G);
    if (!m) {
      m = MISSION_TYPES.tribute.make(G);
      key = 'tribute';
    }
    m.id = 'm' + G.meta.turn + '_' + Math.floor(RNG.next() * 1000);
    m.typeKey = key;
    m.title = MISSION_TYPES[key].title;
    m.issueTurn = G.meta.turn;
    m.done = false;
    p.mission = m;

    const superior = G.factions[G.player.factionId];
    State.log(G, 'note',
      `【上命】${superior ? superior.name : '上级'}传令：${this.text(m, G)}，限 ${m.expireTurn - G.meta.turn} 月。`);
  },

  text(m, G) {
    const t = MISSION_TYPES[m.typeKey];
    return t ? t.desc(m, G) : m.title;
  },

  /** 距离超期还剩几月 */
  left(m, G) {
    return Math.max(0, m.expireTurn - G.meta.turn);
  },

  /** 出使 / 离间：看关系值是否达标，达标即复命 */
  _checkDiplo(G) {
    const p = G.player;
    const m = p.mission;
    if (!m) return false;
    if (m.typeKey === 'envoy') {
      if (Diplo.relationOf(G, p.factionId, m.targetFid) >= m.targetRel) {
        this._complete(G, '使者复命');
        return true;
      }
    } else if (m.typeKey === 'intrigue') {
      if (Diplo.relationOf(G, m.aFid, m.bFid) <= m.targetRel) {
        this._complete(G, '流言得售');
        return true;
      }
    }
    return false;
  },

  /** 玩家主动上缴（tribute / levy） */
  fulfil(G) {
    const p = G.player;
    const m = p.mission;
    if (!m) throw new Error('当前无上命');
    if (m.typeKey === 'expedition') throw new Error('此命需攻取目标城池，不能以财物了事');
    if (m.typeKey === 'envoy' || m.typeKey === 'intrigue') {
      throw new Error('此命需以结果复命，不能以财物了事');
    }

    if (m.typeKey === 'tribute') {
      this._deductRes(G, m.res, m.amount);
    } else {
      this._deductTroops(G, m.amount);
    }
    this._complete(G, '如约上缴');
    return m;
  },

  decline(G) {
    const p = G.player;
    const m = p.mission;
    if (!m) throw new Error('当前无上命');

    p.favor = U.clamp(p.favor - 25, 0, 100);
    p.merit = Math.max(0, p.merit - 12);
    p.mission = null;
    p.missionCooldown = 3;
    State.log(G, 'bad',
      `抗命不遵（${this.text(m, G)}）：上级震怒，好感 -25，战功 -12。`);
  },

  _complete(G, how) {
    const p = G.player;
    const m = p.mission;
    if (!m) return;

    p.merit += m.rewardMerit;
    p.favor = U.clamp(p.favor + m.rewardFavor, 0, 100);
    p.reputation += 8;
    p.mission = null;
    p.missionCooldown = 3;

    State.log(G, 'good',
      `【上命完成】${this.text(m, G)}（${how}）：战功 +${m.rewardMerit}，上级好感 +${m.rewardFavor}。`);

    Rank.checkPromotion(G, '上命');
  },

  _fail(G) {
    const p = G.player;
    const m = p.mission;
    if (!m) return;

    p.favor = U.clamp(p.favor - 15, 0, 100);
    p.merit = Math.max(0, p.merit - 8);
    p.mission = null;
    p.missionCooldown = 4;

    State.log(G, 'bad',
      `【上命逾期】${this.text(m, G)}未办：好感 -15，战功 -8。`);
  },

  /** 攻占城池时挂钩：若正是征讨目标则完成 */
  onCapture(G, cityId) {
    const p = G.player;
    const m = p.mission;
    if (!m || m.typeKey !== 'expedition') return false;
    if (m.targetCityId !== cityId) return false;
    this._complete(G, '克城复命');
    return true;
  },

  // ── 资源扣缴 ──
  _deductRes(G, res, amount) {
    const cities = State.demesne(G);
    const label = res === 'gold' ? '钱' : '粮';
    let have = 0;
    for (const c of cities) have += c[res] || 0;
    if (have < amount) {
      throw new Error(`${label}不足（需 ${U.num(amount)}，现有 ${U.num(Math.round(have))}）`);
    }
    let left = amount;
    for (const c of cities) {
      const take = Math.min(c[res], Math.round(amount * (c[res] / have)));
      c[res] -= take;
      left -= take;
    }
    // 取整残差
    for (const c of cities) {
      if (left <= 0) break;
      const take = Math.min(c[res], left);
      c[res] -= take;
      left -= take;
    }
    if (left > 0) throw new Error(`${label}不足`);
  },

  _deductTroops(G, amount) {
    const cities = State.demesne(G);
    let have = 0;
    for (const c of cities) have += troopTotal(c.garrison);
    if (have < amount) {
      throw new Error(`兵力不足（需 ${U.num(amount)}，现有 ${U.num(have)}）`);
    }

    const ratio = amount / have;
    let sent = 0;
    for (const c of cities) {
      for (const k of TROOP_KEYS) {
        const take = Math.floor((c.garrison[k] || 0) * ratio);
        c.garrison[k] -= take;
        sent += take;
      }
    }
    // 残差补齐（保留少量守军，避免抽空）
    let left = amount - sent;
    for (const c of cities) {
      if (left <= 0) break;
      for (const k of TROOP_KEYS) {
        if (left <= 0) break;
        const room = Math.max(0, (c.garrison[k] || 0) - 0);
        const take = Math.min(room, left);
        c.garrison[k] -= take;
        left -= take;
      }
    }
  },
};
