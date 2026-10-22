#!/usr/bin/env node
// 长跑推演器：观察世界演化与玩家进度，用于调平衡。
//
//   node tools/sim.js                         被动玩家（只设方针）跑 200 回合
//   node tools/sim.js --bot                   主动玩家（补兵/研科技/打弱邻）跑 200 回合
//   node tools/sim.js --months 400 --seed 22
//   node tools/sim.js --faction dongzhuo --city luoyang
//   node tools/sim.js --every 20 -v
//
// 输出：每 N 回合的势力数 / 最大势力 / 玩家官阶 / 直辖城数 / 科技数

const h = require('./harness');

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = name => argv.includes('--' + name);

const MONTHS = Number(arg('months', 200));
const EVERY = Number(arg('every', 20));
const SEED = Number(arg('seed', 11));
const FACTION = arg('faction', 'caocao');
const CITY = arg('city', 'chenliu');
const BOT = flag('bot');
const VERBOSE = flag('v');

const { api } = h.boot({ seed: SEED, factionId: FACTION, cityId: CITY, playerName: '推演' });
const get = () => api.Store.get();

/* ── 主动玩家策略 ── */
function botStep() {
  const x = get();
  const p = x.player;

  // 1 每座直辖城委任备战
  for (const c of api.State.demesne(x)) {
    if (!c.policy) { try { api.Store.dispatch('SET_POLICY', { cityId: c.id, policy: 'army' }); } catch (e) { } }
  }

  // 2 补兵到兵额 95%
  for (const c of api.State.demesne(get())) {
    const cap = api.State.troopCapOf(get(), c);
    if (api.troopTotal(c.garrison) < cap * 0.95) {
      try { api.Store.dispatch('FILL_TROOPS', { cityId: c.id, ratio: 1 }); } catch (e) { }
    }
  }

  // 3 科技：按军→农→工→商 的顺序研
  const f = get().factions[p.factionId];
  if (!f.tech.current && !f.tech.queue.length) {
    for (const k of ['mil1', 'agr1', 'mil2', 'agr2', 'mil3', 'ind1', 'com1', 'mil4', 'agr3']) {
      if (api.TechSys.available(f, k)) { try { api.Store.dispatch('RESEARCH', { key: k }); } catch (e) { } break; }
    }
  }

  // 4 上命能办就办
  if (p.mission && p.mission.typeKey !== 'expedition') {
    try { api.Store.dispatch('FULFILL_MISSION'); } catch (e) { }
  }

  // 5 满编的城打最弱邻敌
  const y = get();
  for (const c of api.State.demesne(y)) {
    if (api.troopTotal(c.garrison) < api.State.troopCapOf(y, c) * 0.9) continue;
    const nbs = api.State.neighbors(y, c.id, 235).filter(n => n.owner !== y.player.factionId);
    if (!nbs.length) continue;
    let best = nbs[0];
    for (const n of nbs) if (api.Combat.defenseScore(y, n) < api.Combat.defenseScore(y, best)) best = n;
    const plan = api.Army.previewDispatch(c, 0.85);
    const pred = api.Combat.predict(y, plan, c.governor, best, y.player.factionId, api.State.bld(c, 'drill'));
    if (pred.win && pred.remain > api.troopTotal(plan) * 0.5) {
      try { api.Store.dispatch('DISPATCH', { fromId: c.id, toId: best.id, ratio: 0.85 }); } catch (e) { }
    }
  }
}

function snapshot(tag) {
  const G = get();
  const own = {};
  for (const c of Object.values(G.cities)) own[c.owner] = (own[c.owner] || 0) + 1;
  const top = Object.entries(own).sort((a, b) => b[1] - a[1])[0];
  const mine = own[G.player.factionId] || 0;
  const b = G.factions[G.player.factionId].bonus;
  return {
    tag,
    date: `${G.meta.year}/${String(G.meta.month).padStart(2, '0')}`,
    factions: Object.keys(own).filter(k => k !== 'free').length,
    top: `${(G.factions[top[0]] || {}).name || top[0]}${top[1]}`,
    mine,
    rank: api.rankOf(G.player.rank).name,
    merit: G.player.merit,
    demesne: `${G.player.demesne.length}/${api.cityCap(G.player)}`,
    tech: Object.keys(G.factions[G.player.factionId].tech.done).length,
    food: b.food.toFixed(2),
  };
}

const header = ['回合', '年月', '势力', '最大', '我方城', '官阶', '战功', '直辖', '科技', '粮×'];
console.log((BOT ? '主动玩家' : '被动玩家') + ` · 势力 ${FACTION} · 城 ${CITY} · 种子 ${SEED} · ${MONTHS} 回合\n`);
console.log(header.map((s, i) => i === 0 ? s.padEnd(5) : s.padEnd(i === 1 ? 7 : i === 3 ? 10 : 6)).join(''));

/** 待决求和：推演器替玩家拍板（按当前强弱决定受或却），否则 AI 的求和永远悬着 */
function resolveOffers() {
  const G = get();
  for (const o of (G.peaceOffers || []).slice()) {
    // 被动玩家求稳：有人请和就许；主动玩家只在打不过时讲和
    const mine = api.Diplo.strength(G, G.player.factionId);
    const theirs = api.Diplo.strength(G, o.fid);
    const accept = !BOT || mine < theirs * 1.1;
    try {
      api.Store.dispatch(accept ? 'PEACE_ACCEPT' : 'PEACE_REFUSE', { fid: o.fid });
    } catch (e) { }
  }
}

let result = null;
for (let t = 1; t <= MONTHS; t++) {
  resolveOffers();
  if (BOT) botStep();
  try {
    api.Store.dispatch('END_TURN');
  } catch (e) {
    result = { ok: false, turn: t, error: e.message };
    break;
  }
  if (t % EVERY === 0 || t === 1) {
    const s = snapshot(t);
    if (VERBOSE || t % EVERY === 0) {
      console.log([
        String(s.tag).padEnd(5), s.date.padEnd(7), String(s.factions).padEnd(6),
        String(s.top).padEnd(12), String(s.mine).padEnd(8), s.rank.padEnd(6),
        String(s.merit).padEnd(6), s.demesne.padEnd(6), String(s.tech).padEnd(6), s.food,
      ].join(''));
    }
  }
  if (get().over) { result = { ok: true, over: get().over, turn: t }; break; }
}

const G = get();
const bad = h.scanNaN(api);
console.log('\n结束状态：');
console.log(`  回合 ${G.meta.turn}（${G.meta.year}年${G.meta.month}月）  官阶 ${api.rankOf(G.player.rank).name}  战功 ${G.player.merit}  直辖 ${G.player.demesne.length}/${api.cityCap(G.player)}`);
console.log(`  势力城 ${api.State.factionCities(G, G.player.factionId).length}/70  势力数 ${new Set(Object.values(G.cities).map(c => c.owner)).size}`);
if (result && result.error) console.log(`  ✗ 中断: ${result.error}`);
if (result && result.over) console.log(`  结束: ${result.over.result} — ${result.over.text}`);
if (bad.length) {
  console.log(`  ✗ 数值异常: ${bad.slice(0, 5).join('; ')}`);
  process.exit(1);
}
console.log('  数值检查: 正常');
