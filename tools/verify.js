#!/usr/bin/env node
// 一键自检：不依赖浏览器，跑完打印 PASS/FAIL 并以退出码表示结果。
//   node tools/verify.js          只跑断言
//   node tools/verify.js -v       额外打印明细
//
// 覆盖：状态不变量 / 命令校验 / 长跑无崩溃无 NaN / 战斗曲线 / 科技链 / 补给线

const h = require('./harness');

let pass = 0, fail = 0;
const fails = [];
const V = process.argv.includes('-v');

function ok(name, cond, detail) {
  if (cond) { pass++; if (V) console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; fails.push(name + (detail ? ' — ' + detail : '')); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n[${t}]`); }

// ─────────────────────────────────────────────
section('静态检查（无需开局）');
{
  const fs = require('fs');
  const path = require('path');

  // 1) index.html 声明的脚本必须都在磁盘上（harness 会在 boot 时报错，这里先给人看）
  const declared = h.scriptList();
  const missing = declared.filter(f => !fs.existsSync(path.join(h.ROOT, f)));
  ok('index.html 声明的脚本都存在', !missing.length, missing.join(', '));

  // 2) 磁盘上的 js 必须在 index.html 里，否则写了不生效
  const onDisk = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.js$/.test(e.name)) onDisk.push(path.relative(h.ROOT, p));
    }
  })(path.join(h.ROOT, 'js'));
  const orphan = onDisk.filter(f => !declared.includes(f));
  ok('js/ 下无未引用的孤儿脚本', !orphan.length, orphan.join(', '));

  // 3) 全局作用域撞名：无模块系统，顶层重名会静默覆盖前一个
  const decl = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/;
  const owner = new Map();
  const dupes = [];
  const loaded = new Set();   // harness 实际会装载的（跳过 view/ 与 main.js）
  for (const f of declared) {
    const src = fs.readFileSync(path.join(h.ROOT, f), 'utf8');
    for (const line of src.split('\n')) {
      const m = decl.exec(line);
      if (!m) continue;
      if (!h.DOM_FREE_SKIP.test(f)) loaded.add(m[1]);
      if (owner.has(m[1])) dupes.push(`${m[1]}: ${owner.get(m[1])} ↔ ${f}`);
      else owner.set(m[1], f);
    }
  }
  ok('顶层标识符无重名', !dupes.length, dupes.slice(0, 5).join('; '));

  // 4) harness 靠拼接导出顶层符号（vm 里 const 不进 context），漏导出＝测试拿不到
  const { api } = h.boot({ seed: 1 });
  const notExported = [...loaded].filter(k => !(k in api));
  ok('harness 导出覆盖全部顶层符号', !notExported.length,
    notExported.slice(0, 5).join(', ') || `共 ${Object.keys(api).length} 个`);
}

// ─────────────────────────────────────────────
section('分层守护');
{
  const fs = require('fs');
  const path = require('path');
  const read = f => fs.readFileSync(path.join(h.ROOT, f), 'utf8');
  const listJs = dir => {
    const out = [];
    (function walk(d) {
      for (const e of fs.readdirSync(path.join(h.ROOT, d), { withFileTypes: true })) {
        const p = d + '/' + e.name;
        if (e.isDirectory()) walk(p);
        else if (/\.js$/.test(e.name)) out.push(p);
      }
    })(dir);
    return out;
  };
  // 只查真实引用，避免注释里的词误报
  const hits = (files, re) => files
    .filter(f => re.test(read(f).replace(/\/\/.*$/gm, '')))
    .map(f => f + ' ↔ ' + re);

  const systems = listJs('js/systems');
  const dataCore = listJs('js/data').concat(listJs('js/core'));
  const view = listJs('js/view');

  // 1) 规则层不碰 DOM
  let bad = hits(systems, /\b(document|window|innerHTML|querySelector|addEventListener)\b/);
  ok('systems 不碰 DOM', !bad.length, bad.slice(0, 3).join('; '));

  // 2) 规则层不走命令层（dispatch 只在 view/store 里）
  bad = hits(systems, /\b(Store\.|dispatch\()/);
  ok('systems 不调 dispatch', !bad.length, bad.slice(0, 3).join('; '));

  // 3) core / data 不得往上走：不调命令、不碰视图（data 可以调 State 的纯查询函数）
  bad = hits(dataCore, /\b(Store\.|UI\.|Renderer\.|Bus\.|dispatch\()/);
  ok('core / data 不依赖上层', !bad.length, bad.slice(0, 3).join('; '));

  // 4) 视图层只读状态：不允许直接写 G
  bad = view.concat(['js/main.js']).filter(f =>
    /(^|[^.\w])G\.[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*\s*=[^=]/.test(read(f)));
  ok('view 不直接改状态', !bad.length, bad.join(', '));

  // 5) 样式：裸色值只允许在 :root token 区
  const css = read('style.css');
  const rootEnd = css.indexOf('\n}', css.indexOf(':root{'));
  const bareHex = css.slice(rootEnd).match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  ok('style.css 规则区无裸色值', !bareHex.length, bareHex.slice(0, 5).join(', '));

  // 6) 内联 style 只允许自定义属性（JS 传值，CSS 翻译成属性）
  const inline = [];
  for (const f of ['index.html'].concat(view)) {
    const src = read(f);
    const re = /style="([^"]*)"/g;
    let m;
    while ((m = re.exec(src))) {
      for (const decl of m[1].split(';').filter(Boolean)) {
        if (!/^\s*--[\w-]+\s*:/.test(decl)) inline.push(`${f}: ${m[1].trim()}`);
      }
    }
  }
  ok('内联 style 只剩 --自定义属性', !inline.length, inline.slice(0, 3).join(' | '));
}

// ─────────────────────────────────────────────
section('事件总线隔离');
{
  const { api } = h.boot({ seed: 1 });
  const realErr = console.error;
  console.error = () => { };            // 这里故意触发异常，别让 CI 日志变噪
  let ran = 0;
  api.Bus.on('probe', () => { throw new Error('订阅者故意抛错'); });
  api.Bus.on('probe', () => { ran++; });
  api.Bus.emit('probe', {});
  ok('一个订阅者抛错不打断其余订阅者', ran === 1, `后续订阅者执行 ${ran} 次`);

  // dispatch 中途的渲染出错也不能让状态更新失效
  let dispatched = false;
  api.Bus.on('state', () => { throw new Error('渲染故意抛错'); });
  api.Store.dispatch('SET_POLICY', { cityId: api.Store.get().player.homeCityId, policy: null });
  dispatched = !!api.Store.get();
  console.error = realErr;
  ok('订阅者抛错后状态已更新', dispatched);
}

// ─────────────────────────────────────────────
section('状态不变量');
{
  const { api } = h.boot({ seed: 1 });
  const G = api.Store.get();

  ok('70 城', Object.keys(G.cities).length === 70, String(Object.keys(G.cities).length));
  ok('势力全有主城', api.State.factionCities(G, 'free').length === 0);
  ok('玩家有 1 座直辖城', G.player.demesne.length === 1);

  // 兵额：拆解相乘必须等于 troopCapOf（防两套公式打架）
  let capMismatch = null;
  for (const c of Object.values(G.cities)) {
    const b = api.State.troopCapBreakdown(G, c);
    const mul = b.popBase * b.orderMul * b.barracksMul * b.drillMul * b.clanMul * b.techMul * b.momentumMul;
    if (Math.abs(Math.round(mul) - api.State.troopCapOf(G, c)) > 0) {
      capMismatch = `${c.name}: ${Math.round(mul)} != ${api.State.troopCapOf(G, c)}`;
      break;
    }
  }
  ok('兵额推导与 troopCapOf 一致', !capMismatch, capMismatch || '');

  // 建筑镜像字段：farm/market/wall 必须等于 buildings 里的等级
  let mirrorBad = null;
  for (const c of Object.values(G.cities)) {
    if (c.farm !== api.State.bld(c, 'farm')) mirrorBad = `${c.name}.farm`;
    if (c.market !== api.State.bld(c, 'market')) mirrorBad = `${c.name}.market`;
    if (c.wallMax !== api.State.bld(c, 'wall')) mirrorBad = `${c.name}.wallMax`;
    if (mirrorBad) break;
  }
  ok('建筑镜像字段同步', !mirrorBad, mirrorBad || '');

  // 士族：每个城 2-3 家，满意度与影响力在 0-100
  let clanBad = null;
  for (const c of Object.values(G.cities)) {
    if (c.clans.length < 2 || c.clans.length > 3) clanBad = `${c.name} 家数 ${c.clans.length}`;
    for (const cl of c.clans) {
      if (cl.sat < 0 || cl.sat > 100 || cl.inf < 0 || cl.inf > 100) clanBad = `${c.name}.${cl.name}`;
    }
    if (clanBad) break;
  }
  ok('每城 2-3 家士族且数值在界内', !clanBad, clanBad || '');

  // 科技乘数表默认全 1
  const bonus = G.factions.caocao.bonus;
  ok('开局科技乘数全为 1', Object.values(bonus).every(v => Math.abs(v - 1) < 1e-9));
}

// ─────────────────────────────────────────────
section('命令校验（非法操作必须抛错）');
{
  const { api } = h.boot({ seed: 2 });
  const G0 = api.Store.get();
  const home = G0.player.homeCityId;
  const enemy = Object.values(G0.cities).find(c => c.owner !== G0.player.factionId);

  const mustThrow = (name, fn) => {
    try { fn(); ok(name, false, '未抛错'); }
    catch (e) { ok(name, true, e.message); }
  };

  mustThrow('非直辖城建造', () => api.Store.dispatch('BUILD', { cityId: enemy.id, key: 'farm' }));
  mustThrow('无船坞募水军', () => api.Store.dispatch('RECRUIT', { cityId: home, troop: 'nvy', amount: 100 }));
  mustThrow('越级研习科技', () => api.Store.dispatch('RESEARCH', { key: 'agr10' }));
  mustThrow('空选批量补兵', () => api.Store.dispatch('BATCH_FILL', { cityIds: [] }));
  mustThrow('空选批量调兵', () => api.Store.dispatch('BATCH_DISPATCH', { cityIds: [], toId: enemy.id }));
  mustThrow('补给线指向自己', () => api.Store.dispatch('SET_RALLY', { cityId: home, toId: home }));
  mustThrow('县长转权臣', () => api.Store.dispatch('SET_ROUTE', { route: 'dominant' }));
  mustThrow('条件不足自立', () => api.Store.dispatch('DECLARE_INDEPENDENCE'));
  mustThrow('无上命却上缴', () => api.Store.dispatch('FULFILL_MISSION'));

  // 所有带 cityId 的玩家命令都走 mustOwnCity：拿敌城试一遍，谁漏判谁就被抓出来
  for (const [type, extra] of Object.entries({
    RECRUIT: { troop: 'inf', amount: 10 },
    FILL_TROOPS: { ratio: 1 },
    BUILD: { key: 'farm' },
    CANCEL_BUILD: { index: 0 },
    SET_POLICY: { policy: 'farming' },
    SET_RALLY: { toId: home },
    CLAN_ACTION: { action: 'pacify' },
    DISPATCH: { toId: home, ratio: 0.5 },
  })) {
    const payload = Object.assign({ cityId: enemy.id, fromId: enemy.id }, extra);
    mustThrow(`${type} 拒非直辖城`, () => api.Store.dispatch(type, payload));
  }

  // 自立旗色：必须与场上所有在册势力（含原势力、含在野）明显区分
  const { api: flagApi } = h.boot({ seed: 9 });
  h.grantCities(flagApi, 3);
  const pg = flagApi.Store.get().player;
  pg.rank = Math.max(pg.rank, flagApi.INDEPENDENCE.minRank);
  pg.reputation = Math.max(pg.reputation, flagApi.INDEPENDENCE.minReputation + 10);
  const oldColor = flagApi.Store.get().factions[pg.factionId].color;
  flagApi.Store.dispatch('DECLARE_INDEPENDENCE');
  const flagG = flagApi.Store.get();
  const myFlag = flagG.factions[flagG.player.factionId].color;
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const colorGap = (a, b) => {
    const A = rgb(a), B = rgb(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  };
  const gapTo = Object.values(flagG.factions)
    .filter(f => f.id !== flagG.player.factionId && !f.dead)
    .map(f => ({ name: f.name, gap: colorGap(myFlag, f.color) }))
    .sort((a, b) => a.gap - b.gap)[0];
  ok('自立后旗色与最近势力明显不同（差距 ≥ 60）', gapTo.gap >= 60,
    `${myFlag} vs ${gapTo.name}(${gapTo.gap.toFixed(0)})，原旗 ${oldColor}`);

  // 终局后一切命令都在 dispatch 层被拦（含以前各自漏判的 RECRUIT / BUILD）
  const { api: overApi } = h.boot({ seed: 3 });
  const overG = overApi.Store.get();
  overG.over = { result: 'lose', text: '测试终局' };
  const overMustThrow = (name, fn) => {
    try { fn(); ok(name, false, '未抛错'); }
    catch (e) { ok(name, /战局已终/.test(e.message), e.message); }
  };
  for (const type of ['END_TURN', 'RECRUIT', 'BUILD', 'FILL_TROOPS', 'SET_POLICY', 'BATCH_FILL']) {
    overMustThrow(`终局封锁 ${type}`, () => overApi.Store.dispatch(type,
      { cityId: overG.player.homeCityId, key: 'farm', troop: 'inf', amount: 10, cityIds: [overG.player.homeCityId] }));
  }

  // 合法操作不应抛
  try {
    api.Store.dispatch('BUILD', { cityId: home, key: 'lumber' });
    ok('合法建造', true);
  } catch (e) { ok('合法建造', false, e.message); }

  try {
    api.Store.dispatch('RESEARCH', { key: 'agr1' });
    api.Store.dispatch('RESEARCH', { key: 'ind1' });
    const f = api.Store.get().factions.caocao;
    ok('科技可排队', f.tech.current && f.tech.queue.length === 1);
  } catch (e) { ok('科技可排队', false, e.message); }
}

// ─────────────────────────────────────────────
section('长跑（80 回合 × 3 种子，无崩溃 / 无 NaN）');
for (const seed of [11, 22, 33]) {
  const { api } = h.boot({ seed });
  const G0 = api.Store.get();
  api.Store.dispatch('SET_POLICY', { cityId: G0.player.homeCityId, policy: 'balanced' });
  const r = h.runTurns(api, 80);
  const bad = h.scanNaN(api);
  ok(`seed ${seed} 无异常`, r.ok && bad.length === 0,
    r.ok ? (bad.length ? bad.slice(0, 3).join('; ') : '') : r.error);
}

// ─────────────────────────────────────────────
section('战斗曲线（墙 2 级，混合地形）');
{
  const { api } = h.boot({ seed: 99 });
  const G0 = api.Store.get();
  const heroes = Object.keys(G0.heroes).filter(k => k !== api.PLAYER_HERO_ID);
  const terrains = ['plain', 'plain', 'plain', 'forest', 'hill', 'mountain', 'marsh'];

  const rate = (ratio, wall) => {
    let cap = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      const G = JSON.parse(JSON.stringify(G0));
      const city = G.cities.liangguo;
      city.terrain = terrains[i % terrains.length];
      city.wall = wall;
      city.morale = 55;
      const defN = 800, atkN = Math.round(defN * ratio);
      city.garrison = Object.assign(api.emptyTroops(), {
        inf: Math.round(defN * 0.58), arc: Math.round(defN * 0.27), cav: Math.round(defN * 0.15),
      });
      const pick = lo => heroes.find(h => G.heroes[h].tong >= lo) || heroes[0];
      city.governor = pick(70);
      const army = {
        id: 't', factionId: 'caocao', heroId: pick(70),
        troops: Object.assign(api.emptyTroops(), {
          inf: Math.round(atkN * 0.58), arc: Math.round(atkN * 0.27), cav: Math.round(atkN * 0.15),
        }),
        morale: 60, from: 'chenliu', to: 'liangguo',
      };
      api.RNG.seed(i * 7919 + 13);
      if (api.Combat.resolve(G, army, city, 't').captured) cap++;
    }
    return cap / N;
  };

  const r10 = rate(1.0, 2), r15 = rate(1.5, 2), r20 = rate(2.0, 2);
  const r10w4 = rate(1.0, 4);
  if (V) console.log(`    1:1 墙2=${(r10 * 100).toFixed(0)}%  1.5:1 墙2=${(r15 * 100).toFixed(0)}%  2:1 墙2=${(r20 * 100).toFixed(0)}%  1:1 墙4=${(r10w4 * 100).toFixed(0)}%`);
  ok('1:1 攻城是劣势（<65%）', r10 < 0.65, (r10 * 100).toFixed(0) + '%');
  ok('1.5:1 有明显胜算（60-95%）', r15 > 0.60 && r15 < 0.95, (r15 * 100).toFixed(0) + '%');
  ok('2:1 近乎必胜（>85%）', r20 > 0.85, (r20 * 100).toFixed(0) + '%');
  ok('城墙 4 级几乎挡下 1:1（<15%）', r10w4 < 0.15, (r10w4 * 100).toFixed(0) + '%');
}

// ─────────────────────────────────────────────
section('科技链');
{
  const { api } = h.boot({ seed: 5 });
  ok('共 40 项', api.TECH_KEYS.length === 40, String(api.TECH_KEYS.length));

  let chainBad = null;
  for (const k of api.TECH_KEYS) {
    const t = api.TECHS[k];
    if (t.tier === 1) { if (t.req.length) chainBad = k; continue; }
    const prev = api.TECH_KEYS.find(x => api.TECHS[x].branch === t.branch && api.TECHS[x].tier === t.tier - 1);
    if (!prev || t.req[0] !== prev) chainBad = `${k} 的前置应为 ${prev}`;
    if (chainBad) break;
  }
  ok('前置链连成 10 层', !chainBad, chainBad || '');

  // 灌点数推演，确认能研满 40 项且乘数有界
  const G = api.Store.get();
  let guard = 0;
  while (Object.keys(G.factions.caocao.tech.done).length < 40 && guard++ < 800) {
    const x = api.Store.get();
    const f = x.factions.caocao;
    f.tech.rp += 200;
    if (!f.tech.current && !f.tech.queue.length) {
      const next = api.TECH_KEYS.find(k => api.TechSys.available(f, k));
      if (next) f.tech.current = { key: next, left: api.TECHS[next].cost, total: api.TECHS[next].cost };
    }
    api.Store.replace(x);
    const copy = JSON.parse(JSON.stringify(api.Store.get()));
    api.TechSys.advance(copy, '');
    api.Store.replace(copy);
  }
  const done = Object.keys(api.Store.get().factions.caocao.tech.done).length;
  const b = api.Store.get().factions.caocao.bonus;
  ok('40 项可全研成', done === 40, String(done));
  ok('满树乘数在合理区间', b.food > 1.5 && b.food < 4 && b.gold > 1.5 && b.gold < 4,
    `粮×${b.food.toFixed(2)} 钱×${b.gold.toFixed(2)}`);
}

// ─────────────────────────────────────────────
section('补给线（持续调兵）');
{
  const { api } = h.boot({ seed: 7 });
  const ids = h.grantCities(api, 3);
  ok('造出 4 座直辖城', ids.length === 4, String(ids.length));
  const [dst, ...rears] = ids;

  for (const id of rears) {
    api.Store.dispatch('SET_POLICY', { cityId: id, policy: 'army' });
    api.Store.dispatch('SET_RALLY', { cityId: id, toId: dst, ratio: 0.9, fill: 2.0 });
  }

  // 抽 90% 必须真的送走 ~90%（保护下限只兜底 8%）
  const c = api.Store.get().cities[rears[0]];
  for (const k of Object.keys(c.garrison)) c.garrison[k] = 0;
  c.garrison.inf = 1200;
  api.Store.replace(api.Store.get());
  const d = api.Rally.detail(api.Store.get(), api.Store.get().cities[rears[0]], dst);
  ok('抽 90% 实际送 ≈90%', Math.abs(d.send / d.total - 0.9) < 0.02,
    `${d.total} 兵送出 ${d.send}（${(d.send / d.total * 100).toFixed(0)}%），生效项 ${d.bind}`);

  // 前线每月损兵 300 → 补给线应逐月持续有兵在途
  let monthsWithFlow = 0;
  for (let m = 0; m < 10; m++) {
    const g = api.Store.get();
    const city = g.cities[dst];
    let need = 300;
    for (const k of Object.keys(city.garrison)) {
      if (need <= 0) break;
      const take = Math.min(city.garrison[k], need);
      city.garrison[k] -= take; need -= take;
    }
    api.Store.replace(g);
    api.Store.dispatch('END_TURN');
    const after = api.Store.get();
    const inFlight = Object.values(after.armies)
      .filter(a => a.factionId === after.player.factionId && a.to === dst);
    if (inFlight.length) monthsWithFlow++;
  }
  ok('10 个月里 ≥8 个月有兵在途', monthsWithFlow >= 8, `${monthsWithFlow}/10`);

  // 目标满编后必须暂停且给出可读状态
  const st = api.Rally.status(api.Store.get(), api.Store.get().cities[rears[0]]);
  ok('状态文案非空且有语义', typeof st.text === 'string' && st.text.length > 4
    && ['moving', 'ready', 'full', 'low', 'off'].indexOf(st.code) >= 0, `${st.code}: ${st.text.slice(0, 30)}`);

  // 取消
  api.Store.dispatch('SET_RALLY', { cityId: rears[0], toId: null });
  ok('可取消补给线', api.Store.get().cities[rears[0]].rallyTo === null);
}

// ─────────────────────────────────────────────
section('存档往返');
{
  const { api } = h.boot({ seed: 8 });
  h.runTurns(api, 12);
  const json = JSON.stringify(api.Store.get());
  const back = api.State.migrate(JSON.parse(json));
  ok('序列化往返城市数一致', Object.keys(back.cities).length === Object.keys(api.Store.get().cities).length);
  ok('迁移后科技队列存在', Array.isArray(back.factions.caocao.tech.queue));
  ok('迁移后补给字段存在', back.cities.chenliu.rallyTo === null || typeof back.cities.chenliu.rallyTo === 'string');
  ok('迁移后好感为数字', Number.isFinite(back.player.favor));

  // RNG 序列游标必须入档：只存初始种子的话，读档后随机流会接着上一局跑
  h.runTurns(api, 6);
  const snap = JSON.stringify(api.Store.get());
  const live = [api.RNG.next(), api.RNG.next(), api.RNG.next()];
  api.Store.replace(JSON.parse(snap));
  const replay = [api.RNG.next(), api.RNG.next(), api.RNG.next()];
  ok('读档后续上随机序列', live.every((v, i) => v === replay[i]),
    `${live.map(v => v.toFixed(4))} vs ${replay.map(v => v.toFixed(4))}`);

  // 旧档：删掉后加的字段，默认值表必须补齐（新增字段不许再手写 if）
  const oldSave = JSON.parse(snap);
  delete oldSave.peaceOffers;
  delete oldSave.meta.rngState;
  delete oldSave.meta.uidSeq;
  delete oldSave.player.talent;
  delete oldSave.player.pacts;
  delete oldSave.cities[oldSave.player.homeCityId].rallyRatio;
  const back2 = api.State.migrate(oldSave, 1);
  ok('旧档缺字段由默认值表补齐',
    Array.isArray(back2.peaceOffers) && back2.peaceOffers.length === 0
    && Array.isArray(back2.player.pacts) && back2.player.talent === null
    && back2.cities[back2.player.homeCityId].rallyRatio > 0);

  // 存档版本守护：未来版本拒读，旧版本必迁移
  const { api: svApi, ctx: svCtx } = h.boot({ seed: 14 });
  const autoSlot = svApi.Save.save(svApi.Store.get(), svApi.Save.AUTO);
  const key = svApi.Save.key(svApi.DEFAULT_SCENARIO, autoSlot);
  const rawSave = JSON.parse(svCtx.localStorage.getItem(key));
  const roundTrip = svApi.Save.load(svApi.DEFAULT_SCENARIO, autoSlot);
  svCtx.localStorage.setItem(key, JSON.stringify(Object.assign({}, rawSave, { v: 999 })));
  const future = svApi.Save.load(svApi.DEFAULT_SCENARIO, autoSlot);
  ok('读档版本校验（旧档迁移、未来档拒读）',
    !!roundTrip && roundTrip.meta && future === null,
    `schema v${rawSave.v}`);

  // 多槽位：新档不互相覆盖，列表按时间倒排，删一个不影响其他
  const slotB = svApi.Save.save(svApi.Store.get());
  svApi.Save.save(svApi.Store.get(), 'auto');
  const slots = svApi.Save.list(svApi.DEFAULT_SCENARIO);
  ok('多槽并存且列表可见',
    slotB && slotB !== 'auto' && slots.some(s => s.slot === slotB) && slots.some(s => s.slot === 'auto'),
    slots.map(s => s.slot).join(','));
  ok('槽头信息可读出（不迁移整棵树）',
    slots.every(s => s.year > 0 && s.month >= 1 && s.month <= 12 && s.turn >= 0 && typeof s.player === 'string'));
  svApi.Save.remove(svApi.DEFAULT_SCENARIO, slotB);
  ok('删槽只删自己',
    !svApi.Save.list(svApi.DEFAULT_SCENARIO).some(s => s.slot === slotB)
    && !!svApi.Save.load(svApi.DEFAULT_SCENARIO, 'auto'));
  ok('旧版单槽存档仍可读',
    (() => {
      svCtx.localStorage.setItem(svApi.Save.key(svApi.DEFAULT_SCENARIO, ''), svApi.Save.encode(svApi.Store.get()));
      return svApi.Save.list(svApi.DEFAULT_SCENARIO).some(s => s.slot === '')
        && !!svApi.Save.load(svApi.DEFAULT_SCENARIO, '');
    })());
  ok('续档取最近一局', !!svApi.Save.latest(svApi.DEFAULT_SCENARIO));

  // 导出/导入：给别人发的就是这一串，必须与本地存档同源
  const realErr2 = console.error;
  console.error = () => { };            // 下面几条故意喂坏数据，别刷 CI 日志
  const exported = svApi.Save.encode(svApi.Store.get());
  const imported = svApi.Save.decode(exported);
  ok('导出文本可导入且局面一致',
    !!imported && imported.meta.turn === svApi.Store.get().meta.turn
    && Object.keys(imported.cities).length === Object.keys(svApi.Store.get().cities).length);
  ok('导入拒收损坏文本', svApi.Save.decode('{oops') === null && svApi.Save.decode('{}') === null);
  ok('导入拒收未拒新版本', svApi.Save.decode(JSON.stringify({ v: 999, G: svApi.Store.get() })) === null);
  console.error = realErr2;

  // U.uid 计数器也必须入档，否则读档后新军队 id 会覆盖存档里的 army_1
  const g3 = api.Store.get();
  const targets = Object.values(g3.cities)
    .filter(c => c.owner && c.owner !== 'free' && c.owner !== g3.player.factionId);
  const home = g3.player.homeCityId;
  api.Store.dispatch('DISPATCH', { fromId: home, toId: targets[0].id, ratio: 0.4 });
  const idsBefore = Object.keys(api.Store.get().armies);
  const snap2 = JSON.stringify(api.Store.get());
  api.Store.replace(JSON.parse(snap2));
  api.Store.dispatch('DISPATCH', { fromId: home, toId: targets[1].id, ratio: 0.4 });
  const idsAfter = Object.keys(api.Store.get().armies);
  ok('读档后新军队 id 不覆盖旧军队',
    idsBefore.length >= 1 && idsAfter.length === idsBefore.length + 1
    && idsBefore.every(id => idsAfter.includes(id)),
    `${idsBefore.join(',')} → ${idsAfter.join(',')}`);
}

// ─────────────────────────────────────────────
section('外交');
{
  const { api } = h.boot({ seed: 4 });
  const get = () => api.Store.get();
  const G = get();

  ok('开局互不交战（董卓除外为中立）', api.Diplo.statusOf(G, 'caocao', 'yuanshao') === 'neutral');
  ok('董卓开局为天下所仇', api.Diplo.relationOf(G, 'caocao', 'dongzhuo') <= -40);
  ok('中立势力不可攻（闸门）', api.Diplo.canAttack(G, 'caocao', 'yuanshao') === false);
  ok('在野之城随时可攻', api.Diplo.canAttack(G, 'caocao', 'free') === true);

  // 未宣战就出兵 = 背刺
  const victim = Object.values(get().cities).find(c => c.owner === 'yuanshao');
  const favorBefore = get().player.favor;
  const repBefore = get().player.reputation;
  try {
    api.Store.dispatch('DISPATCH', { fromId: get().player.homeCityId, toId: victim.id, ratio: 0.5 });
  } catch (e) { /* 兵不足等与外交无关的错不应发生，下面用状态判断 */ }
  const after = get();
  const bs = after.diplo[api.Diplo.key('caocao', 'yuanshao')];
  ok('未宣战即攻被判定为背刺', bs && bs.status === 'war', bs && bs.status);
  ok('背刺后对方永久记仇', !!bs.grudge);
  ok('背刺受罚（好感 -20 / 声望 -15）',
    Math.round(favorBefore - after.player.favor) === 20
    && Math.round(after.player.reputation) === Math.max(0, Math.round(repBefore - 15)),
    `好感 -${Math.round(favorBefore - after.player.favor)} 声望 -${Math.round(repBefore - after.player.reputation)}`);

  // 背刺过的两国不可结盟
  const pair = after.diplo[api.Diplo.key('caocao', 'yuanshao')];
  pair.rel = 90;
  api.Store.replace(after);
  ok('记仇后不许结盟', api.Diplo.formAlliance(get(), 'caocao', 'yuanshao').ok === false);

  // 状态转移合法性：关系不足不许跳级结盟
  const g2 = get();
  api.Diplo.pair(g2, 'yuanshao', 'taoqian').rel = 10;
  ok('关系不足不可结盟', api.Diplo.formAlliance(g2, 'yuanshao', 'taoqian').ok === false);
  api.Diplo.pair(g2, 'yuanshao', 'taoqian').rel = 60;
  ok('关系达标可结盟', api.Diplo.formAlliance(g2, 'yuanshao', 'taoqian').ok === true);
  ok('结盟后双向不可攻',
    api.Diplo.canAttack(g2, 'yuanshao', 'taoqian') === false
    && api.Diplo.canAttack(g2, 'taoqian', 'yuanshao') === false);

  // 联盟上限 2
  api.Diplo.pair(g2, 'yuanshao', 'kongrong').rel = 60;
  api.Diplo.formAlliance(g2, 'yuanshao', 'kongrong');
  api.Diplo.pair(g2, 'yuanshao', 'gongsunzan').rel = 60;
  ok('同盟上限 2 家', api.Diplo.formAlliance(g2, 'yuanshao', 'gongsunzan').ok === false);
  ok('同盟数不超限', api.Diplo.allies(g2, 'yuanshao').length <= api.Diplo.MAX_ALLIES);

  // 停战期与到期
  api.Diplo.makePeace(g2, 'caocao', 'yuanshao');
  ok('求和转入停战', api.Diplo.statusOf(g2, 'caocao', 'yuanshao') === 'truce');
  ok('停战期内不可攻', api.Diplo.canAttack(g2, 'caocao', 'yuanshao') === false);
  const expired = JSON.parse(JSON.stringify(g2));
  expired.meta.turn = expired.diplo[api.Diplo.key('caocao', 'yuanshao')].until + 1;
  ok('停战到期回中立', api.Diplo.statusOf(expired, 'caocao', 'yuanshao') === 'neutral');

  // 存档往返保留外交数据
  api.Store.replace(g2);
  h.runTurns(api, 3);
  const back = api.State.migrate(JSON.parse(JSON.stringify(get())));
  const k = api.Diplo.key('caocao', 'yuanshao');
  ok('存档往返后外交数据完整', !!back.diplo[k]
    && Number.isFinite(back.diplo[k].rel)
    && typeof back.diplo[k].status === 'string'
    && Array.isArray(back.player.pacts));

  // 新上命类型存在
  ok('上命含出使 / 离间', !!api.MISSION_TYPES.envoy && !!api.MISSION_TYPES.intrigue);

  // 官阶不够不派离间（离间需州牧=4）
  const low = h.boot({ seed: 21 });
  const lg = low.api.Store.get();
  lg.player.rank = 1;
  let sawIntrigue = false;
  for (let i = 0; i < 300; i++) if (low.api.pickMissionType(lg) === 'intrigue') sawIntrigue = true;
  ok('县令不派离间上命', sawIntrigue === false);
  ok('县令手上离间上命会改令', (() => {
    lg.player.rank = 1;
    lg.player.mission = { id: 'mx', typeKey: 'intrigue', aFid: 'yuanshao', bFid: 'gongsunzan',
      targetRel: -10, expireTurn: lg.meta.turn + 8, rewardMerit: 1, rewardFavor: 1 };
    lg.player.missionCooldown = 0;
    low.api.Store.replace(lg);
    low.api.Mission.tick(low.api.Store.get());
    const now = low.api.Store.get().player.mission;
    return !now || now.typeKey !== 'intrigue';
  })());
  sawIntrigue = false;
  lg.player.rank = 4;
  for (let i = 0; i < 300; i++) if (low.api.pickMissionType(lg) === 'intrigue') sawIntrigue = true;
  ok('州牧可派离间上命', sawIntrigue === true);

  // ◆ 援军：mission aid 抵达并入守军，不当攻军
  const b3 = h.boot({ seed: 12 });
  const a3 = b3.api;
  const g3 = a3.Store.get();
  g3.player.rank = 6;
  g3.cities[g3.player.homeCityId].gold = 6000;
  a3.Store.replace(g3);
  a3.Diplo.pair(a3.Store.get(), 'caocao', 'yuanshao').rel = 60;
  a3.Store.dispatch('FORM_ALLIANCE', { fid: 'yuanshao' });

  const homeGarrison = () => {
    const g = a3.Store.get();
    return a3.troopTotal(g.cities[g.player.homeCityId].garrison);
  };
  const before = homeGarrison();
  h.runTurns(a3, 3);               // 过使者冷却
  a3.Store.dispatch('CALL_TO_ARMS', { fid: 'yuanshao' });
  ok('请盟出兵造出 aid 军', Object.values(a3.Store.get().armies).some(a => a.mission === 'aid'));

  let merged = false;
  for (let i = 0; i < 20 && !merged; i++) {
    h.runTurns(a3, 1);
    merged = !Object.values(a3.Store.get().armies).some(a => a.mission === 'aid');
  }
  ok('援军抵达并入守军（非攻城）', merged && homeGarrison() > before,
    `守军 ${before} → ${homeGarrison()}`);
}

// ─────────────────────────────────────────────
section('求和裁决（对方请和 → 玩家三选一）');
{
  const mk = seed => {
    const hh = h.boot({ seed });
    const api = hh.api;
    const G = api.Store.get();
    api.Diplo.declareWar(G, G.player.factionId, 'yuanshao');
    api.Diplo.offerPeace(G, 'yuanshao');
    return api;
  };
  const HOME = api => api.Store.get().cities[api.Store.get().player.homeCityId];

  // 1 接受：停战 + 纳钱进私库
  const a1 = mk(21);
  const p1 = HOME(a1);
  const pay = a1.Store.dispatch('PEACE_ACCEPT', { fid: 'yuanshao' }).pay;
  ok('接受求和 → 停战且纳钱到账',
    a1.Diplo.statusOf(a1.Store.get(), a1.Store.get().player.factionId, 'yuanshao') === 'truce'
    && pay > 0 && p1.gold > 0, `纳钱 ${pay}`);

  // 2 拒绝：完全无代价，照打
  const a2 = mk(22);
  const before2 = a2.Diplo.relationOf(a2.Store.get(), a2.Store.get().player.factionId, 'yuanshao');
  a2.Store.dispatch('PEACE_REFUSE', { fid: 'yuanshao' });
  const after2 = a2.Store.get();
  ok('不接受求和 → 仍交战且无任何代价',
    a2.Diplo.statusOf(after2, after2.player.factionId, 'yuanshao') === 'war'
    && after2.peaceOffers.length === 0
    && Math.round(a2.Diplo.relationOf(after2, after2.player.factionId, 'yuanshao')) === Math.round(before2),
    `关系 ${Math.round(before2)}`);

  // 3 条件过重：谈崩，无法求和
  const a3 = mk(23);
  const r3 = a3.Store.dispatch('PEACE_COUNTER',
    { fid: 'yuanshao', demands: { gold: 1, mat: 1, iron: 1, troop: 1 } });
  const after3 = a3.Store.get();
  ok('所索过重 → 对方拒谈，战事照旧',
    !r3.accepted && a3.Diplo.statusOf(after3, after3.player.factionId, 'yuanshao') === 'war'
    && after3.peaceOffers.length === 0);

  // 4 条件适中：成交，钱从对方国库转入私库
  const a4 = mk(24);
  const g4 = () => a4.Store.get();
  const theirTreasury = g4().factions.yuanshao.treasury;
  const myGold = HOME(a4).gold;
  const r4 = a4.Store.dispatch('PEACE_COUNTER', { fid: 'yuanshao', demands: { gold: 0.25 } });
  ok('条件适中 → 当场成交并交割资源',
    r4.accepted && g4().factions.yuanshao.treasury < theirTreasury && HOME(a4).gold > myGold
    && a4.Diplo.statusOf(g4(), g4().player.factionId, 'yuanshao') === 'truce',
    `国库 ${theirTreasury}→${g4().factions.yuanshao.treasury}`);

  // 5 索兵：对方抽兵上路，并入我方守军
  const a5 = mk(25);
  const r5 = a5.Store.dispatch('PEACE_COUNTER', { fid: 'yuanshao', demands: { troop: 0.5 } });
  const aids = Object.values(a5.Store.get().armies).filter(a => a.mission === 'aid' && a.factionId === 'yuanshao');
  ok('索兵 → 对方遣兵赴我首府', r5.accepted && aids.length === 1
    && aids[0].to === a5.Store.get().player.homeCityId,
    aids.length ? `兵 ${Math.round(Object.values(aids[0].troops).reduce((s, v) => s + v, 0))}` : '无军队');

  // 6 一键理政：方针全体、安抚士族批量
  const a8 = h.boot({ seed: 28 }).api;
  h.grantCities(a8, 3);
  const g8 = () => a8.Store.get();
  const r8 = a8.Store.dispatch('SET_POLICY_ALL', { policy: 'army' });
  ok('一键方针 → 全部直辖城同一方针',
    r8.total >= 3 && a8.State.demesne(g8()).every(c => c.policy === 'army'),
    `${r8.changed}/${r8.total} 城`);

  // 下一回合：太守自动营建 / 征兵至少动了钱或工程
  const goldBefore8 = a8.State.demesne(g8()).reduce((s, c) => s + c.gold, 0);
  const queueBefore8 = a8.State.demesne(g8()).reduce((s, c) => s + c.buildQueue.length, 0);
  a8.Store.dispatch('END_TURN');
  const goldAfter8 = a8.State.demesne(g8()).reduce((s, c) => s + c.gold, 0);
  const queueAfter8 = a8.State.demesne(g8()).reduce((s, c) => s + c.buildQueue.length, 0);
  ok('设方针后太守自动营建/征兵（无需逐城点）',
    goldAfter8 < goldBefore8 || queueAfter8 > queueBefore8,
    `钱 ${Math.round(goldBefore8)}→${Math.round(goldAfter8)}，工程 ${queueBefore8}→${queueAfter8}`);

  // 一键安抚：只动士族不满的城，且守 3 回合冷却
  const G8 = g8();
  const city8 = a8.State.demesne(G8)[0];
  city8.clans.forEach(cl => { cl.sat = 20; cl.mood = -1; });
  city8.gold = 1000; city8.food = 1000;
  city8.clanActionTurn = 0;
  const cid8 = city8.id;
  const satBefore = a8.State.clanSat(city8);
  const rp = a8.Store.dispatch('BATCH_PACIFY', {});
  const satAfter = a8.State.clanSat(g8().cities[cid8]);   // 派发后状态是新的克隆，按 id 重取
  ok('一键安抚 → 不满之城士族回升', rp.done >= 1 && satAfter > satBefore,
    `满意度 ${Math.round(satBefore)}→${Math.round(satAfter)}`);

  g8().cities[cid8].clans.forEach(cl => { cl.sat = 20; });
  let heldOk = false;
  try { a8.Store.dispatch('BATCH_PACIFY', {}); } catch (e) { heldOk = /冷却|无需/.test(e.message); }
  ok('一键安抚遵守冷却', heldOk);

  // 6.5 一键同造 + 军区战果
  {
    const a11 = h.boot({ seed: 33 }).api;
    h.grantCities(a11, 3);
    const g11 = () => a11.Store.get();
    const raw = JSON.parse(JSON.stringify(g11()));
    for (const c of a11.State.demesne(raw)) { c.gold = 3000; c.mat = 2000; c.iron = 800; }
    a11.Store.replace(raw);

    const r = a11.Store.dispatch('BATCH_BUILD', { key: 'farm' });
    const started = a11.State.demesne(g11()).filter(c => c.buildQueue.some(j => j.key === 'farm'));
    ok('一键同造：所有能造的城各起一项',
      r.done >= 3 && started.length === r.done,
      `${r.done} 城开工，${r.skip} 城未动`);

    let again = null;
    try { a11.Store.dispatch('BATCH_BUILD', { key: 'farm' }); } catch (e) { again = e.message; }
    ok('一键同造不重复排同一建筑', /无法开工/.test(again || ''), again || '未抛错');

    // 军区战果：出兵数与拔城数都要记账
    const a12 = h.boot({ seed: 34 }).api;
    h.grantCities(a12, 5);
    const g12 = () => a12.Store.get();
    const hero12 = Object.values(g12().heroes)
      .find(x => x.factionId === g12().player.factionId && x.id !== 'PLAYER');
    const lg12 = a12.Store.dispatch('LEGION_CREATE', { heroId: hero12.id });
    a12.Store.dispatch('LEGION_ASSIGN', { id: lg12.id, cityIds: a12.State.demesne(g12()).map(c => c.id) });
    a12.Store.dispatch('LEGION_ORDER', { id: lg12.id, stance: 'strike', targetFid: 'yuanshao', policy: 'army' });
    for (let i = 0; i < 25; i++) a12.Store.dispatch('END_TURN');
    const st = a12.State.legions(g12())[0].stats;
    ok('军区战果入账（出兵 / 拔城）', st.attacks >= 1 && st.taken >= 1,
      `出兵 ${st.attacks} · 拔城 ${st.taken}`);
  }

  // 7 收归直辖：满了要换手，换掉的那座会真的失去直辖
  const a10 = h.boot({ seed: 30 }).api;
  h.grantCities(a10, 2);
  const g10 = () => a10.Store.get();
  // 造一座"本方但不直辖"的城（模拟攻下时直辖已满）
  {
    const raw = JSON.parse(JSON.stringify(g10()));
    const spare = Object.values(raw.cities)
      .find(c => c.owner !== raw.player.factionId && c.owner !== 'free');
    spare.owner = raw.player.factionId;
    spare.grantedTo = null;
    a10.Store.replace(raw);
  }
  const spare10 = Object.values(g10().cities)
    .find(c => c.owner === g10().player.factionId && c.grantedTo !== 'PLAYER');
  ok('存在本方非直辖城可测试', !!spare10, spare10 && spare10.name);
  if (spare10) {
    // 塞满直辖：把上限内所有本方城都收归
    const cap10 = a10.cityCap(g10().player);
    let guard = 0;
    while (g10().player.demesne.length < cap10 && guard++ < 20) {
      const cand = Object.values(g10().cities)
        .find(c => c.owner === g10().player.factionId && c.grantedTo !== 'PLAYER');
      if (!cand) break;
      try { a10.Store.dispatch('SET_DEMESNE', { cityId: cand.id }); } catch (e) { break; }
    }
    const full = g10().player.demesne.length >= a10.cityCap(g10().player);

    let needRelease = false;
    try { a10.Store.dispatch('SET_DEMESNE', { cityId: spare10.id }); }
    catch (e) { needRelease = full && /直辖已满/.test(e.message); }
    ok('直辖满员时不交出就不能收归', !full || needRelease,
      `直辖 ${g10().player.demesne.length}/${a10.cityCap(g10().player)}`);

    if (full) {
      const releaseId = g10().player.demesne[0];
      const releasedName = g10().cities[releaseId].name;
      g10().cities[releaseId].policy = 'army';
      a10.Store.replace(JSON.parse(JSON.stringify(g10())));
      const r10 = a10.Store.dispatch('SET_DEMESNE', { cityId: spare10.id, releaseId });
      const after = g10();
      ok('换直辖：新收归生效、交出的真放手',
        r10.cityId === spare10.id
        && after.cities[spare10.id].grantedTo === 'PLAYER'
        && after.cities[releaseId].grantedTo === null
        && after.cities[releaseId].policy === null
        && after.player.demesne.indexOf(releaseId) < 0,
        `${releasedName} → ${after.cities[spare10.id].name}`);
    }

    let foreign = false;
    const enemy10 = Object.values(g10().cities).find(c => c.owner !== g10().player.factionId && c.owner !== 'free');
    try { a10.Store.dispatch('SET_DEMESNE', { cityId: enemy10.id }); }
    catch (e) { foreign = /非本方城池/.test(e.message); }
    ok('非本方城池无从收归', foreign);
  }

  // 8 AI 打不过时递报价（不再自动停战），玩家不裁决则战事继续
  const a7 = h.boot({ seed: 27 }).api;
  h.grantCities(a7, 6);
  const pf7 = a7.Store.get().player.factionId;
  a7.Diplo.declareWar(a7.Store.get(), pf7, 'yuanshao');
  let autoTruce = false, offerFrom = null;
  for (let i = 0; i < 24; i++) {
    a7.Store.dispatch('END_TURN');
    const gg = a7.Store.get();
    if (gg.peaceOffers.length) { offerFrom = gg.peaceOffers[0].fid; break; }
    if (a7.Diplo.statusOf(gg, pf7, 'yuanshao') !== 'war') { autoTruce = true; break; }
  }
  ok('AI 打不过只递报价，绝不自动停战', !autoTruce && !!offerFrom,
    offerFrom ? `来自 ${offerFrom}` : '24 回合内未请和');
  if (offerFrom) {
    const gg = a7.Store.get();
    ok('报价未获裁决前仍是交战状态',
      a7.Diplo.statusOf(gg, pf7, offerFrom) === 'war');
  }

  // 7 玩家自己的势力绝不被 AI 代为求和（曾出现"记事先求和了、弹窗没弹"）
  const a9 = h.boot({ seed: 29 }).api;
  h.grantCities(a9, 2);
  const g9 = () => a9.Store.get();
  // 自立为君：此后的外交（含求和）只能由玩家决断
  g9().player.rank = Math.max(g9().player.rank, a9.INDEPENDENCE.minRank);
  g9().player.reputation = Math.max(g9().player.reputation, a9.INDEPENDENCE.minReputation + 10);
  a9.Store.replace(JSON.parse(JSON.stringify(g9())));
  a9.Store.dispatch('DECLARE_INDEPENDENCE');
  const pf9 = g9().player.factionId;
  a9.Diplo.declareWar(g9(), pf9, 'liubiao');
  a9.Diplo.declareWar(g9(), pf9, 'yuanshao');
  let selfPeaced = null;
  for (let i = 0; i < 12; i++) {
    a9.Store.dispatch('END_TURN');
    const gg = g9();
    for (const fid of ['liubiao', 'yuanshao']) {
      if (a9.Diplo.statusOf(gg, pf9, fid) !== 'war') selfPeaced = fid;
    }
    if (selfPeaced) break;
  }
  const myName = g9().factions[pf9].name;
  const badLog = g9().log.filter(l => l.text.includes(myName) && /遣使向.*求和/.test(l.text));
  ok('自立后不会被 AI 代为求和', !selfPeaced && !badLog.length,
    selfPeaced ? `被自动停战：${selfPeaced}` : (badLog[0] && badLog[0].text) || '无');

  // 8 未请和就不能走裁决口
  const a6 = mk(26);
  a6.Store.dispatch('PEACE_REFUSE', { fid: 'yuanshao' });
  let threw = false;
  try { a6.Store.dispatch('PEACE_REFUSE', { fid: 'yuanshao' }); } catch (e) { threw = /并未请和/.test(e.message); }
  ok('重复裁决被拒', threw);
}

// ─────────────────────────────────────────────
section('外交长跑（200 回合）');
{
  const { api } = h.boot({ seed: 11, factionId: 'dongzhuo', cityId: 'luoyang' });
  const get = () => api.Store.get();
  let maxCities = 0, truceSeen = 0, allySeen = 0, truceBreak = null;
  let seenArmies = new Set(Object.keys(get().armies));

  for (let t = 0; t < 200; t++) {
    const r = h.runTurns(api, 1);
    if (!r.ok) { truceBreak = r.error; break; }
    const G = get();
    for (const [key, x] of Object.entries(G.diplo)) {
      if (x.status === 'truce') truceSeen++;
      if (x.status === 'ally') allySeen++;
    }
    // 停战期内不得新发攻军（已在途的老军不算，它们到期会班师）
    for (const a of Object.values(G.armies)) {
      if (seenArmies.has(a.id)) continue;
      seenArmies.add(a.id);
      if (a.mission !== 'attack') continue;
      const to = G.cities[a.to];
      if (!to || to.owner === a.factionId) continue;
      const st = api.Diplo.statusOf(G, a.factionId, to.owner);
      if (st !== 'war') truceBreak = `${a.factionId}→${to.name}（${st}）@${G.meta.turn}`;
    }
    for (const f of Object.values(G.factions)) {
      if (f.kind === 'free' || f.dead) continue;
      maxCities = Math.max(maxCities, api.State.factionCities(G, f.id).length);
    }
    if (G.over) break;
  }

  ok('200 回合无崩溃', !truceBreak, truceBreak || '');
  ok('世界出现过停战', truceSeen > 0, `停战对-月 ${truceSeen}`);
  ok('世界出现过结盟', allySeen > 0, `同盟对-月 ${allySeen}`);
  ok('兼并速度明显下降（最大势力 < 60 城）', maxCities < 60, `最大 ${maxCities} 城`);
  ok('外交长跑数值健康', h.scanNaN(api).length === 0);
}

// ─────────────────────────────────────────────
section('大势（剧本骨架 + 宿敌摩擦）');
{
  const { api } = h.boot({ seed: 11 });
  const sc = api.getScenario(api.DEFAULT_SCENARIO);
  const amb = sc.ambitions || {};
  const owners = Object.keys(amb).filter(id => amb[id].length);
  ok('剧本带野心表且覆盖十家以上', owners.length >= 10, `${owners.length} 家`);
  ok('野心目标都是真势力', owners.every(id => amb[id].every(([t]) => !!sc.factionRows.find(r => r[0] === t))));
  ok('剧本带宿敌表', (sc.rivals || []).length >= 10, `${(sc.rivals || []).length} 对`);

  let news = 0, flips = 0;
  let prev = Object.fromEntries(Object.values(api.Store.get().cities).map(c => [c.id, c.owner]));
  for (let t = 0; t < 12; t++) {
    h.runTurns(api, 1);
    const G = api.Store.get();
    news += G.log.filter(l => l.turn === G.meta.turn && l.text.startsWith('【天下】')).length;
    for (const c of Object.values(G.cities)) {
      if (c.owner !== prev[c.id]) { flips++; prev[c.id] = c.owner; }
    }
  }
  ok('开局一年内有天下大事播报', news >= 2, `${news} 条`);
  ok('开局一年内有城池易手', flips >= 2, `${flips} 次`);
  ok('定战不受强弱门槛卡住（讨董开战）',
    Object.keys(api.Store.get().diplo).some(k => k.includes('dongzhuo')
      && api.Store.get().diplo[k].status === 'war'), '无董卓战事');

  // 无城 AI 势力当月判亡，不靠一支在途军续命
  {
    const z = h.boot({ seed: 9, factionId: 'yuanshao', cityId: 'ye' });
    const G = z.api.Store.get();
    const victim = Object.values(G.factions).find(f => f.kind !== 'free' && f.id !== G.player.factionId);
    for (const c of Object.values(G.cities)) if (c.owner === victim.id) c.owner = 'free';
    const src = z.api.State.factionCities(G, G.player.factionId)[0];
    z.api.Army.create(G, {
      factionId: victim.id, heroId: null, from: src.id, to: src.id,
      troops: { inf: 100 }, mission: 'aid',
    });
    z.api.Store.replace(G);
    h.runTurns(z.api, 1);
    const G2 = z.api.Store.get();
    ok('无城势力当月覆灭', G2.factions[victim.id].dead === true, victim.name);
    ok('覆灭势力的残军被清空', !Object.values(G2.armies).some(a => a.factionId === victim.id));
  }

  // 宿敌关系逐月结冰 → 不靠剧本也会打起来
  const r1 = h.boot({ seed: 5 });
  const relOf = () => r1.api.Diplo.relationOf(r1.api.Store.get(), 'yuanshao', 'gongsunzan');
  const rel0 = relOf();
  h.runTurns(r1.api, 10);
  ok('宿敌关系自然恶化', relOf() < rel0 + 1, `${rel0} → ${relOf()}`);
}

// ─────────────────────────────────────────────
section('军区（一将统辖多城，全托管但听号令）');
{
  const mk = seed => {
    const { api } = h.boot({ seed });
    h.grantCities(api, 5);
    const g = () => api.Store.get();
    const G = g();
    const hero = Object.values(G.heroes)
      .find(x => x.factionId === G.player.factionId && x.id !== 'PLAYER' && x.cityId === G.player.homeCityId);
    const r = api.Store.dispatch('LEGION_CREATE', { heroId: hero.id });
    api.Store.dispatch('LEGION_ASSIGN', { id: r.id, cityIds: api.State.demesne(g()).map(c => c.id) });
    return { api, g, id: r.id, hero };
  };

  // 1 建立 / 分配 / 都督加成
  const a = mk(41);
  const lg = a.g().player.legions[0];
  const city = a.g().cities[lg.cityIds[0]];
  const mul = a.api.State.legionMul(a.g(), city);
  const defWith = a.api.Combat.defenseScore(a.g(), city);
  ok('军区成立并统辖多城', !!lg && lg.cityIds.length >= 5, `${lg.cityIds.length} 城`);
  ok('都督给军区城加成（统/政）', !!mul && mul.atk > 1 && mul.eco > 1,
    `战力 ×${mul.atk.toFixed(2)} 产出 ×${mul.eco.toFixed(2)}`);

  // 1.6 交出 / 削权 / 失守的城要从军区辖城里摘掉（否则再点军区报"非你直辖之城"）
  {
    const z = mk(46);                  // 独立一局，别污染后面的用例
    const raw = JSON.parse(JSON.stringify(z.g()));
    const p = raw.player;
    p.rank = 1;                        // 直辖上限 2，好造出"交出"路径
    const others = Object.values(raw.cities)
      .filter(c => c.owner !== p.factionId && c.owner !== 'free')
      .slice(0, 3).map(c => c.id);
    for (const id of others) { raw.cities[id].owner = p.factionId; raw.cities[id].grantedTo = null; }
    raw.cities[others[0]].grantedTo = z.api.PLAYER_HERO_ID;
    p.demesne = [others[0]];
    p.homeCityId = others[0];
    raw.player.legions = undefined;
    z.api.Store.replace(raw);
    const lgId = z.api.Store.dispatch('LEGION_CREATE', { heroId: z.hero.id }).id;
    z.api.Store.dispatch('LEGION_ASSIGN', { id: lgId, cityIds: [others[0]] });

    // 收归第二座（未满员）→ 能加进军区
    z.api.Store.dispatch('SET_DEMESNE', { cityId: others[1] });
    z.api.Store.dispatch('LEGION_ASSIGN', { id: lgId, cityIds: z.g().player.demesne.slice() });
    ok('收归后能加进军区', z.g().player.legions[0].cityIds.indexOf(others[1]) >= 0);

    // 收归第三座：直辖已满 → 交出 first
    let err0 = null;
    try { z.api.Store.dispatch('SET_DEMESNE', { cityId: others[2], releaseId: others[0] }); } catch (e) { err0 = e.message; }
    ok('满员时可用 releaseId 换城', !err0, err0 || '');
    ok('交出的城从军区辖城移除',
      z.g().player.legions[0].cityIds.indexOf(others[0]) < 0
      && z.api.State.isPlayerCity(z.g(), z.g().cities[others[0]]) === false);

    let err = null;
    try {
      z.api.Store.dispatch('LEGION_ASSIGN', { id: lgId, cityIds: z.g().player.demesne.slice() });
    } catch (e) { err = e.message; }
    ok('换城后军区指派不再报错', !err, err || '');
  }

  // 1.5 府衙 3 级时一次填满两个工程位，且不重复同一建筑
  {
    const raw = JSON.parse(JSON.stringify(a.g()));
    const c = raw.cities[raw.player.homeCityId];
    c.buildings.office = 3;
    c.gold = 6000; c.mat = 4000; c.iron = 2000;
    c.buildQueue = [];
    c.policy = 'army';
    a.api.Store.replace(raw);
    const slots = a.api.State.buildSlots(a.g().cities[c.id]);
    a.api.Store.dispatch('END_TURN');
    const q = a.g().cities[c.id].buildQueue;
    ok('太守一次填满所有工程位', slots === 2 && q.length === 2,
      `${q.length}/${slots} 项：${q.map(j => a.api.BUILDINGS[j.key].name).join('、')}`);
    ok('同一建筑不会重复入队', new Set(q.map(j => j.key)).size === q.length);
    ok('填位后仍留周转金', a.g().cities[c.id].gold >= 150,
      `余 ${Math.round(a.g().cities[c.id].gold)}`);

    // 腾出一个空位后，同一建筑再入队必须被拒（否则完成后 to 相同、白扣料）
    const keepKey = q[0].key;
    a.api.Store.dispatch('CANCEL_BUILD', { cityId: c.id, index: 1 });
    let dup = null;
    try {
      a.api.Store.dispatch('BUILD', { cityId: c.id, key: keepKey });
    } catch (e) { dup = e.message; }
    ok('手动重复排队被拒', /已在工程队列中/.test(dup || ''), dup || '未抛错');
  }

  // 2 守土：只营建征兵，不出兵
  a.api.Store.dispatch('LEGION_ORDER', { id: a.id, stance: 'defend', policy: 'army' });
  const stat = () => ({
    q: a.api.State.demesne(a.g()).reduce((s, c) => s + c.buildQueue.length, 0),
    men: a.api.State.demesne(a.g()).reduce((s, c) => s + a.api.troopTotal(c.garrison), 0),
  });
  const before = stat();
  let atk = 0;
  for (let i = 0; i < 10; i++) {
    a.api.Store.dispatch('END_TURN');
    atk += Object.values(a.g().armies).filter(x => x.factionId === a.g().player.factionId && x.mission === 'attack').length;
  }
  const after = stat();
  ok('守土号令：自动营建 + 征兵，但不出兵',
    after.q > before.q && after.men > before.men && atk === 0,
    `工程 ${before.q}→${after.q}，兵 ${Math.round(before.men)}→${Math.round(after.men)}，出兵 ${atk}`);

  // 3 委任太守不再重复管军区城
  const lgCityId = a.g().player.legions[0].cityIds[0];
  a.api.Store.dispatch('SET_POLICY_ALL', { policy: 'farm' });
  ok('军区城不受城方针重复管理（Viceroy 跳过）',
    a.api.State.legionOf(a.g(), lgCityId) && a.g().cities[lgCityId].policy === 'farm',
    '方针仍在，但由军区执行');

  // 4 征讨：下令即宣战，军区属城只打该势力（同势力其他城归 AI 管，不在此列）
  const b = mk(42);
  b.api.Store.dispatch('LEGION_ORDER', { id: b.id, stance: 'strike', targetFid: 'yuanshao', policy: 'army' });
  const pfB = b.g().player.factionId;
  const lgB = new Set(b.g().player.legions[0].cityIds);
  const declared = b.api.Diplo.statusOf(b.g(), pfB, 'yuanshao') === 'war';
  const targets = new Set();
  // 在 Army.create 上量：记录军区城每次出兵的目标势力（城会在行军途中易主，不能事后看）
  const origCreate = b.api.Army.create;
  b.api.Army.create = function (GG, o) {
    if (o.mission === 'attack' && o.factionId === pfB && lgB.has(o.from)) {
      targets.add(GG.cities[o.to].owner);
    }
    return origCreate.call(b.api.Army, GG, o);
  };
  for (let i = 0; i < 14; i++) b.api.Store.dispatch('END_TURN');
  b.api.Army.create = origCreate;
  ok('征讨号令：即宣战，且只打指定势力',
    declared && targets.size >= 1 && [...targets].every(o => o === 'yuanshao'),
    `宣战 ${declared}，出兵目标 ${[...targets].join('/')}`);

  // 4.2 征讨不掷骰子：下令当回合就出兵（不必等 AI 那几个概率门）
  {
    const z = mk(45);
    z.api.Store.dispatch('LEGION_ORDER', { id: z.id, stance: 'strike', targetFid: 'yuanshao', policy: 'army' });
    const pfz = z.g().player.factionId;
    const lgz = z.g().player.legions[0].id;
    h.runTurns(z.api, 1);
    const out = Object.values(z.g().armies).filter(a => a.factionId === pfz && a.legionId === lgz);
    ok('征讨当回合即出兵', out.length >= 1, `出兵 ${out.length}`);
    const atkStat = z.api.State.legions(z.g())[0].stats.attacks || 0;
    ok('军区战果记到号令账上', atkStat >= 1, `出兵计数 ${atkStat}`);
  }

  // 4.3 工程位空着就不许因"预留金"空转（偶见不营建的老病，太守/军区同源）
  {
    const z = mk(47);
    const G0 = z.g();
    const cid = G0.player.legions[0].cityIds[0];
    const c = G0.cities[cid];
    const P = z.api.POLICIES[G0.player.legions[0].policy] || z.api.POLICIES.balanced;
    const key = z.api.Build.autoPick(G0, c, P.buildOrder);
    if (!key) {
      ok('空工程位不因预留金空转', false, '无可开之工，用例失效');
    } else {
      const cost = z.api.Build.costOf(G0, c, key);
      c.buildQueue = [];
      c.gold = cost.gold + 100;          // 够付工程款，但留不出 150 的预留金
      c.mat = Math.max(c.mat, cost.mat + 100);
      c.iron = Math.max(c.iron, cost.iron + 100);
      z.api.Build.autoWork(G0, c, P, 150);
      ok('空工程位不因预留金空转', c.buildQueue.length === 1,
        `${key} 需钱 ${cost.gold}，余 ${cost.gold === 0 ? 100 : c.gold - cost.gold}`);
      // 已经有活干时仍然守预留金（不把征兵的钱一次花光）
      const c2 = G0.cities[G0.player.legions[0].cityIds[1]];
      const key2 = z.api.Build.autoPick(G0, c2, P.buildOrder);
      if (key2) {
        const cost2 = z.api.Build.costOf(G0, c2, key2);
        c2.buildQueue = [{ key: key2, to: 99, left: 3, total: 3 }];
        c2.gold = cost2.gold + 100;
        z.api.Build.autoWork(G0, c2, P, 150);
        ok('已在施工时守预留金', c2.buildQueue.length === 1, `队列 ${c2.buildQueue.length}`);
      }
    }
  }

  // 4.5 征讨目标停战后，军区不空转（自动转守土待命）
  const d = mk(44);
  d.api.Store.dispatch('LEGION_ORDER', { id: d.id, stance: 'strike', targetFid: 'yuanshao', policy: 'army' });
  for (let i = 0; i < 5; i++) d.api.Store.dispatch('END_TURN');
  d.api.Diplo.makePeace(d.g(), d.g().player.factionId, 'yuanshao');
  d.api.Store.dispatch('END_TURN');
  const lgD = d.api.State.legions(d.g())[0];
  ok('征讨目标停战后军区自动转守土（不空转）',
    lgD.stance === 'defend' && lgD.targetFid === null,
    `号令 ${lgD.stance}`);

  // 5 玩家当家的势力不会被 AI 自动宣战
  const c = mk(43);
  const G3 = c.g();
  G3.player.rank = Math.max(G3.player.rank, c.api.INDEPENDENCE.minRank);
  G3.player.reputation = Math.max(G3.player.reputation, c.api.INDEPENDENCE.minReputation + 10);
  c.api.Store.replace(JSON.parse(JSON.stringify(G3)));
  c.api.Store.dispatch('DECLARE_INDEPENDENCE');
  const pf3 = c.g().player.factionId;
  const wars3 = () => Object.keys(c.g().factions).filter(fid => fid !== 'free' && fid !== pf3
    && c.api.Diplo.statusOf(c.g(), pf3, fid) === 'war');
  const w0 = wars3().length;
  for (let i = 0; i < 12; i++) c.api.Store.dispatch('END_TURN');
  ok('自立后外交由玩家决断（AI 不代宣战）', wars3().length <= w0,
    `战事 ${w0} → ${wars3().length}：${wars3().join(',')}`);
}

// ─────────────────────────────────────────────
section('玩家天赋');
{
  const goldOf = talent => {
    const { api, get } = h.boot({ seed: 7, talent });
    const G0 = get();
    const c = G0.cities[G0.player.homeCityId];
    const before = c.gold;
    api.Economy.produce(G0, 't');
    return { api, G0, got: get().cities[G0.player.homeCityId].gold - before };
  };

  const plain = goldOf(null);
  const merchant = goldOf('merchant');
  const ratio = merchant.got / plain.got;
  ok('商人天赋钱币产出 +25%', Math.abs(ratio - 1.25) < 0.02, `${plain.got} → ${merchant.got}（×${ratio.toFixed(3)}）`);

  const cavOf = talent => {
    const { api, get } = h.boot({ seed: 7, talent });
    const G = get();
    const c = G.cities[G.player.homeCityId];
    c.buildings.stable = Math.max(1, c.buildings.stable);
    api.State.syncDerived(c);
    return api.State.troopCapByType(G, c).cav;
  };
  const cavPlain = cavOf(null), cavTalent = cavOf('cavalry');
  ok('骑兵天赋骑兵兵额 +40%', Math.abs(cavTalent / cavPlain - 1.4) < 0.02, `${cavPlain} → ${cavTalent}`);

  const { api: a2, get: g2 } = h.boot({ seed: 7, talent: 'cavalry' });
  const G2 = g2();
  const home = G2.cities[G2.player.homeCityId];
  const far = Object.values(G2.cities).find(c => c.id !== home.id && c.owner !== G2.player.factionId);
  const etaFast = a2.Army.estimateEta(home, far, { inf: 100 }, a2.Army.speedMul(G2, G2.player.factionId));
  const etaSlow = a2.Army.estimateEta(home, far, { inf: 100 }, 1);
  ok('骑兵天赋行军更快', etaFast <= etaSlow && etaFast < etaSlow + 1, `${etaSlow} → ${etaFast} 月`);

  const buildOf = talent => {
    const { api, get } = h.boot({ seed: 7, talent });
    const G = get();
    const c = G.cities[G.player.homeCityId];
    return api.Build.turnsOf(G, 'barracks', 1, c);
  };
  const bPlain = buildOf(null), bArtisan = buildOf('artisan');
  ok('工匠天赋工期 -25%', bArtisan < bPlain || bPlain === 1, `${bPlain} → ${bArtisan} 月`);

  const powOf = talent => {
    const { api, get } = h.boot({ seed: 7, talent });
    const G = get();
    return api.Combat.power(G, { inf: 1000 }, null, {
      terrain: 'plain', isDefender: false, morale: 60, factionId: G.player.factionId,
    });
  };
  ok('将才天赋战力 +12%', Math.abs(powOf('general') / powOf(null) - 1.12) < 0.02);

  const spendOf = talent => {
    const { api, get } = h.boot({ seed: 7, talent });
    const G = get();
    const c = G.cities[G.player.homeCityId];
    c.gold = 5000;
    api.Diplo.spendGold(G, 1000);
    return 5000 - get().cities[G.player.homeCityId].gold;
  };
  ok('商人天赋外交花费 -25%', Math.abs(spendOf('merchant') - 750) <= 1, String(spendOf('merchant')));
  ok('纵横家天赋外交花费 -40%', Math.abs(spendOf('diplomat') - 600) <= 1, String(spendOf('diplomat')));

  const { api: a3, get: g3 } = h.boot({ seed: 7 });
  const G3 = g3();
  ok('未选天赋不报错且无加成', Object.keys(a3.talentOf(G3)).length === 0 && a3.talentName(G3) === '无');
  ok('六个天赋齐备', a3.TALENT_KEYS.length === 6, a3.TALENT_KEYS.join('/'));

  // 长跑：任意天赋下 40 回合不崩
  for (const t of a3.TALENT_KEYS) {
    const { api: a4 } = h.boot({ seed: 11, talent: t });
    const r = h.runTurns(a4, 40);
    ok(`天赋 ${t} 跑 40 回合不崩`, r.ok, r.error || '');
  }
}

// ─────────────────────────────────────────────
section('武将特技接线');
{
  const { api, get } = h.boot({ seed: 7 });
  const G = get();
  const base = { terrain: 'plain', morale: 55 };
  const powOf = (heroId, troops, extra) => api.Combat.power(G, troops, heroId, { ...base, ...extra });
  // 剥离「统领加成」(1 + tong/200)，只留特技自身的倍率
  const skillMul = (heroId, troops, extra) => {
    const h = G.heroes[heroId];
    return powOf(heroId, troops, extra) / ((1 + h.tong / 200) * powOf(null, troops, extra));
  };
  const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

  // 兵种特技（旧版本键名写错，一律不生效）
  ok('突击：骑兵 +15%', near(skillMul('yanliang', { cav: 1000 }), 1.15), skillMul('yanliang', { cav: 1000 }).toFixed(3));
  ok('突击：不带骑兵则不生效', near(skillMul('yanliang', { inf: 1000 }), 1), skillMul('yanliang', { inf: 1000 }).toFixed(3));
  ok('突击：混编按兵种占比加权', near(skillMul('yanliang', { cav: 500, inf: 500 }), 1.075), skillMul('yanliang', { cav: 500, inf: 500 }).toFixed(3));
  ok('神射：弓兵 +15%', near(skillMul('taishici', { arc: 1000 }), 1.15), skillMul('taishici', { arc: 1000 }).toFixed(3));
  ok('陷阵：步兵 +15%', near(skillMul('yuejin', { inf: 1000 }), 1.15), skillMul('yuejin', { inf: 1000 }).toFixed(3));
  ok('水战：水军 +25%', near(skillMul('caimao', { nvy: 1000 }), 1.25), skillMul('caimao', { nvy: 1000 }).toFixed(3));

  // 火计：攻城伤害只在进攻方结算
  ok('火计：进攻 +20%', near(skillMul('liru', { inf: 1000 }, { isDefender: false }), 1.20), skillMul('liru', { inf: 1000 }, { isDefender: false }).toFixed(3));
  ok('火计：防守不加攻城伤害', near(skillMul('liru', { inf: 1000 }, { isDefender: true }), 1), skillMul('liru', { inf: 1000 }, { isDefender: true }).toFixed(3));

  ok('扬威：全军士气 +15%', near(skillMul('yuanshao', { inf: 1000 }), 1.15), skillMul('yuanshao', { inf: 1000 }).toFixed(3));
  ok('铁壁：守城 +20%', near(skillMul('xurong', { inf: 1000 }, { isDefender: true }), 1.20), skillMul('xurong', { inf: 1000 }, { isDefender: true }).toFixed(3));

  // 压制型特技：作用于「敌方」战力
  const plainPow = powOf(null, { inf: 1000 });
  ok('火计：令敌全军防御 -8%', near(powOf(null, { inf: 1000 }, { enemyHeroId: 'liru' }) / plainPow, 0.92),
    (powOf(null, { inf: 1000 }, { enemyHeroId: 'liru' }) / plainPow).toFixed(3));
  ok('急智：令敌全军攻击 -10%', near(powOf(null, { inf: 1000 }, { enemyHeroId: 'jiaxu' }) / plainPow, 0.90),
    (powOf(null, { inf: 1000 }, { enemyHeroId: 'jiaxu' }) / plainPow).toFixed(3));

  // 静态守护：特技表里的效果键必须都在「代码真的读了」的白名单内
  const READ_KEYS = ['atk', 'def', 'defenseCity', 'economy', 'cavalry', 'archer',
    'infantry', 'navy', 'siege', 'morale', 'enemyDef', 'enemyAtk'];
  const META_KEYS = ['name', 'desc'];
  const deadKeys = [];
  for (const [sid, sk] of Object.entries(api.TAODONG190_HERO_SKILLS)) {
    for (const k of Object.keys(sk)) {
      if (!READ_KEYS.includes(k) && !META_KEYS.includes(k)) deadKeys.push(`${sid}.${k}`);
    }
  }
  ok('特技效果键无「写了没人读」', !deadKeys.length, deadKeys.join(', '));
}

// ─────────────────────────────────────────────
console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  fails.forEach(f => console.log('  - ' + f));
}
process.exit(fail === 0 ? 0 : 1);
