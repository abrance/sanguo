// 事件池（docs/EVENTS.md §3 / §7）：加一条事件 = 加一个对象，不需要动逻辑
//
// 字段：
//   scope   'player'（玩家直辖城，权重 ×3）| 'faction'（本势力）| 'world'（全图）
//   weight  基础权重；cond 为假的直接丢弃
//   once    一局只触发一次；cooldown 同一条事件的间隔回合
//   text    { title, body(G, ctx), portrait, source }
//   options 见下：cost 返回 null 表示不可选，why 写不可选的原因（界面直接显示）
//           apply(G, ctx) 立刻生效，可返回 delay: { turns, log, fx(G, ctx) }
//
// 历史锚点额外字段（docs/EVENTS.md §8）：
//   slot       同一段史事的所有视角变体共用一个 slot，一局只出一条
//   forFaction 只有这些势力看得到（该视角专属）｜ notFor 这些势力看不到（通用视角）

/** 锚点里「与某势力永久交战」：目标若就是本势力，静默跳过 —— 视角写漏时不崩 */
function eventWarOn(G, fid) {
  if (!fid || fid === G.player.factionId) return false;
  const pr = Diplo.pair(G, G.player.factionId, fid);
  if (!pr) return false;
  pr.status = Diplo.WAR; pr.rel = -80; pr.until = 0;
  return true;
}

