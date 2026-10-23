// 士族系统：满意度漂移、经济/军事影响、安抚与叛乱
const Clans = {

  /** 每月漂移 + 叛乱判定 */
  drift(G, stamp) {
    for (const c of Object.values(G.cities)) {
      if (!c.clans || !c.clans.length) continue;

      const base = clanBaseline(c, null);
      const war = this._warPressure(G, c);      // 战乱压力
      if (c.unrest > 0) c.unrest -= 1;
      const turmoil = c.unrest > 0 ? 16 : 0;    // 新附之民，人心未附
      const satTarget = U.clamp(base - war - turmoil, 0, 100);

      for (const cl of c.clans) {
        // 满意度向目标漂移，影响力随满意度缓慢变化
        const speed = 0.9;
        cl.sat += (satTarget - cl.sat) * 0.16 * speed;
        cl.sat = U.clamp(cl.sat, 0, 100);

        if (cl.sat > 70) cl.inf = U.clamp(cl.inf + 0.35, 0, 100);
        else if (cl.sat < 35) cl.inf = U.clamp(cl.inf - 0.20, 0, 100);

        if (cl.mood) cl.mood *= 0.85;
      }

      // 治安被士族情绪牵动
      const sat = State.clanSat(c);
      if (sat < 35) c.order = U.clamp(c.order - 0.8, 0, 100);
      else if (sat > 70) c.order = U.clamp(c.order + 0.4, 0, 100);

      // 叛乱
      const avgInf = c.clans.reduce((s, x) => s + x.inf, 0) / c.clans.length;
      if (sat < 32 && avgInf > 34 && RNG.chance(0.10 + (32 - sat) / 150)) {
        this._revolt(G, c, stamp);
      }
    }
  },

  /** 战乱压力：邻敌 + 兵额过重 */
  _warPressure(G, c) {
    let p = 0;
    const hostile = State.neighbors(G, c.id, 235).filter(n => n.owner !== c.owner).length;
    p += Math.min(3, hostile) * 1.8;
    const cap = State.troopCapOf(G, c);
    const load = troopTotal(c.garrison) / Math.max(1, cap);
    if (load > 0.92) p += Math.min(10, (load - 0.92) * 30);
    if (c.food < 50) p += 8;
    return Math.min(22, p);
  },

  _revolt(G, c, stamp) {
    const lossPct = RNG.range(0.12, 0.28);
    let lost = 0;
    for (const k of TROOP_KEYS) {
      const l = Math.round((c.garrison[k] || 0) * lossPct);
      c.garrison[k] -= l;
      lost += l;
    }
    c.order = U.clamp(c.order - 12, 0, 100);
    c.gold = Math.round(c.gold * 0.7);
    c.mat = Math.round(c.mat * 0.7);

    // 主谋士族被清洗
    const chief = c.clans.slice().sort((a, b) => b.inf - a.inf)[0];
    if (chief) {
      chief.inf = Math.max(5, chief.inf - 35);
      chief.sat = U.clamp(chief.sat + 12, 0, 100);
    }

    if (c.owner === G.player.factionId) {
      State.log(G, 'bad',
        `${c.name}士族作乱！${chief ? chief.name : '大族'}纠众攻府，折兵 ${U.num(lost)}，府库被掠。`);
    }
  },

  /** 玩家操作：安抚 */
  pacify(G, c) {
    const cost = { gold: 200, food: 120 };
    if (c.gold < cost.gold) throw new Error(`钱不足（需 ${cost.gold}）`);
    if (c.food < cost.food) throw new Error(`粮不足（需 ${cost.food}）`);
    c.gold -= cost.gold;
    c.food -= cost.food;
    for (const cl of c.clans) {
      cl.sat = U.clamp(cl.sat + 13, 0, 100);
      cl.mood = Math.max(cl.mood, 1);
    }
    c.order = U.clamp(c.order + 3, 0, 100);
    State.log(G, 'good', `${c.name}设宴安抚士族，人心稍定。`);
  },

  /** 玩家操作：征辟（士族通道，走统一成功率，不再 500 钱必成功） */
  recruit(G, c) {
    const cost = { gold: 500 };
    if (c.gold < cost.gold) throw new Error(`钱不足（需 ${cost.gold}）`);

    c.gold -= cost.gold;
    const r = Relations.recruitFree(G, c);   // 成功率与「三顾」同档；失败仍得士族好感

    for (const cl of c.clans) {
      cl.sat = U.clamp(cl.sat + (r.ok ? 7 : 3), 0, 100);
      cl.inf = U.clamp(cl.inf + (r.ok ? 3 : 1), 0, 100);
    }

    if (r.ok) {
      // 能力高者可直接任守将
      const cur = c.governor ? G.heroes[c.governor] : null;
      if (!cur || r.hero.tong > cur.tong) c.governor = r.hero.id;
      return r.hero.name;
    }
    return null;
  },

  /** 玩家操作：打压 */
  suppress(G, c) {
    for (const cl of c.clans) {
      cl.inf = Math.max(3, cl.inf - 18);
      cl.sat = U.clamp(cl.sat - 14, 0, 100);
      cl.mood = Math.min(cl.mood, -1);
    }
    c.order = U.clamp(c.order - 4, 0, 100);
    // 短期税收增加
    c.gold += Math.round(c.gold * 0.12);

    State.log(G, 'note', `${c.name}抑压豪强，抄没其财，然人心离怨。`);
    if (c.clans.length && State.clanSat(c) < 20 && RNG.chance(0.25)) {
      this._revolt(G, c, '');
    }
  },
};
