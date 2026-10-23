// 朝堂（docs/EVENTS.md §9）：谁控制帝都，谁就能以天子之名行事
//
// 状态在 G.court：
//   emperorCityId  天子所在城（洛阳 ↔ 长安，null = 帝已失所）
//   controller     当前控制帝都的势力 id（null = 无主）
//   edictTurn      上次矫诏回合（冷却 6 月）
//   summons        已征辟名士次数（每局上限 3）
const Court = {

  EDICT_CD: 6,
  MAX_SUMMONS: 3,

  /** 每回合刷新：帝都易主 → 换 controller；城里没了 → 帝失所 */
  refresh(G) {
    const court = G.court;
    if (!court) return;
    const city = court.emperorCityId ? G.cities[court.emperorCityId] : null;
    if (!city) { court.controller = null; return; }

    const owner = city.owner && city.owner !== 'free' && !(G.factions[city.owner] || {}).dead
      ? city.owner : null;
    if (owner !== court.controller) {
      const before = court.controller;
      court.controller = owner;
      if (before === G.player.factionId || owner === G.player.factionId) {
        const name = owner ? (G.factions[owner] || {}).name : '无主';
        State.log(G, owner === G.player.factionId ? 'good' : 'bad',
          `帝都${city.name}易主，矫诏之权归于${name}。`);
        if (before === G.player.factionId && owner !== G.player.factionId) {
          G.player.reputation = Math.max(0, G.player.reputation - 20);   // 矫诏事发
          State.log(G, 'bad', '矫诏事发，天下哗然（名望 −20）。');
        }
      }
    }
  },

  /** 你有没有矫诏权（界面与命令共用） */
  access(G) {
    const court = G.court || {};
    const city = court.emperorCityId ? G.cities[court.emperorCityId] : null;
    const mine = !!city && court.controller === G.player.factionId;
    return {
      city, mine,
      emperorAt: city ? city.name : '失所',
      controllerName: court.controller ? ((G.factions[court.controller] || {}).name || null) : null,
      cooldown: court.edictTurn ? Math.max(0, Court.EDICT_CD - (G.meta.turn - court.edictTurn)) : 0,
      summons: court.summons || 0,
    };
  },

  _mustControl(G) {
    const acc = Court.access(G);
    if (!acc.mine) {
      throw new Error(acc.controllerName ? `帝在${acc.controllerName}手，不得矫诏` : '帝已失所，无人可矫诏');
    }
    return acc;
  },

  /** 矫诏号令：令两家互攻（关系压到开战线以下，下回合 AI 就会动手） */
  edict(G, aFid, bFid) {
    const acc = Court._mustControl(G);
    if (acc.cooldown > 0) throw new Error(`诏书初下，尚需 ${acc.cooldown} 月再发`);
    if (!aFid || !bFid || aFid === bFid) throw new Error('须指定两家不同势力');
    for (const fid of [aFid, bFid]) {
      const f = G.factions[fid];
      if (!f || f.dead) throw new Error('无此势力');
      if (fid === G.player.factionId) throw new Error('不可诏令自己');
    }
    const p = Diplo.pair(G, aFid, bFid);
    p.status = Diplo.WAR;
    p.until = 0;
    p.rel = Math.min(p.rel, -60);
    G.court.edictTurn = G.meta.turn;
    G.player.reputation = Math.max(0, G.player.reputation - 10);
    for (const fid of [aFid, bFid]) {
      Diplo.pair(G, G.player.factionId, fid).rel -= 8;
    }
    const an = (G.factions[aFid] || {}).name || aFid;
    const bn = (G.factions[bFid] || {}).name || bFid;
    State.log(G, 'note', `矫诏下：${an}与${bn}奉诏相攻（名望 −10）。`);
    return { aFid, bFid };
  },

  /** 任命：敌将忠诚跌、己将受赏 */
  appoint(G, heroId) {
    const acc = Court._mustControl(G);
    if (acc.cooldown > 0) throw new Error(`诏书初下，尚需 ${acc.cooldown} 月再发`);
    const h = G.heroes[heroId];
    if (!h || !h.alive) throw new Error('无此武将');
    G.court.edictTurn = G.meta.turn;
    if (h.factionId === G.player.factionId) {
      h.bond = U.clamp((h.bond || 0) + 10, 0, 100);
      G.player.merit += 15;
      State.log(G, 'good', `以诏书授${h.name}名号，战功 +15。`);
      return { own: true, heroId };
    }
    h.loyalty = U.clamp((h.loyalty || 50) - 8, 0, 100);
    h.ambition = U.clamp((h.ambition || 40) + 10, 0, 100);
    State.log(G, 'note', `诏书授${h.name}虚衔，位卑权重，其心不平。`);
    return { own: false, heroId };
  },

  /** 征辟名士：免费得一名在野将到帝都 */
  summon(G) {
    const acc = Court._mustControl(G);
    if (acc.summons >= Court.MAX_SUMMONS) throw new Error('征辟之诏已用尽');
    const free = Object.values(G.heroes)
      .filter(h => h.alive && h.factionId === 'free')
      .sort((a, b) => (b.zhi + b.tong) - (a.zhi + a.tong));
    if (!free.length) throw new Error('在野已无名士');
    const h = free[0];
    h.factionId = G.player.factionId;
    h.cityId = G.court.emperorCityId;
    h.loyalty = 50;
    h.bond = Math.max(h.bond || 0, 25);
    G.court.summons = acc.summons + 1;
    State.log(G, 'good', `征辟${h.name}至${acc.emperorAt}（统 ${h.tong} / 智 ${h.zhi}）。`);
    return { heroId: h.id };
  },
};
