// 无头测试装载器：把 index.html 里声明的脚本按顺序拼起来，在 node vm 里跑。
// 自动跳过依赖 DOM 的视图层，所以脚本清单永远和 index.html 保持一致，不会漏。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DOM_FREE_SKIP = /^js\/(view\/|main\.js$)/;

function scriptList() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const out = [];
  const re = /<script\s+src="([^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/**
 * 启动一个无头游戏实例。
 * @param {object} opts { seed, factionId, cityId, playerName }
 * @returns {{ G, api, ctx }} api 里是全部顶层全局（State / Store / 各系统）
 */
function boot(opts) {
  const files = scriptList().filter(f => !DOM_FREE_SKIP.test(f));
  const missing = files.filter(f => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) throw new Error('index.html 声明的脚本不存在: ' + missing.join(', '));

  const bundle = files
    .map(f => `// ==== ${f} ====\n` + fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n;\n');

  // 导出清单不手抄：vm 里 const/let 不会变成 context 属性，只能靠拼接这段代码导出。
  // 名字直接从源码收（与 verify 的静态重名检查同一套规则），新增全局自动可测。
  const names = new Set();
  for (const m of bundle.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  const src = bundle + `\n;globalThis.__API = { ${[...names].join(', ')} };`;

  const ctx = {
    console, Math, Date, JSON, parseInt, parseFloat, isFinite, isNaN,
    Object, Array, String, Number, Boolean, Set, Map, Error, RegExp,
    setTimeout, clearTimeout, Promise,
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.localStorage = {
    _d: {},
    get length() { return Object.keys(this._d).length; },
    key(i) { const ks = Object.keys(this._d); return i < ks.length ? ks[i] : null; },
    getItem(k) { return k in this._d ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
    clear() { this._d = {}; },
  };

  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'bundle.js' });

  const api = ctx.__API;
  const p = Object.assign({
    scenarioId: api.DEFAULT_SCENARIO,
    factionId: 'caocao',
    cityId: 'chenliu',
    playerName: '测试',
    seed: 1,
  }, opts || {});

  const G = api.State.create(p);
  api.Store.init(G);
  return { G, api, ctx, get: () => api.Store.get() };
}

/** 把某势力之外的城送给玩家（造多城局用） */
function grantCities(api, count, opts) {
  const g = () => api.Store.get();
  const G = api.Store.get();
  const p = G.player;
  const own = api.State.factionCities(G, p.factionId).filter(c => c.grantedTo !== api.PLAYER_HERO_ID);
  const pool = own.concat(Object.values(G.cities).filter(c => c.owner !== p.factionId && c.owner !== 'free'));
  let n = 0;
  for (const c of pool) {
    if (n >= count) break;
    if (p.demesne.indexOf(c.id) >= 0) continue;
    c.owner = p.factionId;
    c.grantedTo = api.PLAYER_HERO_ID;
    p.demesne.push(c.id);
    n++;
  }
  api.Store.replace(G);
  return g().player.demesne.slice();
}

/** 逐月推进，捕获异常；返回 { ok, turn, error } */
function runTurns(api, months, eachTurn) {
  for (let i = 0; i < months; i++) {
    if (eachTurn) eachTurn(i + 1);
    try {
      api.Store.dispatch('END_TURN');
    } catch (e) {
      return { ok: false, turn: api.Store.get().meta.turn, error: e.message };
    }
    if (api.Store.get().over) return { ok: true, turn: api.Store.get().meta.turn, over: api.Store.get().over };
  }
  return { ok: true, turn: api.Store.get().meta.turn };
}

/** 数值健康检查：所有城市/玩家的关键字段必须有限 */
function scanNaN(api) {
  const bad = [];
  const G = api.Store.get();
  for (const c of Object.values(G.cities)) {
    for (const k of ['pop', 'food', 'gold', 'mat', 'iron', 'order', 'wall', 'morale']) {
      if (!Number.isFinite(c[k])) bad.push(`${c.name}.${k}=${c[k]}`);
    }
    for (const k of api.TROOP_KEYS) {
      if (!Number.isFinite(c.garrison[k])) bad.push(`${c.name}.garrison.${k}=${c.garrison[k]}`);
    }
    for (const k of Object.keys(c.buildings)) {
      if (!Number.isFinite(c.buildings[k])) bad.push(`${c.name}.buildings.${k}=${c.buildings[k]}`);
    }
    for (const cl of c.clans) {
      if (!Number.isFinite(cl.sat) || !Number.isFinite(cl.inf)) bad.push(`${c.name}.clan.${cl.name}`);
    }
  }
  for (const k of ['merit', 'reputation', 'favor']) {
    if (!Number.isFinite(G.player[k])) bad.push(`player.${k}=${G.player[k]}`);
  }
  for (const a of Object.values(G.armies)) {
    if (!Number.isFinite(a.eta) || !Number.isFinite(a.x) || !Number.isFinite(a.y)) bad.push(`army.${a.id}`);
  }
  return bad;
}

/** 把玩家指挥的挂起战斗全部打完（有战法就顺手放一个）—— 测试里推进回合前后都可以先调它 */
function settleBattles(api, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    const G = api.Store.get();
    const army = Object.values(G.armies).find(a => a.battle);
    if (!army) return true;
    let tactic = null;
    try {
      const list = api.Combat.tacticsFor(G, army, G.cities[army.battle.cityId]);
      const pick = list.find(t => t.ok && t.key === 'mazhen');
      if (pick) tactic = pick.key;
    } catch (e) { /* 拿不到战法就硬打 */ }
    try { api.Store.dispatch('BATTLE_STEP', { armyId: army.id, tactic }); }
    catch (e) { return false; }
  }
  return false;
}

module.exports = { boot, grantCities, runTurns, settleBattles, scanNaN, scriptList, ROOT, DOM_FREE_SKIP };