const EVENTS = {

  locust: {
    id: 'locust', name: '蝗灾', scope: 'player', weight: 10, once: false, cooldown: 24, chain: 'refugee',
    cond: (G, ctx) => !!ctx.city && State.bld(ctx.city, 'farm') >= 3
      && [4, 5, 6, 7, 8, 9].indexOf(G.meta.month) >= 0,
    text: {
      title: '蝗虫蔽日',
      body: (G, ctx) => `${ctx.city.name}飞蝗蔽日，禾稼尽啮。县中老幼聚于衙前，只等一句话。`,
      portrait: 'locust', source: '县丞急报',
    },
    options: [
      {
        key: 'relief', label: '开仓赈济', costText: '粮 −800 · 治安 +6',
        cost: (G, ctx) => (ctx.city.food >= 800 ? { food: 800 } : null),
        why: '存粮不足 800',
        apply: (G, ctx) => {
          ctx.city.order = U.clamp(ctx.city.order + 6, 0, 100);
          return { logs: [`${ctx.city.name}开仓赈济，饥民得食，人心稍安。`] };
        },
        // 静态延迟：只存 {due,eventId,optionKey,cityId}，到期回查这里的 fx/log
        delay: {
          turns: 3,
          log: (G, ctx) => `${ctx.city ? ctx.city.name : '本城'}赈粮告罄，县中又报缺粮。`,
          fx: (G, ctx) => { if (ctx.city) ctx.city.order = U.clamp(ctx.city.order - 4, 0, 100); },
        },
      },
      {
        key: 'tax', label: '加征赋税', costText: '钱 +400 · 治安 −8',
        cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.gold += 400;
          ctx.city.order = U.clamp(ctx.city.order - 8, 0, 100);
          return { logs: [`${ctx.city.name}加征赋税，府库稍充，然民怨渐生。`] };
        },
      },
      {
        key: 'ignore', label: '置之不理', costText: '治安 −5 · 三月后粮产受损',
        fallback: true,
        cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.order = U.clamp(ctx.city.order - 5, 0, 100);
          return { logs: [`${ctx.city.name}蝗灾无人过问，饿殍载道。`] };
        },
        delay: {
          turns: 3,
          log: (G, ctx) => `${ctx.city ? ctx.city.name : '本城'}蝗后秋粮大减。`,
          fx: (G, ctx) => {
            if (!ctx.city) return;
            ctx.city.food = Math.max(0, ctx.city.food - 600);
            ctx.city.order = U.clamp(ctx.city.order - 3, 0, 100);
          },
        },
      },
    ],
  },

  refugee: {
    id: 'refugee', name: '流民来投', scope: 'player', weight: 9, once: false, cooldown: 18,
    cond: (G, ctx) => !!ctx.city && ctx.city.pop < State.popMaxOf(G, ctx.city) * 0.9,
    text: {
      title: '流民来投',
      body: (G, ctx) => `邻郡战乱，数千流民扶老携幼至${ctx.city.name}城下，求一口活路。`,
      portrait: 'refugee', source: '城门尉',
    },
    options: [
      {
        key: 'take', label: '收留安置', costText: '丁口 +15% · 治安 −6 · 兵 +200',
        cost: () => ({ food: 200 }),
        why: '存粮不足 200',
        apply: (G, ctx) => {
          const c = ctx.city;
          c.pop = Math.min(State.popMaxOf(G, c), Math.round(c.pop * 1.15));
          c.order = U.clamp(c.order - 6, 0, 100);
          c.garrison.inf += 200;
          return { logs: [`${c.name}收流民数千，编入户籍，丁口大增。`] };
        },
      },
      {
        key: 'drive', label: '驱之出境', costText: '名望 −5',
        cost: () => ({}),
        apply: (G, ctx) => {
          G.player.reputation = Math.max(0, G.player.reputation - 5);
          return { logs: [`${ctx.city.name}闭门驱流民，四方传其不仁。`] };
        },
      },
      {
        key: 'conscript', label: '尽数充军', costText: '兵 +400 · 治安 −10',
        fallback: true,
        cost: () => ({}),
        apply: (G, ctx) => {
          const c = ctx.city;
          const add = Math.min(400, Math.round(c.pop * 0.6));
          c.pop = Math.max(20, c.pop - Math.round(add * 0.8));
          c.garrison.inf += add;
          c.order = U.clamp(c.order - 10, 0, 100);
          return { logs: [`${c.name}尽驱流民充军，得兵 ${U.num(add)}，然人心惶惶。`] };
        },
      },
    ],
  },

  recommend: {
    id: 'recommend', name: '举荐', scope: 'player', weight: 8, once: false, cooldown: 20,
    cond: (G, ctx) => !!ctx.city && State.bld(ctx.city, 'academy') >= 1
      && Object.values(G.heroes).some(h => h.alive && h.factionId === 'free'),
    text: {
      title: '乡党举荐',
      body: (G, ctx) => `${ctx.city.name}学宫祭酒上书，言乡里有贤才，愿荐于麾下。`,
      portrait: 'scholar', source: '学宫祭酒',
    },
    options: [
      {
        key: 'hire', label: '礼聘之', costText: '钱 −300 · 得在野一将',
        cost: () => ({ gold: 300 }),
        why: '府库不足 300',
        apply: (G, ctx) => {
          const free = Object.values(G.heroes)
            .filter(h => h.alive && h.factionId === 'free')
            .sort((a, b) => (b.tong + b.zhi) - (a.tong + a.zhi));
          if (!free.length) return { logs: ['祭酒荐书至，然贤才已被他人延揽。'] };
          const h = free[0];
          h.factionId = G.player.factionId;
          h.cityId = ctx.city.id;
          h.loyalty = 45;
          h.bond = Math.max(h.bond || 0, 20);
          return { logs: [`${ctx.city.name}礼聘${h.name}（统 ${h.tong} / 智 ${h.zhi}），士林称善。`] };
        },
      },
      {
        key: 'decline', label: '婉言谢之', costText: '上级好感 +2',
        fallback: true,
        cost: () => ({}),
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) + 2, 0, 100);
          return { logs: ['你婉谢举荐，乡党以为谦。'] };
        },
      },
      {
        key: 'bribe', label: '索其润笔', costText: '钱 +500 · 好感 −10 · 名望 −4',
        cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.gold += 500;
          G.player.favor = U.clamp((G.player.favor || 60) - 10, 0, 100);
          G.player.reputation = Math.max(0, G.player.reputation - 4);
          return { logs: ['你向举荐之人索贿，钱入私库，士林侧目。'] };
        },
      },
    ],
  },

  // ───────── 天灾（B2 补齐） ─────────
  plague: {
    id: 'plague', name: '大疫', scope: 'player', weight: 8, once: false, cooldown: 30,
    cond: (G, ctx) => !!ctx.city && ctx.city.pop > 120 && State.bld(ctx.city, 'clinic') < 2,
    text: {
      title: '疫气流行',
      body: (G, ctx) => `${ctx.city.name}疫气流行，十室九病，军民皆恐。`,
      portrait: 'plague', source: '医曹',
    },
    options: [
      {
        key: 'doctor', label: '设局施药', costText: '钱 −500 · 兵 −3% · 医馆 +1 级（一次）',
        cost: () => ({ gold: 500 }), why: '府库不足 500',
        apply: (G, ctx) => {
          const c = ctx.city;
          const lose = Math.round(troopTotal(c.garrison) * 0.03);
          for (const k of TROOP_KEYS) if (lose && c.garrison[k]) c.garrison[k] = Math.max(0, c.garrison[k] - Math.round(c.garrison[k] * 0.03));
          c.buildings.clinic = Math.min(6, (c.buildings.clinic || 0) + 1);
          return { logs: [`${c.name}设局施药，疫气渐止（折兵 ${U.num(lose)}）。`] };
        },
      },
      {
        key: 'close', label: '闭城断路', costText: '治安 −4 · 疫不外传',
        cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.order = U.clamp(ctx.city.order - 4, 0, 100);
          return { logs: [`${ctx.city.name}闭城断路，疫气不出，商旅断绝。`] };
        },
      },
      {
        key: 'force', label: '强征病卒', costText: '兵 −10% · 治安 −10 · 钱 +200',
        fallback: true, cost: () => ({}),
        apply: (G, ctx) => {
          const c = ctx.city;
          for (const k of TROOP_KEYS) if (c.garrison[k]) c.garrison[k] = Math.round(c.garrison[k] * 0.9);
          c.order = U.clamp(c.order - 10, 0, 100);
          c.gold += 200;
          return { logs: [`${ctx.city.name}强征病卒，死者相枕，得钱 200。`] };
        },
      },
    ],
  },

  flood: {
    id: 'flood', name: '河决', scope: 'player', weight: 7, once: false, cooldown: 30,
    cond: (G, ctx) => !!ctx.city && State.isRiverCity(G, ctx.city),
    text: {
      title: '河决堤溃',
      body: (G, ctx) => `${ctx.city.name}临河，秋汛暴涨，堤岸溃决，田庐尽没。`,
      portrait: 'flood', source: '河堤使',
    },
    options: [
      {
        key: 'repair', label: '征工修堤', costText: '建材 −300 · 丁口 −3%',
        cost: () => ({ mat: 300 }), why: '建材不足 300',
        apply: (G, ctx) => {
          const c = ctx.city;
          c.pop = Math.max(20, Math.round(c.pop * 0.97));
          c.order = U.clamp(c.order + 3, 0, 100);
          return { logs: [`${c.name}征工修堤，水势渐退。`] };
        },
      },
      {
        key: 'move', label: '迁民高地', costText: '丁口 −15% · 治安 +3',
        fallback: true, cost: () => ({}),
        apply: (G, ctx) => {
          const c = ctx.city;
          c.pop = Math.max(20, Math.round(c.pop * 0.85));
          c.order = U.clamp(c.order + 3, 0, 100);
          return { logs: [`${c.name}迁民高地，田庐尽弃。`] };
        },
      },
      {
        key: 'ignore', label: '弃之', costText: '丁口 −25% · 名望 −8',
        cost: () => ({}),
        apply: (G, ctx) => {
          const c = ctx.city;
          c.pop = Math.max(20, Math.round(c.pop * 0.75));
          G.player.reputation = Math.max(0, G.player.reputation - 8);
          return { logs: [`${c.name}河决无人过问，漂流者众。`] };
        },
      },
    ],
  },

  omen: {
    id: 'omen', name: '日食', scope: 'player', weight: 3, once: false, cooldown: 40,
    cond: () => true,
    text: {
      title: '日中有蚀',
      body: (G, ctx) => `白昼日食，天色如暮。${ctx.city ? ctx.city.name : ''}城中鼓噪，皆言天谴。`,
      portrait: 'comet', source: '太史',
    },
    options: [
      {
        key: 'claim', label: '宣示天命', costText: '名望 +10 · 士族之心 −5',
        cost: () => ({}),
        apply: (G, ctx) => {
          G.player.reputation += 10;
          if (ctx.city) for (const cl of ctx.city.clans) cl.sat = U.clamp(cl.sat - 5, 0, 100);
          return { logs: ['你借日食宣示天命，士族侧目。'] };
        },
      },
      {
        key: 'hide', label: '禁言掩饰', costText: '治安 −2',
        cost: () => ({}),
        apply: (G, ctx) => {
          if (ctx.city) ctx.city.order = U.clamp(ctx.city.order - 2, 0, 100);
          return { logs: ['你禁言掩饰，然流言更盛。'] };
        },
      },
      {
        key: 'report', label: '上奏朝廷', costText: '好感 +6 · 钱 −200',
        fallback: true,
        cost: () => ({ gold: 200 }), why: '府库不足 200',
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) + 6, 0, 100);
          return { logs: ['你上奏日食之变，朝廷以为忠。'] };
        },
      },
    ],
  },

  // ───────── 人事（B2 补齐） ─────────
  accuse: {
    id: 'accuse', name: '告发', scope: 'player', weight: 7, once: false, cooldown: 20,
    cond: (G, ctx) => !!ctx.city && ctx.city.governor && ctx.city.governor !== PLAYER_HERO_ID
      && ((G.player.favor || 60) < 55 || G.player.route === 'dominant'),
    text: {
      title: '密书告发',
      body: (G, ctx) => `有密书至，告${ctx.city.name}守将私通外敌、隐匿军资。`,
      portrait: 'accuser', source: '门下书佐',
    },
    options: [
      {
        key: 'investigate', label: '查办', costText: '守将忠诚 −10 · 好感 +8 · 战功 +10',
        cost: () => ({}),
        apply: (G, ctx) => {
          const h = G.heroes[ctx.city.governor];
          if (h) h.loyalty = U.clamp((h.loyalty || 50) - 10, 0, 100);
          G.player.favor = U.clamp((G.player.favor || 60) + 8, 0, 100);
          G.player.merit += 10;
          return { logs: ['查办告发，守将惶惧，上级以为能。'] };
        },
      },
      {
        key: 'shelve', label: '压案不问', costText: '钱 −300',
        fallback: true,
        cost: () => ({ gold: 300 }), why: '府库不足 300',
        apply: () => ({ logs: ['压案不问，事遂寝。'] }),
      },
      {
        key: 'counter', label: '反坐告者', costText: '名望 −10 · 好感 −15',
        cost: () => ({}),
        apply: (G) => {
          G.player.reputation = Math.max(0, G.player.reputation - 10);
          G.player.favor = U.clamp((G.player.favor || 60) - 15, 0, 100);
          return { logs: ['你反坐告者，人皆侧目。'] };
        },
      },
    ],
  },

  marriage: {
    id: 'marriage', name: '士族联姻', scope: 'player', weight: 6, once: false, cooldown: 24,
    cond: (G, ctx) => !!ctx.city && State.clanSat(ctx.city) > 70,
    text: {
      title: '请结姻亲',
      body: (G, ctx) => `${ctx.city.name}大族遣媒，愿以女适君家，结两姓之好。`,
      portrait: 'bride', source: '大族家老',
    },
    options: [
      {
        key: 'accept', label: '允婚', costText: '钱 −600 · 该族之心 +20',
        cost: () => ({ gold: 600 }), why: '府库不足 600',
        apply: (G, ctx) => {
          const cl = ctx.city.clans[0];
          if (cl) { cl.sat = U.clamp(cl.sat + 20, 0, 100); cl.inf = U.clamp(cl.inf + 10, 0, 100); }
          return { logs: [`${ctx.city.name}与${cl ? cl.name : '大族'}联姻，阖城称贺。`] };
        },
      },
      {
        key: 'refuse', label: '谢绝', costText: '该族之心 −10',
        fallback: true, cost: () => ({}),
        apply: (G, ctx) => {
          const cl = ctx.city.clans[0];
          if (cl) cl.sat = U.clamp(cl.sat - 10, 0, 100);
          return { logs: ['你谢绝联姻，大族不悦。'] };
        },
      },
    ],
  },

  // ───────── 军事（B2 补齐） ─────────
  defect_city: {
    id: 'defect_city', name: '献城归降', scope: 'player', weight: 8, once: false, cooldown: 12,
    cond: (G, ctx) => !!ctx.city && State.neighbors(G, ctx.city.id, 235).some(n =>
      n.owner !== G.player.factionId && n.owner !== 'free'
      && State.neighbors(G, n.id, 400).some(x => x.grantedTo === PLAYER_HERO_ID)),
    text: {
      title: '守将献城',
      body: (G, ctx) => `邻郡守将遣使密告，愿举城来归，只求保全性命。`,
      portrait: 'defector', source: '密使',
    },
    options: [
      {
        key: 'take', label: '纳降', costText: '得该城 · 治安 −15（两月）',
        cost: () => ({}),
        apply: (G, ctx) => {
          const hood = State.neighbors(G, ctx.city.id, 235)
            .filter(n => n.owner !== G.player.factionId && n.owner !== 'free')
            .sort((a, b) => a.pop - b.pop)[0];
          if (!hood) return { logs: ['献城之议忽止，使者不知所终。'] };
          hood.owner = G.player.factionId;
          hood.grantedTo = null;
          hood.order = U.clamp(hood.order - 15, 0, 100);
          return { logs: [`${hood.name}守将举城来归。`] };
        },
      },
      {
        key: 'refuse', label: '疑而不纳', costText: '名望 −3',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          G.player.reputation = Math.max(0, G.player.reputation - 3);
          return { logs: ['你疑其诈，却之。'] };
        },
      },
    ],
  },

  duel: {
    id: 'duel', name: '名将对阵', scope: 'player', weight: 10, once: false, cooldown: 10,
    cond: (G, ctx) => !!ctx.city && Object.values(G.armies).some(a =>
      a.to === ctx.city.id && a.mission === 'attack' && a.heroId
      && G.heroes[a.heroId] && G.heroes[a.heroId].wu >= 85),
    text: {
      title: '阵前搦战',
      body: (G, ctx) => `敌将单骑出阵，横矛指城，呼城中将士出斗。`,
      portrait: 'duel', source: '城头瞭望',
    },
    options: [
      {
        key: 'fight', label: '遣将应战', costText: '胜则敌士气 −25% · 名望 +8；败则我士气 −20%',
        cost: () => ({}),
        apply: (G, ctx) => {
          const foe = Object.values(G.armies).find(a => a.to === ctx.city.id && a.mission === 'attack' && a.heroId);
          const my = ctx.city.governor && G.heroes[ctx.city.governor];
          const win = my && foe && G.heroes[foe.heroId]
            ? (my.wu + RNG.between(0, 20)) >= (G.heroes[foe.heroId].wu + RNG.between(0, 20))
            : false;
          if (win) {
            if (foe) foe.morale = Math.max(20, (foe.morale || 60) - 15);
            ctx.city.morale = U.clamp((ctx.city.morale || 55) + 8, 0, 100);
            G.player.reputation += 8;
            return { logs: [`${my ? my.name : '守将'}出城应战，敌将败退，城头欢声雷动。`] };
          }
          ctx.city.morale = U.clamp((ctx.city.morale || 55) - 12, 0, 100);
          return { logs: ['我将不敌，退入城中，士气受挫。'] };
        },
      },
      {
        key: 'hold', label: '闭门不战', costText: '我士气 −6',
        fallback: true, cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.morale = U.clamp((ctx.city.morale || 55) - 6, 0, 100);
          return { logs: ['闭门不战，敌将骂阵终日而去。'] };
        },
      },
    ],
  },

  cut_grain: {
    id: 'cut_grain', name: '断粮', scope: 'player', weight: 7, once: false, cooldown: 16,
    cond: (G, ctx) => !!ctx.city && ctx.city.food < 1000
      && Object.values(G.armies).some(a => a.to === ctx.city.id && a.mission === 'attack'),
    text: {
      title: '粮道将断',
      body: (G, ctx) => `谍报：敌军欲袭我粮道，${ctx.city.name}城中存粮不足千石。`,
      portrait: 'nightraid', source: '斥候',
    },
    options: [
      {
        key: 'flood', label: '决水阻道', costText: '钱 −200 · 敌军行军 +2 月',
        cost: () => ({ gold: 200 }), why: '府库不足 200',
        apply: (G, ctx) => {
          for (const a of Object.values(G.armies)) {
            if (a.to !== ctx.city.id || a.mission !== 'attack') continue;
            a.eta += 2; a.totalEta += 2;
          }
          return { logs: ['决水漫道，敌军辎重迟滞。'] };
        },
      },
      {
        key: 'burn', label: '焚其积谷', costText: '名望 −6 · 敌兵 −15%',
        cost: () => ({}),
        apply: (G, ctx) => {
          for (const a of Object.values(G.armies)) {
            if (a.to !== ctx.city.id || a.mission !== 'attack') continue;
            for (const k of TROOP_KEYS) if (a.troops[k]) a.troops[k] = Math.round(a.troops[k] * 0.85);
          }
          G.player.reputation = Math.max(0, G.player.reputation - 6);
          return { logs: ['焚其积谷，敌兵减损，然四方讥我不仁。'] };
        },
      },
      {
        key: 'hold', label: '死守待援', costText: '我士气 +5',
        fallback: true, cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.morale = U.clamp((ctx.city.morale || 55) + 5, 0, 100);
          return { logs: ['城中死守，以待援军。'] };
        },
      },
    ],
  },

  steppe: {
    id: 'steppe', name: '边患', scope: 'player', weight: 6, once: false, cooldown: 20,
    cond: (G, ctx) => !!ctx.city && [8, 9, 10].indexOf(G.meta.month) >= 0
      && ctx.city.y < 600,
    text: {
      title: '胡骑犯边',
      body: (G, ctx) => `秋高马肥，胡骑数千掠${ctx.city.name}郊，驱人口畜产而去。`,
      portrait: 'steppe', source: '边亭燧卒',
    },
    options: [
      {
        key: 'peace', label: '和亲纳币', costText: '钱 −800 · 边城安 12 月',
        cost: () => ({ gold: 800 }), why: '府库不足 800',
        apply: (G, ctx) => {
          G.player.steppeTruce = { until: G.meta.turn + 12, cityId: ctx.city.id };
          return { logs: ['遣使和亲，胡骑北还。'] };
        },
      },
      {
        key: 'fight', label: '发兵讨之', costText: '兵 −8% · 铁料 +400 · 名望 +10',
        cost: () => ({}),
        apply: (G, ctx) => {
          const c = ctx.city;
          for (const k of TROOP_KEYS) if (c.garrison[k]) c.garrison[k] = Math.round(c.garrison[k] * 0.92);
          c.iron += 400;
          G.player.reputation += 10;
          return { logs: ['发兵讨胡，斩获马畜，铁料入库。'] };
        },
      },
      {
        key: 'ignore', label: '置之不理', costText: '治安 −8',
        fallback: true, cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.order = U.clamp(ctx.city.order - 8, 0, 100);
          return { logs: ['边患无人过问，边民离散。'] };
        },
      },
    ],
  },

  // ───────── 官渡剧本（200）专属锚点 ─────────
  anchor_baima: {
    id: 'anchor_baima', name: '白马之围', scope: 'world', weight: 1,
    once: true, anchor: [1, 3], scenario: 'guandu200',
    slot: 'baima', notFor: ['caocao', 'yuanshao'],
    text: {
      title: '白马被围',
      body: () => '袁绍遣颜良围白马，东郡太守刘延告急。曹操欲救，荀攸言：声东击西。',
      portrait: 'duel', source: '白马告急',
    },
    options: [
      {
        key: 'know', label: '观其成败', costText: '—',
        fallback: true, cost: () => ({}),
        apply: () => ({ logs: ['白马之围，天下侧目。'] }),
      },
      {
        key: 'join', label: '助曹解围', costText: '战功 +25 · 与袁绍交战',
        cost: () => ({}),
        apply: (G) => {
          G.player.merit += 25;
          eventWarOn(G, 'yuanshao');
          return { logs: ['你助曹操解白马之围，与袁绍结怨。'] };
        },
      },
    ],
  },

  // 白马 · 曹操军视角：被围的是自家
  anchor_baima_cz: {
    id: 'anchor_baima_cz', name: '白马告急', scope: 'world', weight: 1,
    once: true, anchor: [1, 3], scenario: 'guandu200',
    slot: 'baima', forFaction: ['caocao'],
    text: {
      title: '白马告急',
      body: () => '袁绍遣颜良围白马，东郡太守刘延告急。荀攸进言：今兵少不敌，可分兵声东击西，解围而斩其将。',
      portrait: 'duel', source: '白马告急',
    },
    options: [
      {
        key: 'rescue', label: '亲率轻骑救白马', costText: '粮 −400 · 战功 +25',
        cost: () => ({ food: 400 }), why: '存粮不足 400',
        apply: (G) => {
          eventWarOn(G, 'yuanshao');
          for (const c of State.factionCities(G, 'yuanshao')) c.morale = U.clamp((c.morale || 55) - 10, 0, 100);
          G.player.merit += 25;
          return { logs: ['你亲率轻骑解白马之围，颜良授首。'] };
        },
      },
      {
        key: 'feint', label: '声东击西，虚张延津', costText: '战功 +10 · 袁军士气 −15',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          eventWarOn(G, 'yuanshao');
          for (const c of State.factionCities(G, 'yuanshao')) c.morale = U.clamp((c.morale || 55) - 15, 0, 100);
          G.player.merit += 10;
          return { logs: ['你虚张延津之势，袁军分兵，白马之围自解。'] };
        },
      },
    ],
  },

  // 白马 · 袁绍军视角：围城的是自家
  anchor_baima_ys: {
    id: 'anchor_baima_ys', name: '白马之围', scope: 'world', weight: 1,
    once: true, anchor: [1, 3], scenario: 'guandu200',
    slot: 'baima', forFaction: ['yuanshao'],
    text: {
      title: '白马之围',
      body: () => '你遣颜良围白马，欲取东郡。沮授言：颜良性狭，虽骁勇，不可独任。军前催战书一日三至。',
      portrait: 'duel', source: '白马军报',
    },
    options: [
      {
        key: 'press', label: '催颜良急攻', costText: '战功 +20 · 与曹操永久交战',
        cost: () => ({}),
        apply: (G) => {
          eventWarOn(G, 'caocao');
          G.player.merit += 20;
          return { logs: ['你催颜良急攻白马，曹军东郡告急。'] };
        },
      },
      {
        key: 'reinforce', label: '增兵缓图', costText: '钱 −400 · 全军士气 +6',
        cost: () => ({ gold: 400 }), why: '府库不足 400',
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.morale = U.clamp((c.morale || 55) + 6, 0, 100);
          return { logs: ['你增兵白马，缓图东郡，军中称稳。'] };
        },
      },
      {
        key: 'withdraw', label: '收兵还河北', costText: '士气 −5',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.morale = U.clamp((c.morale || 55) - 5, 0, 100);
          return { logs: ['你收兵还河北，白马之围自解，军中颇有怨言。'] };
        },
      },
    ],
  },

  anchor_wuchao: {
    id: 'anchor_wuchao', name: '乌巢夜火', scope: 'world', weight: 1,
    once: true, anchor: [16, 30], scenario: 'guandu200',
    slot: 'wuchao', notFor: ['caocao', 'yuanshao'],
    text: {
      title: '乌巢夜火',
      body: () => '许攸来奔，告袁军粮在乌巢。曹操亲率五千骑，夜行冒袁军旗号。',
      portrait: 'nightraid', source: '许攸夜奔',
    },
    options: [
      {
        key: 'know', label: '知道了', costText: '—',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          const f = G.factions.yuanshao;
          if (f && !f.dead) {
            for (const c of State.factionCities(G, 'yuanshao')) c.morale = U.clamp((c.morale || 55) - 10, 0, 100);
          }
          return { logs: ['乌巢火起，袁军粮尽。'] };
        },
      },
      {
        key: 'help', label: '助曹焚粮', costText: '钱 −300 · 战功 +30',
        cost: () => ({ gold: 300 }), why: '府库不足 300',
        apply: (G) => {
          const f = G.factions.yuanshao;
          if (f && !f.dead) {
            for (const c of State.factionCities(G, 'yuanshao')) {
              c.morale = U.clamp((c.morale || 55) - 18, 0, 100);
              c.food = Math.max(0, c.food - 300);
            }
          }
          G.player.merit += 30;
          return { logs: ['你助曹焚乌巢之粮，袁军大乱。'] };
        },
      },
    ],
  },

  // 乌巢 · 曹操军视角：夜袭的是自家
  anchor_wuchao_cz: {
    id: 'anchor_wuchao_cz', name: '乌巢夜火', scope: 'world', weight: 1,
    once: true, anchor: [16, 30], scenario: 'guandu200',
    slot: 'wuchao', forFaction: ['caocao'],
    text: {
      title: '乌巢夜火',
      body: () => '许攸来奔，告袁军粮尽屯乌巢，守将淳于琼嗜酒不设备。众请遣将，你却想起当年在袁营的旧事。',
      portrait: 'nightraid', source: '许攸夜奔',
    },
    options: [
      {
        key: 'go', label: '亲率五千骑夜行', costText: '粮 −500 · 战功 +40',
        cost: () => ({ food: 500 }), why: '存粮不足 500',
        apply: (G) => {
          eventWarOn(G, 'yuanshao');
          for (const c of State.factionCities(G, 'yuanshao')) {
            c.morale = U.clamp((c.morale || 55) - 20, 0, 100);
            c.food = Math.max(0, c.food - 300);
          }
          G.player.merit += 40;
          return { logs: ['你亲率五千骑冒袁军旗号夜行，乌巢火起，袁军粮尽。'] };
        },
      },
      {
        key: 'send', label: '遣将往袭', costText: '战功 +20 · 袁军士气 −12',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          eventWarOn(G, 'yuanshao');
          for (const c of State.factionCities(G, 'yuanshao')) c.morale = U.clamp((c.morale || 55) - 12, 0, 100);
          G.player.merit += 20;
          return { logs: ['你遣将袭乌巢，火起粮焚，袁军大乱。'] };
        },
      },
      {
        key: 'suspect', label: '疑许攸诈降，按兵不动', costText: '名望 +3 · 坐失战机',
        cost: () => ({}),
        apply: (G) => {
          G.player.reputation += 3;
          return { logs: ['你疑许攸诈降，按兵不动，乌巢之粮得全。'] };
        },
      },
    ],
  },

  // 乌巢 · 袁绍军视角：被烧的是自家
  anchor_wuchao_ys: {
    id: 'anchor_wuchao_ys', name: '乌巢有警', scope: 'world', weight: 1,
    once: true, anchor: [16, 30], scenario: 'guandu200',
    slot: 'wuchao', forFaction: ['yuanshao'],
    text: {
      title: '乌巢有警',
      body: () => '许攸叛投曹操，尽泄我军虚实。乌巢粮屯守将淳于琼嗜酒。帐下请增守，你却更疑许攸所言。',
      portrait: 'nightraid', source: '乌巢军报',
    },
    options: [
      {
        key: 'guard', label: '增兵守乌巢', costText: '钱 −600 · 粮 −800 · 战功 +15',
        cost: () => ({ gold: 600, food: 800 }), why: '府库或存粮不足',
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.morale = U.clamp((c.morale || 55) + 8, 0, 100);
          G.player.merit += 15;
          return { logs: ['你增兵乌巢设伏，曹军夜袭扑空，粮屯无恙。'] };
        },
      },
      {
        key: 'replace', label: '易淳于琼而严军法', costText: '钱 −300 · 全军士气 +5',
        cost: () => ({ gold: 300 }), why: '府库不足 300',
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.morale = U.clamp((c.morale || 55) + 5, 0, 100);
          return { logs: ['你易乌巢守将，严申军法，粮屯稍安。'] };
        },
      },
      {
        key: 'ignore', label: '不以为意', costText: '全军士气 −15 · 粮 −200',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) {
            c.morale = U.clamp((c.morale || 55) - 15, 0, 100);
            c.food = Math.max(0, c.food - 200);
          }
          return { logs: ['你不以为意，乌巢火起，河北军粮尽。'] };
        },
      },
    ],
  },

  // ───────── 历史锚点（B4）：到窗口必触发，忽略权重 ─────────
  anchor_huimeng: {
    id: 'anchor_huimeng', name: '关东会盟', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [1, 2],
    slot: 'huimeng', notFor: ['dongzhuo'],
    text: {
      title: '关东会盟',
      body: () => '袁绍为盟主，关东诸侯会于酸枣，共讨董卓。檄文至，问你一句：行止如何？',
      portrait: 'edict', source: '会盟檄文',
    },
    options: [
      {
        key: 'join', label: '响应会盟', costText: '战功 +30 · 与董卓永久交战',
        cost: () => ({}),
        apply: (G) => {
          G.player.merit += 30;
          eventWarOn(G, 'dongzhuo');
          return { logs: ['你响应会盟，与董卓势不两立。'] };
        },
      },
      {
        key: 'watch', label: '持兵观望', costText: '好感 −10 · 名望 −5',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) - 10, 0, 100);
          G.player.reputation = Math.max(0, G.player.reputation - 5);
          return { logs: ['你按兵观望，诸侯颇有微词。'] };
        },
      },
      {
        key: 'abet', label: '暗通董卓', costText: '钱 +800 · 名望 −20',
        cost: () => ({}),
        apply: (G) => {
          const home = G.cities[G.player.homeCityId];
          if (home) home.gold += 800;
          G.player.reputation = Math.max(0, G.player.reputation - 20);
          return { logs: ['你暗通董卓，得钱 800，然天下不齿。'] };
        },
      },
    ],
  },

  // 会盟 · 董卓军视角：被讨伐的是自家
  anchor_huimeng_dz: {
    id: 'anchor_huimeng_dz', name: '关东兵起', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [1, 2],
    slot: 'huimeng', forFaction: ['dongzhuo'],
    text: {
      title: '关东兵起',
      body: () => '袁绍于酸枣会关东诸侯，推为盟主，槛文传至洛阳，斥丞相之罪。军府传令下来：各部点兵，听候调遣。',
      portrait: 'edict', source: '军府急令',
    },
    options: [
      {
        key: 'march', label: '奉令东出虎牢', costText: '粮 −600 · 战功 +30 · 与袁绍永久交战',
        cost: () => ({ food: 600 }), why: '存粮不足 600',
        apply: (G) => {
          eventWarOn(G, 'yuanshao');
          G.player.merit += 30;
          return { logs: ['你奉令东出虎牢，与关东兵接战。'] };
        },
      },
      {
        key: 'bribe', label: '遣使离间韩馥孔佃', costText: '钱 −600 · 二家关系 −25',
        cost: () => ({ gold: 600 }), why: '府库不足 600',
        apply: (G) => {
          const pr = Diplo.pair(G, 'hanfu', 'kongzhou');
          if (pr) pr.rel -= 25;
          return { logs: ['你重金买通二袁帐下，韩馥孔佃互相疑猜。'] };
        },
      },
      {
        key: 'hold', label: '勒兵守关', costText: '本势力全城治安 +8 · 名望 −5',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.order = U.clamp((c.order || 50) + 8, 0, 100);
          G.player.reputation = Math.max(0, G.player.reputation - 5);
          return { logs: ['你勒兵守关，关东兵不得西进，然坐失战机。'] };
        },
      },
    ],
  },

  anchor_relocate: {
    id: 'anchor_relocate', name: '迁都长安', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [4, 6],
    slot: 'relocate', notFor: ['dongzhuo'],
    text: {
      title: '董卓迁都',
      body: () => '董卓焚洛阳宫室，挟天子西迁长安。百官流离，中原无主。',
      portrait: 'capital', source: '洛阳火起',
    },
    options: [
      {
        key: 'follow', label: '随驾西行', costText: '好感 +10 · 钱 −200',
        cost: () => ({ gold: 200 }), why: '府库不足 200',
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) + 10, 0, 100);
          if (G.court) G.court.emperorCityId = 'changan';
          return { logs: ['你随驾西行，朝廷以为忠。'] };
        },
      },
      {
        key: 'stay', label: '留任东方', costText: '直辖上限 +1（本局）· 好感 −8',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) - 8, 0, 100);
          G.player.capBonus = (G.player.capBonus || 0) + 1;
          if (G.court) G.court.emperorCityId = 'changan';
          return { logs: ['你留任东方，自专一方。'] };
        },
      },
    ],
  },

  // 迁都 · 董卓军视角：焚城西迁是上命
  anchor_relocate_dz: {
    id: 'anchor_relocate_dz', name: '车驾西迁', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [4, 6],
    slot: 'relocate', forFaction: ['dongzhuo'],
    text: {
      title: '车驾西迁',
      body: () => '丞相决意焚洛阳宫室，挟天子西迁长安。军府点你部护送车驾，或留守焚城、收其府库。',
      portrait: 'capital', source: '军府钧旨',
    },
    options: [
      {
        key: 'escort', label: '护送车驾西行', costText: '好感 +12',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) + 12, 0, 100);
          if (G.court) G.court.emperorCityId = 'changan';
          return { logs: ['你护送车驾至长安，军府以为能。'] };
        },
      },
      {
        key: 'loot', label: '留镇洛阳，收其府库', costText: '钱 +1200 · 名望 −15',
        cost: () => ({}),
        apply: (G) => {
          const home = G.cities[G.player.homeCityId];
          if (home) home.gold += 1200;
          const ly = G.cities.luoyang;
          if (ly && ly.owner === G.player.factionId) ly.order = U.clamp((ly.order || 50) - 15, 0, 100);
          G.player.reputation = Math.max(0, G.player.reputation - 15);
          if (G.court) G.court.emperorCityId = 'changan';
          return { logs: ['洛阳宫室火起，你收其府库珍宝，得钱 1200。'] };
        },
      },
    ],
  },

  anchor_sunjian: {
    id: 'anchor_sunjian', name: '孙坚殒于岘山', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [13, 20],
    slot: 'sunjian', notFor: ['sunjian'],
    text: {
      title: '孙坚殒于岘山',
      body: () => '孙坚跨江击刘表，中伏殒于岘山。江东震动，其子孙策收余众。',
      portrait: 'nightraid', source: '江东急报',
    },
    options: [
      {
        key: 'know', label: '知道了', costText: '—',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          const f = G.factions.sunjian;
          if (f && !f.dead) {
            for (const c of State.factionCities(G, 'sunjian')) c.morale = U.clamp((c.morale || 55) - 15, 0, 100);
          }
          return { logs: ['江东易主，孙策收其余众。'] };
        },
      },
      {
        key: 'raid', label: '趁丧取其一城', costText: '战功 +20 · 天下关系 −10',
        cost: () => ({}),
        apply: (G) => {
          const f = G.factions.sunjian;
          if (f && !f.dead) {
            for (const other of Object.keys(G.factions)) {
              if (other === 'free' || other === G.player.factionId) continue;
              Diplo.pair(G, G.player.factionId, other).rel -= 10;
            }
          }
          G.player.merit += 20;
          return { logs: ['你趁江东之丧兴兵，天下侧目。'] };
        },
      },
    ],
  },

  // 隘山 · 孙坚军视角：死的是自家主公
  anchor_sunjian_self: {
    id: 'anchor_sunjian_self', name: '主公殒于隘山', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [13, 20],
    slot: 'sunjian', forFaction: ['sunjian'],
    text: {
      title: '主公殒于隘山',
      body: () => '主公孙坚跨江击刘表，中伏殒于隘山。军中无主，孙策年少，诸将观望，问你一句。',
      portrait: 'nightraid', source: '江东急报',
    },
    options: [
      {
        key: 'support', label: '率先奉孙策为主', costText: '好感 +15 · 全军士气 +5',
        cost: () => ({}),
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) + 15, 0, 100);
          for (const c of State.factionCities(G, G.player.factionId)) c.morale = U.clamp((c.morale || 55) + 5, 0, 100);
          for (const h of Object.values(G.heroes)) {
            if (h.factionId === G.player.factionId) h.loyalty = U.clamp((h.loyalty || 60) + 8, 0, 100);
          }
          return { logs: ['你率先拜孙策为主，江东军中乃定。'] };
        },
      },
      {
        key: 'self', label: '收兵自立（本局直辖上限 +1）', costText: '名望 −15 · 天下关系 −15',
        cost: () => ({}),
        apply: (G) => {
          G.player.capBonus = (G.player.capBonus || 0) + 1;
          G.player.reputation = Math.max(0, G.player.reputation - 15);
          for (const other of Object.keys(G.factions)) {
            if (other === 'free' || other === G.player.factionId) continue;
            const pr = Diplo.pair(G, G.player.factionId, other);
            if (pr) pr.rel -= 15;
          }
          return { logs: ['你收兵自立，天下侧目。'] };
        },
      },
      {
        key: 'hold', label: '按兵观望', costText: '全军士气 −10',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.morale = U.clamp((c.morale || 55) - 10, 0, 100);
          return { logs: ['军中无主，诸将观望，士气低落。'] };
        },
      },
    ],
  },

  anchor_wangyun: {
    id: 'anchor_wangyun', name: '王允诛董', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [25, 34],
    slot: 'wangyun', notFor: ['dongzhuo'],
    text: {
      title: '王允诛董',
      body: () => '司徒王允与吕布合谋，诛董卓于北掖门。关中诸将各拥兵自守，人心汹汹。',
      portrait: 'edict', source: '关中探报',
    },
    options: [
      {
        key: 'know', label: '知道了', costText: '—',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          for (const c of State.factionCities(G, 'dongzhuo')) {
            c.order = U.clamp(c.order - 10, 0, 100);
          }
          for (const h of Object.values(G.heroes)) {
            if (h.factionId === 'dongzhuo') h.loyalty = U.clamp((h.loyalty || 60) - 15, 0, 100);
          }
          return { logs: ['董卓既诛，关中诸将离心。'] };
        },
      },
    ],
  },

  // 北掖门 · 董卓军视角：这一刀是冲自家主公来的
  anchor_wangyun_dz: {
    id: 'anchor_wangyun_dz', name: '北掖门之变', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [25, 34],
    slot: 'wangyun', forFaction: ['dongzhuo'],
    text: {
      title: '北掖门之变',
      body: () => '司徒王允与中郎将吕布密谋，欲于北掖门图丞相。宫中有人密告，军府问你如何处之。',
      portrait: 'edict', source: '宫中密报',
    },
    options: [
      {
        key: 'purge', label: '先发诛王允', costText: '钱 −500 · 名望 −10',
        cost: () => ({ gold: 500 }), why: '府库不足 500',
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.order = U.clamp((c.order || 50) + 5, 0, 100);
          for (const h of Object.values(G.heroes)) {
            if (h.factionId === G.player.factionId) h.loyalty = U.clamp((h.loyalty || 60) + 5, 0, 100);
          }
          G.player.reputation = Math.max(0, G.player.reputation - 10);
          return { logs: ['你先发制人，王允伏诛，吕布出走，关中得安。'] };
        },
      },
      {
        key: 'ignore', label: '置之不理', costText: '全势力治安 −10 · 忠诚 −15',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          for (const c of State.factionCities(G, G.player.factionId)) c.order = U.clamp((c.order || 50) - 10, 0, 100);
          for (const h of Object.values(G.heroes)) {
            if (h.factionId === G.player.factionId) h.loyalty = U.clamp((h.loyalty || 60) - 15, 0, 100);
          }
          return { logs: ['北掖门变起，丞相遇害，关中诸将离心。'] };
        },
      },
    ],
  },

  anchor_emperor_east: {
    id: 'anchor_emperor_east', name: '献帝东归', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [60, 74],
    slot: 'emperor_east',
    text: {
      title: '车驾东归',
      body: () => '李傕郭汜相攻，天子乘间东归，车驾至安邑，百官采稆而食。',
      portrait: 'edict', source: '河东急报',
    },
    options: [
      {
        key: 'know', label: '知道了', costText: '—',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          if (G.court) {
            G.court.emperorCityId = 'luoyang';
            G.court.controller = null;
          }
          return { logs: ['天子东归，帝在洛阳，然无兵可护。'] };
        },
      },
      {
        key: 'protect', label: '遣兵迎驾', costText: '钱 −500 · 名望 +15',
        cost: () => ({ gold: 500 }), why: '府库不足 500',
        apply: (G) => {
          if (G.court) {
            G.court.emperorCityId = 'luoyang';
            G.court.controller = G.player.factionId;
          }
          G.player.reputation += 15;
          return { logs: ['你遣兵迎驾，帝驻洛阳，天下称义。'] };
        },
      },
    ],
  },

  anchor_caocao: {
    id: 'anchor_caocao', name: '曹操迎驾', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [75, 90],
    slot: 'caocao', notFor: ['caocao'],
    text: {
      title: '曹操迎驾',
      body: () => '曹操自兖州西进，迎天子于洛阳，迁都许县。自此诏令皆出其手。',
      portrait: 'edict', source: '许都消息',
    },
    options: [
      {
        key: 'know', label: '知道了', costText: '—',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          if (G.court && !G.court.controller) {
            const f = G.factions.caocao;
            G.court.controller = (f && !f.dead) ? 'caocao' : null;
            G.court.emperorCityId = 'luoyang';
          }
          return { logs: ['曹操迎驾，诏令自此出其手。'] };
        },
      },
    ],
  },

  // 迎驾 · 曹操军视角：西进的是自家
  anchor_caocao_self: {
    id: 'anchor_caocao_self', name: '迎天子于洛阳', scope: 'world', weight: 1, scenario: 'taodong190',
    once: true, anchor: [75, 90],
    slot: 'caocao', forFaction: ['caocao'],
    text: {
      title: '迎天子于洛阳',
      body: () => '天子东归洛阳，宫室残破，百官采耟而食。你引兵西行，帝在残垣之间。左右或言：奉天子以令不臣。',
      portrait: 'edict', source: '洛阳残宫',
    },
    options: [
      {
        key: 'move', label: '奉驾而西，诏令自出', costText: '钱 −800 · 名望 +20 · 直辖上限 +1',
        cost: () => ({ gold: 800 }), why: '府库不足 800',
        apply: (G) => {
          if (G.court && !G.court.controller) {
            G.court.controller = G.player.factionId;
            G.court.emperorCityId = 'luoyang';
          }
          G.player.reputation += 20;
          G.player.capBonus = (G.player.capBonus || 0) + 1;
          return { logs: ['你奉天子于洛阳，诏令自此出你之手。'] };
        },
      },
      {
        key: 'feed', label: '供其衣食而不奉', costText: '名望 +8',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          if (G.court && !G.court.controller) {
            G.court.controller = G.player.factionId;
            G.court.emperorCityId = 'luoyang';
          }
          G.player.reputation += 8;
          return { logs: ['你供天子衣食而不奉迎，天下称厚。'] };
        },
      },
    ],
  },

  treasure_find: {
    id: 'treasure_find', name: '掘得古器', scope: 'player', weight: 4, once: false, cooldown: 30,
    cond: (G, ctx) => !!ctx.city && State.freeTreasures(G).length > 0,
    text: {
      title: '掘得古器',
      body: (G, ctx) => `${ctx.city.name}民掘地得古器一具，铜色苍然，或为前朝之物。`,
      portrait: 'seal', source: '里正',
    },
    options: [
      {
        key: 'keep', label: '收之入库', costText: '得宝物一件',
        cost: () => ({}),
        apply: (G, ctx) => {
          const free = State.freeTreasures(G);
          if (!free.length) return { logs: ['器物已不知去向。'] };
          const tid = free[RNG.between(0, free.length - 1)];
          G.treasures[tid] = { holder: null, cityId: ctx.city.id };
          return { logs: [`${ctx.city.name}得${TREASURES[tid].name}，藏于府库。`] };
        },
      },
      {
        key: 'offer', label: '献于上级', costText: '上级好感 +8',
        fallback: true, cost: () => ({}),
        apply: (G) => {
          G.player.favor = U.clamp((G.player.favor || 60) + 8, 0, 100);
          return { logs: ['古器献于上级，得一句「忠谨可嘉」。'] };
        },
      },
      {
        key: 'sell', label: '鬻之于市', costText: '钱 +600 · 名望 −3',
        cost: () => ({}),
        apply: (G, ctx) => {
          ctx.city.gold += 600;
          G.player.reputation = Math.max(0, G.player.reputation - 3);
          return { logs: ['古器鬻于市，得钱 600。'] };
        },
      },
    ],
  },
};

const EVENT_KEYS = Object.keys(EVENTS);
