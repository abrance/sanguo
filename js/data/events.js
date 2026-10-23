// 事件池（docs/EVENTS.md §3 / §7）：加一条事件 = 加一个对象，不需要动逻辑
//
// 字段：
//   scope   'player'（玩家直辖城，权重 ×3）| 'faction'（本势力）| 'world'（全图）
//   weight  基础权重；cond 为假的直接丢弃
//   once    一局只触发一次；cooldown 同一条事件的间隔回合
//   text    { title, body(G, ctx), portrait, source }
//   options 见下：cost 返回 null 表示不可选，why 写不可选的原因（界面直接显示）
//           apply(G, ctx) 立刻生效，可返回 delay: { turns, log, fx(G, ctx) }
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
};

const EVENT_KEYS = Object.keys(EVENTS);
