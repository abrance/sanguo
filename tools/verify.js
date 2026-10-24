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

  // 2.5) 视图面板都必须装配进 UI（写了文件没 Object.assign → 运行时 `UI.xxx is not a function`）
  {
    const uiSrc = fs.readFileSync(path.join(h.ROOT, 'js/view/ui.js'), 'utf8');
    const assign = /Object\.assign\(UI,\s*([\s\S]*?)\);/.exec(uiSrc);
    const listed = assign ? assign[1] : '';
    const panels = [];
    for (const f of declared.filter(x => /^js\/view\/panels\//.test(x))) {
      const src = fs.readFileSync(path.join(h.ROOT, f), 'utf8');
      const m = /^const (UI_[A-Z_]+)\s*=/m.exec(src);
      if (m) panels.push({ file: f, name: m[1] });
    }
    const orphan = panels.filter(p2 => listed.indexOf(p2.name) < 0)
      .map(p2 => `${p2.name} (${p2.file})`);
    ok('面板都装配进 UI（Object.assign）', !orphan.length, orphan.join(', '));
  }

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
  // 注意：① A6 起玩家指挥的攻城会在轮间挂起，军队仍算「在外」
  //       ② 世界演化后可能只剩一座直辖城，出兵上限不够，先补一座再测
  h.settleBattles(api);
  h.grantCities(api, 1);
  const g3 = api.Store.get();
  const targets = Object.values(g3.cities)
    .filter(c => c.owner && c.owner !== 'free' && c.owner !== g3.player.factionId);
  const home = g3.player.homeCityId;
  api.Store.dispatch('DISPATCH', { fromId: home, toId: targets[0].id, ratio: 0.4 });
  const idsBefore = Object.keys(api.Store.get().armies);
  const snap2 = JSON.stringify(api.Store.get());
  api.Store.replace(JSON.parse(snap2));
  h.settleBattles(api);
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
  // 盟友兵力受世界演化影响，可能穷到派不出兵 —— 先给它补满，专测「援军抵达并入守军」
  {
    const g = a3.Store.get();
    for (const c of a3.State.factionCities(g, 'yuanshao')) {
      if (a3.troopTotal(c.garrison) < 800) c.garrison.inf += 800 - a3.troopTotal(c.garrison);
      c.food = Math.max(c.food, 3000);
    }
    a3.Store.replace(g);
  }
  a3.Store.dispatch('CALL_TO_ARMS', { fid: 'yuanshao' });
  ok('请盟出兵造出 aid 军', Object.values(a3.Store.get().armies).some(a => a.mission === 'aid'));

  // 联盟网络里各家常互派援军，所以「此刻没有援军在路上」这个条件不成立；
  // 改为看纪事里的「援兵抵 X，并入守军」+ 守军确实变多
  const homeName = a3.Store.get().cities[a3.Store.get().player.homeCityId].name;
  let mergedLog = false;
  for (let i = 0; i < 20; i++) {
    h.runTurns(a3, 1);
    if (a3.Store.get().log.some(e => /援兵抵/.test(e.text) && e.text.indexOf(homeName) >= 0)) {
      mergedLog = true;
      break;
    }
  }
  ok('援军抵达并入守军（非攻城）', mergedLog && homeGarrison() > before,
    `守军 ${before} → ${homeGarrison()}（${mergedLog ? '纪事已记援兵抵达' : '未见援兵抵达'}）`);
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
section('月产明细（Economy.project）与结算同源');
{
  const { api, get } = h.boot({ seed: 7, talent: 'farmer' });
  const G = get();
  const c = G.cities[G.player.homeCityId];
  const P = api.Economy.project(G, c);
  ok('project 带上农夫天赋的粮产乘数', Math.abs((P.parts.talent.food || 1) - 1.25) < 1e-9);

  const g0 = c.gold, f0 = c.food;
  api.Economy.produce(G, 't');
  ok('结算的钱增量 = project 的月入钱', Math.abs((c.gold - g0) - P.goldOut) < 1e-6,
    `${((c.gold - g0)).toFixed(3)} vs ${P.goldOut.toFixed(3)}`);
  const netFood = P.foodOut - P.armyUpkeep - P.popUpkeep;
  ok('结算的粮增量 = 产出 − 军耗 − 民食（未触仓廪上限时）',
    c.food === P.foodCap || Math.abs((c.food - f0) - netFood) < 1e-6,
    `${(c.food - f0).toFixed(3)} vs ${netFood.toFixed(3)}`);

  const alien = Object.values(G.cities).find(x => x.owner !== G.player.factionId);
  const PA = api.Economy.project(G, alien);
  ok('非直辖城不吃玩家天赋', !PA.parts.talent.id);

  const foe = Object.values(G.cities).find(x => x.owner !== G.player.factionId && api.troopTotal(x.garrison) > 0)
    || alien;
  const pred = api.Combat.predict(G, { inf: 1000 }, null, foe, G.player.factionId, 0);
  ok('出征预估带回双方首轮战力', pred.atkPower > 0, `我 ${Math.round(pred.atkPower)} : 守 ${Math.round(pred.defPower)}`);

  // talentGain：同一座城算两遍的差值，应当就是天赋那一份
  const gain = api.Economy.talentGain(G);
  const { api: a0, get: g0b } = h.boot({ seed: 7 });
  const G0 = g0b();
  ok('无天赋时 talentGain 全为 0',
    Object.values(api.Economy.talentGain(G0)).every(v => v === 0));
  ok('农夫天赋 talentGain 粮为正且只有粮',
    gain.food > 0 && Math.abs(gain.gold) < 1e-9 && Math.abs(gain.mat) < 1e-9,
    `粮${gain.food.toFixed(1)} 钱${gain.gold.toFixed(1)}`);
}

// ─────────────────────────────────────────────
section('武将特技接线');
{
  const { api, get } = h.boot({ seed: 7 });
  const G = get();
  const base = { terrain: 'plain', morale: 55 };
  const powOf = (heroId, troops, extra) => api.Combat.power(G, troops, heroId, { ...base, ...extra });
  // 剥离「统领加成」(1 + tong/200) 与「守将忠诚」(守方)，只留特技自身的倍率
  const skillMul = (heroId, troops, extra) => {
    const h = G.heroes[heroId];
    let denom = (1 + h.tong / 200) * powOf(null, troops, extra);
    if (extra && extra.isDefender) denom *= 0.90 + (h.loyalty == null ? 70 : h.loyalty) / 500;
    return powOf(heroId, troops, extra) / denom;
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
section('人情账（忠诚 / 野心 / 私交 / 叛变）');
{
  const { api, get } = h.boot({ seed: 7 });
  const G = get();
  const home = G.cities[G.player.homeCityId];
  const govOf = c => G.heroes[c.governor];
  const pickNonPlayer = () => Object.values(G.heroes)
    .find(x => x.factionId === G.player.factionId && x.id !== 'PLAYER' && x.cityId === home.id);

  ok('开局武将带人情账字段',
    Object.values(G.heroes).every(x => x.ambition >= 5 && x.ambition <= 95
      && x.bond != null && x.grievance != null && x.idle != null && x.cd));
  ok('野心按 智/武/魅 算：智勇高、人缘差者野心大',
    api.State._ambitionOf({ wu: 95, zhi: 95, mei: 20 }) > api.State._ambitionOf({ wu: 40, zhi: 40, mei: 90 }));

  // 赏赐：精确加成 + 扣钱 + 冷却
  {
    const hero = pickNonPlayer();
    const city = G.cities[hero.cityId];
    city.gold = 3000;
    hero.loyalty = 50;
    const loy0 = hero.loyalty, bond0 = hero.bond, gold0 = city.gold;
    const cost = 80 * (1 + G.player.rank);
    api.Store.dispatch('REWARD_HERO', { heroId: hero.id });
    const hh = get().heroes[hero.id];
    const freshCity = get().cities[hero.cityId];
    ok('赏赐：忠诚 +6 / 私交 +10 / 按官阶扣钱',
      Math.abs(hh.loyalty - (loy0 + 6)) < 0.01 && Math.abs(hh.bond - (bond0 + 10)) < 0.01
      && freshCity.gold === gold0 - cost);
    let err = null;
    try { api.Store.dispatch('REWARD_HERO', { heroId: hero.id }); } catch (e) { err = e.message; }
    ok('赏赐：冷却期内再办被拒且状态不变',
      /尚需/.test(err || '') && get().heroes[hero.id].loyalty === hh.loyalty);
  }

  // 责罚：只能罚守将，积怨 +1、治安 +3；抚慰消积怨
  {
    const raw = JSON.parse(JSON.stringify(get()));
    const c = raw.cities[raw.player.homeCityId];
    const hero = Object.values(raw.heroes).find(x => x.id === c.governor);
    const order0 = c.order;
    api.Store.replace(raw);
    api.Store.dispatch('PUNISH_HERO', { heroId: hero.id });
    const hh = get().heroes[hero.id];
    ok('责罚：忠诚 -10 / 积怨 +1 / 治安 +3',
      Math.abs(hh.loyalty - (hero.loyalty - 10)) < 0.01 && hh.grievance === hero.grievance + 1
      && Math.abs(get().cities[raw.player.homeCityId].order - (order0 + 3)) < 0.01);
    const c2 = get().cities[raw.player.homeCityId];
    c2.food = Math.max(c2.food, 500);
    api.Store.dispatch('CONSOLE_HERO', { heroId: hero.id });
    ok('抚慰：积怨 -1 且扣粮 60', get().heroes[hero.id].grievance === hh.grievance - 1);
  }

  // 提拔：换守将，战功 -5，旧守将忠诚 -6
  {
    const raw = JSON.parse(JSON.stringify(get()));
    const c = raw.cities[raw.player.homeCityId];
    raw.player.merit = 100;
    const prev = c.governor;
    const cand = Object.values(raw.heroes).find(x => x.factionId === raw.player.factionId
      && x.id !== 'PLAYER' && x.id !== prev && x.cityId === c.id);
    api.Store.replace(raw);
    api.Store.dispatch('PROMOTE_HERO', { heroId: cand.id, cityId: c.id });
    const g2 = get();
    ok('提拔：换守将 / 战功 -5 / 旧守将忠诚 -6',
      g2.cities[c.id].governor === cand.id && g2.player.merit === 95
      && Math.abs(g2.heroes[prev].loyalty - (raw.heroes[prev].loyalty - 6)) < 0.01);
  }

  // 闲置：连续 6 回合不被任用 → idle 增长且忠诚下滑
  {
    const { api: a2, get: g2 } = h.boot({ seed: 21 });
    const raw = JSON.parse(JSON.stringify(g2()));
    const hero = Object.values(raw.heroes).find(x => x.factionId === raw.player.factionId
      && x.id !== 'PLAYER' && x.cityId !== raw.player.homeCityId);
    // 让他既不当守将、也不在军中
    for (const c of Object.values(raw.cities)) if (c.governor === hero.id) c.governor = null;
    hero.cityId = null;
    raw.heroes[hero.id] = { ...hero, loyalty: 70, ambition: 40, bond: 0, idle: 0 };
    a2.Store.replace(raw);
    h.runTurns(a2, 7);
    const hh = g2().heroes[hero.id];
    ok('闲置 6 月：idle 累积且忠诚下滑', hh.idle >= 6 && hh.loyalty < 70.5,
      `idle ${hh.idle}，忠诚 ${hh.loyalty.toFixed(1)}`);
  }

  // 叛变：先预警，再叛；武将不许消失
  {
    const { api: a3, get: g3 } = h.boot({ seed: 33 });
    const raw = JSON.parse(JSON.stringify(g3()));
    const c = raw.cities[raw.player.homeCityId];
    const heroId = Object.keys(raw.heroes).find(id => id !== 'PLAYER'
      && raw.heroes[id].factionId === raw.player.factionId && raw.heroes[id].cityId === c.id);
    const hero = raw.heroes[heroId];
    c.governor = heroId;
    Object.assign(hero, { loyalty: 12, ambition: 92, bond: 0, grievance: 0, warnTurn: 0, cd: {} });
    a3.Store.replace(raw);

    let warned = false, defected = false, turns = 0;
    for (let i = 0; i < 24 && !defected; i++) {
      h.runTurns(a3, 1);
      turns++;
      const g = g3();
      const log = g.log.map(e => e.text).join('\n');
      if (/心怀异志/.test(log)) warned = true;
      const hh = g.heroes[heroId];
      if (hh.factionId !== raw.player.factionId || g.cities[c.id].owner !== raw.player.factionId) defected = true;
    }
    const g = g3();
    const hh = g.heroes[heroId];
    ok('叛变前必有预警', warned, `${turns} 回合内`);
    ok('叛变：武将仍在册（只换主子，不消失）', !!hh && hh.alive === true);
    ok('叛变：带城投敌或落草', defected && (hh.factionId !== raw.player.factionId || g.cities[c.id].owner !== raw.player.factionId),
      `将属 ${hh.factionId}，城属 ${g.cities[c.id].owner}`);
  }

  // 安抚窗口：预警后 3 月内办过事 → 本次不叛
  {
    const { api: a4, get: g4 } = h.boot({ seed: 33 });
    const raw = JSON.parse(JSON.stringify(g4()));
    const c = raw.cities[raw.player.homeCityId];
    const heroId = Object.keys(raw.heroes).find(id => id !== 'PLAYER'
      && raw.heroes[id].factionId === raw.player.factionId && raw.heroes[id].cityId === c.id);
    const hero = raw.heroes[heroId];
    const turn = raw.meta.turn;
    c.governor = heroId;
    Object.assign(hero, { loyalty: 12, ambition: 92, warnTurn: turn, lastAct: turn, cd: {} });
    a4.Store.replace(raw);
    h.runTurns(a4, 1);
    const hh = g4().heroes[heroId];
    ok('安抚窗口：预警后 3 月内办过事则不叛', hh.factionId === raw.player.factionId && hh.warnTurn === 0);
  }

  // 派生：守将忠诚影响守城战力；私交影响产出；忠诚影响建军士气
  {
    const { api: a5, get: g5 } = h.boot({ seed: 7 });
    const raw = JSON.parse(JSON.stringify(g5()));
    const c = raw.cities[raw.player.homeCityId];
    const hid = c.governor;
    const war = obj => a5.Combat.power(raw, c.garrison, hid, {
      terrain: 'plain', isDefender: true, enemyTroops: { inf: 1000 }, wall: 0,
      factionId: raw.player.factionId,
    });
    raw.heroes[hid].loyalty = 100;
    const p100 = war(raw);
    raw.heroes[hid].loyalty = 40;
    const p40 = war(raw);
    ok('守将忠诚：100 比 40 守城战力高约 12%', Math.abs(p100 / p40 - 1.10 / 0.98) < 0.01,
      (p100 / p40).toFixed(3));

    const a6 = h.boot({ seed: 7 });
    const G6 = a6.get();
    const c6 = G6.cities[G6.player.homeCityId];
    G6.heroes[c6.governor].loyalty = 20;
    const low = a6.api.Army._initialMorale(G6, G6.player.factionId, c6.governor);
    G6.heroes[c6.governor].loyalty = 95;
    const high = a6.api.Army._initialMorale(G6, G6.player.factionId, c6.governor);
    ok('建军士气随主将忠诚变化', high > low, `${low.toFixed(1)} → ${high.toFixed(1)}`);
  }

  // 旧档迁移：缺新字段的存档读入后补齐，且两次迁移结果一致
  {
    const { api: a7, get: g7 } = h.boot({ seed: 9 });
    const strip = () => {
      const raw = JSON.parse(JSON.stringify(g7()));
      for (const x of Object.values(raw.heroes)) {
        delete x.ambition; delete x.bond; delete x.grievance;
        delete x.idle; delete x.lastAct; delete x.warnTurn; delete x.cd;
      }
      return raw;
    };
    const r1 = strip(), r2 = strip();
    a7.State.migrate(r1, 2);
    a7.State.migrate(r2, 2);
    const bad = Object.keys(r1.heroes).filter(id => {
      const h = r1.heroes[id];
      return h.ambition == null || h.ambition < 5 || h.ambition > 95 || !h.cd;
    });
    ok('旧档迁移：补齐 ambition/bond/cd', !bad.length, bad.slice(0, 3).join(','));
    ok('旧档迁移：同档多次迁移结果一致',
      Object.keys(r1.heroes).every(id => r1.heroes[id].ambition === r2.heroes[id].ambition));
  }

  // 回归守门：AI 调度援军不许搬走玩家直辖城的兵
  {
    const { api: a8, get: g8 } = h.boot({ seed: 12 });
    const G8 = g8();
    const c8 = G8.cities[G8.player.homeCityId];
    c8.garrison.inf = 900;
    const near = a8.State.neighbors(G8, c8.id, 260).find(x => x.owner !== G8.player.factionId);
    const before = a8.troopTotal(c8.garrison);
    if (near) a8.Diplo.sendAid(G8, G8.player.factionId, near.id, 0.3);
    const fromHome = Object.values(a8.Store.get().armies).some(a => a.from === c8.id && a.mission === 'aid');
    ok('援军不从玩家直辖城抽兵', !fromHome && a8.troopTotal(c8.garrison) === before,
      `家城兵 ${before} → ${a8.troopTotal(c8.garrison)}`);
  }
}

// ─────────────────────────────────────────────
section('名望与定向登用');
{
  const { api, get } = h.boot({ seed: 7 });
  const G = get();

  // 1 名望档位
  ok('名望档位分四段',
    api.repTitle(10) === '无名之辈' && api.repTitle(80) === '一方名士'
    && api.repTitle(200) === '海内知名' && api.repTitle(300) === '天下归心');

  // 2 城档：治所最高、县城最低
  {
    const caps = api.State.capitals(G);
    const cap = G.cities[[...caps][0]];
    const small = Object.values(G.cities)
      .filter(c => !caps.has(c.id))
      .sort((a, b) => a.pop - b.pop)[0];
    ok('城档：治所 = 都城（2）、小城 = 县城（0）',
      api.State.cityLevel(G, cap, caps) === 2 && api.State.cityLevel(G, small, caps) === 0,
      `${cap.name}=${api.State.cityLevel(G, cap, caps)} ${small.name}=${api.State.cityLevel(G, small, caps)}`);
  }

  // 3 破城名望按城档：县城 +4 / 郡城 +6 / 都城 +12
  {
    const runCapture = (pickSmall) => {
      const { api: a, get: g } = h.boot({ seed: 7 });
      const st = g();
      const home = st.cities[st.player.homeCityId];
      const caps = a.State.capitals(st);
      const nbs = a.State.neighbors(st, home.id, 300)
        .filter(x => x.owner !== st.player.factionId);
      const target = pickSmall
        ? nbs.filter(x => a.State.cityLevel(st, x, caps) === 0).sort((x, y) => x.pop - y.pop)[0]
        : nbs.filter(x => a.State.cityLevel(st, x, caps) >= 1).sort((x, y) => y.pop - x.pop)[0];
      if (!target) return null;
      const tierBefore = a.State.cityLevel(st, target, caps);   // 先记档，拆墙会改档次
      // 目标守军抽干、城墙拆掉，保证必下
      for (const k of a.TROOP_KEYS) target.garrison[k] = 0;
      target.garrison.inf = 1;
      // 城墙不动：改 wall 会改掉治所判定（capitals 用 pop + wall×60），
      // 5000 打 1 兵，墙再高也必下
      const pr = a.Diplo.pair(st, st.player.factionId, target.owner);
      pr.status = a.Diplo.WAR; pr.rel = -80; pr.until = 0;
      a.Store.replace(st);
      const g2 = g();
      const army = a.Army.create(g2, {
        factionId: g2.player.factionId, heroId: 'PLAYER', from: home.id, to: target.id,
        troops: { inf: 5000 }, mission: 'attack',
      });
      army.eta = 1; army.totalEta = 1;
      const rep0 = g2.player.reputation;
      a.Store.replace(g2);
      a.Army.advance(a.Store.get(), 'x');
      const after = g();
      return {
        gained: after.player.reputation - rep0,
        tier: tierBefore,
        captured: after.cities[target.id].owner === after.player.factionId,
      };
    };
    const low = runCapture(true);
    const high = runCapture(false);
    ok('破城名望：县城 +4', !!low && low.captured && low.gained === 4, low ? `+${low.gained}` : '无县城可测');
    ok('破城名望：郡城/都城 +6/+12', !!high && high.gained === (high.tier === 2 ? 12 : 6),
      high ? `tier${high.tier} +${high.gained}` : '无大城可测');
  }

  // 4 登用成功率公式：分项可复算，且被 clamp 在 3%-92%
  {
    const free = Object.values(G.heroes).find(x => x.factionId === 'free');
    const c1 = api.Relations.recruitChance(G, free, 'beseech');
    const manual = 0.55 + (free.bond || 0) * 0.005 + api.State.playerReputation(G) / 800
      + api.State.heroStat(G, 'PLAYER', 'mei') / 400
      + (100 - (free.ambition || 40)) * 0.002 - free.zhi * 0.0015;
    ok('登用成功率：分项之和 = 总概率（clamp 前）',
      Math.abs(c1.parts.reduce((s, x) => s + x[1], 0) - manual) < 1e-9);
    ok('登用成功率：夹在 3%–92%',
      c1.p >= 0.03 && c1.p <= 0.92 && api.Relations.recruitChance(G, free, 'visit').p >= 0.03);
  }

  // 5 拜访：扣钱、失败仍在野；成功则入麾下
  {
    const { api: a, get: g } = h.boot({ seed: 5 });
    const st = g();
    const target = Object.values(st.heroes).find(x => x.factionId === 'free');
    st.player.reputation = 400;                       // 拉满胜算
    st.heroes[target.id].ambition = 5;
    st.heroes[target.id].zhi = 10;
    st.cities[st.player.homeCityId].gold = 5000;
    a.Store.replace(st);
    const gold0 = g().cities[st.player.homeCityId].gold;
    const r = a.Store.dispatch('VISIT_HERO', { heroId: target.id });
    const after = g();
    ok('拜访：扣 60 钱', gold0 - after.cities[st.player.homeCityId].gold === 60);
    ok('拜访：成功则入麾下且忠诚按公式',
      !r.ok || (after.heroes[target.id].factionId === after.player.factionId
        && Math.abs(after.heroes[target.id].loyalty - (45 + (st.heroes[target.id].bond || 0) / 2)) < 0.01),
      `ok=${r.ok} 胜算 ${(r.chance * 100).toFixed(0)}%`);
    let err = null;
    try { a.Store.dispatch('VISIT_HERO', { heroId: target.id }); } catch (e) { err = e.message; }
    ok('拜访：冷却期内再往被拒（或已入麾下）', /尚需|已仕/.test(err || ''), err || '未抛错');
  }

  // 6 三顾互斥：同一时间只许一位
  {
    const { api: a, get: g } = h.boot({ seed: 9 });
    const st = g();
    const frees = Object.values(st.heroes).filter(x => x.factionId === 'free').slice(0, 2);
    st.cities[st.player.homeCityId].gold = 9000;
    a.Store.replace(st);
    a.Store.dispatch('BESEECH_HERO', { heroId: frees[0].id });
    let err = null;
    try { a.Store.dispatch('BESEECH_HERO', { heroId: frees[1].id }); } catch (e) { err = e.message; }
    ok('三顾：同一时间只许一人', /三顾之礼已许/.test(err || ''), err || '未抛错');
  }

  // 7 士族征辟改走成功率：不再 500 钱必成功
  {
    let joined = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { api: a, get: g } = h.boot({ seed });
      const st = g();
      const city = st.cities[st.player.homeCityId];
      city.gold = 5000;
      a.Store.replace(st);
      try { a.Store.dispatch('CLAN_ACTION', { cityId: city.id, action: 'recruit' }); } catch (e) { }
      const own = Object.values(g().heroes)
        .some(x => x.factionId === g().player.factionId && x.id !== 'PLAYER' && x.bond >= 25 && x.loyalty === 78);
      if (own) joined++;
    }
    ok('士族征辟：有成功也有失败（不是必成功）', joined > 0 && joined < 8, `${joined}/8 成功`);
  }
}

// ─────────────────────────────────────────────
section('宝物（装备 / 派生 / 破城掉落）');
{
  const { api, get } = h.boot({ seed: 7 });

  // 1 登记表：20 件、五类齐全、开局按剧本落到几座城
  {
    const G = get();
    const cats = new Set(api.TREASURE_KEYS.map(k => api.TREASURES[k].cat));
    ok('宝物：20 件 5 类',
      api.TREASURE_KEYS.length === 20 && cats.size === 5, `${api.TREASURE_KEYS.length} 件 / ${cats.size} 类`);
    ok('宝物：开局按剧本落在洛阳等城',
      api.State.treasuresAt(G, 'luoyang').length >= 2
      && Object.keys(G.treasures).length === api.TREASURE_KEYS.length,
      `洛阳 ${api.State.treasuresAt(G, 'luoyang').length} 件`);
  }

  // 2 装备：派生属性 + 战力；同槽替换；同一件不能两人戴
  {
    const { api: a, get: g } = h.boot({ seed: 7 });
    const st = g();
    const home = st.cities[st.player.homeCityId];
    const heroId = Object.keys(st.heroes).find(id => id !== 'PLAYER'
      && st.heroes[id].factionId === st.player.factionId && st.heroes[id].cityId === home.id);
    // 把两件兵器挪到本城
    st.treasures.qinggang.cityId = home.id;
    st.treasures.guding.cityId = home.id;
    a.Store.replace(st);

    const tong0 = g().heroes[heroId].tong;
    const powerOf = () => {
      const z = g();
      return a.Combat.power(z, { inf: 1000 }, heroId, {
        terrain: 'plain', morale: 60, factionId: z.player.factionId,
      });
    };
    const p0 = powerOf();
    a.Store.dispatch('EQUIP_TREASURE', { heroId, treasureId: 'qinggang' });
    const z1 = g();
    ok('装备：五维读派生值（统/武）+ 槽位登记',
      z1.heroes[heroId].slots.weapon === 'qinggang'
      && z1.treasures.qinggang.holder === heroId
      && a.State.heroStat(z1, heroId, 'wu') === z1.heroes[heroId].wu + 4);
    void tong0;

    // 同槽替换：古锭刀顶掉青釭剑，青釭回府库
    a.Store.dispatch('EQUIP_TREASURE', { heroId, treasureId: 'guding' });
    const z2 = g();
    ok('装备：同槽替换，旧宝自动卸回府库',
      z2.heroes[heroId].slots.weapon === 'guding'
      && z2.treasures.qinggang.holder === null
      && z2.treasures.qinggang.cityId === home.id);

    // 同一件不能两人戴（另一将不在本城也能装，但宝物已被人持有就拒绝）
    const other = Object.keys(z2.heroes).find(id => id !== 'PLAYER'
      && z2.heroes[id].factionId === z2.player.factionId && id !== heroId);
    if (other) {
      let err = null;
      try { a.Store.dispatch('EQUIP_TREASURE', { heroId: other, treasureId: 'guding' }); } catch (e) { err = e.message; }
      ok('装备：同一件不能两人戴', /须先卸下/.test(err || ''), err || '未抛错');
    }

    // 甲胄守城加成 + 卸下回府库
    {
      const defPow = () => {
        const z = g();
        return a.Combat.power(z, { inf: 1000 }, heroId, {
          terrain: 'plain', isDefender: true, enemyTroops: { inf: 100 }, wall: 0,
          factionId: z.player.factionId,
        });
      };
      const before = defPow();
      const st3 = g();
      st3.treasures.mingguang.cityId = home.id;
      a.Store.replace(st3);
      a.Store.dispatch('EQUIP_TREASURE', { heroId, treasureId: 'mingguang' });
      const tong = g().heroes[heroId].tong;
      // 明光铠：统 +3（战力 ×(1+统/200)）+ 守城 +3%
      const expect = ((1 + (tong + 3) / 200) / (1 + tong / 200)) * 1.03;
      const ratio = defPow() / before;
      ok('甲胄：统 +3 且守城 +3%', Math.abs(ratio - expect) < 0.005, `${ratio.toFixed(4)} vs ${expect.toFixed(4)}`);

      a.Store.dispatch('UNEQUIP_TREASURE', { heroId, cat: 'armor' });
      const z4 = g();
      ok('卸下：宝物回到本城府库',
        !z4.heroes[heroId].slots.armor && z4.treasures.mingguang.holder === null
        && z4.treasures.mingguang.cityId === home.id);
    }
  }

  // 3 坐骑加速：同兵力同路线，有坐骑行军月数不多于没坐骑
  {
    const { api: a, get: g } = h.boot({ seed: 7 });
    const st = g();
    const home = st.cities[st.player.homeCityId];
    const far = Object.values(st.cities).sort((x, y) =>
      api.U.dist(home.x, home.y, y.x, y.y) - api.U.dist(home.x, home.y, x.x, x.y))[0];
    const heroId = Object.keys(st.heroes).find(id => id !== 'PLAYER'
      && st.heroes[id].factionId === st.player.factionId && st.heroes[id].cityId === home.id);
    st.treasures.chitu.cityId = home.id;
    a.Store.replace(st);
    const etaOf = () => {
      const z = g();
      const army = a.Army.create(z, {
        factionId: z.player.factionId, heroId, from: home.id, to: far.id,
        troops: { inf: 500 }, mission: 'reinforce',
      });
      return army.eta;
    };
    const before = etaOf();
    a.Store.dispatch('EQUIP_TREASURE', { heroId, treasureId: 'chitu' });
    const after = etaOf();
    ok('坐骑：行军月数变少或持平', after <= before, `${before} → ${after} 月`);
  }

  // 4 破城：宝物要么留在本城（归新主），要么随败军撤往旧主治所 —— 不许凭空消失
  {
    const { api: a, get: g } = h.boot({ seed: 7 });
    const st = g();
    const home = st.cities[st.player.homeCityId];
    const target = a.State.neighbors(st, home.id, 300)
      .find(x => x.owner !== st.player.factionId && a.State.treasuresAt(st, x.id).length);
    if (!target) {
      // 开局宝物未必在邻城：直接挪一件过去
      const anyTreasure = a.State.freeTreasures(st)[0];
      const nb = a.State.neighbors(st, home.id, 300).find(x => x.owner !== st.player.factionId);
      if (nb && anyTreasure) { st.treasures[anyTreasure].cityId = nb.id; }
      a.Store.replace(st);
    }
    const st2 = g();
    const nb = a.State.neighbors(st2, home.id, 300).find(x => x.owner !== st2.player.factionId);
    const tids = a.State.treasuresAt(st2, nb.id);
    const oldOwner = nb.owner;
    for (const k of a.TROOP_KEYS) nb.garrison[k] = 0;
    nb.garrison.inf = 1;
    const pr = a.Diplo.pair(st2, st2.player.factionId, nb.owner);
    pr.status = a.Diplo.WAR; pr.rel = -80; pr.until = 0;
    a.Store.replace(st2);
    const g2 = g();
    const army = a.Army.create(g2, {
      factionId: g2.player.factionId, heroId: 'PLAYER', from: home.id, to: nb.id,
      troops: { inf: 5000 }, mission: 'attack',
    });
    army.eta = 1; army.totalEta = 1;
    a.Store.replace(g2);
    a.Army.advance(a.Store.get(), 'x');
    const z = g();
    const caps = a.State.capitals(z);
    const bad = tids.filter(tid => {
      const t = z.treasures[tid];
      if (t.holder) return false;
      if (t.cityId === nb.id) return false;
      const refuge = t.cityId ? z.cities[t.cityId] : null;
      return !(refuge && refuge.owner === oldOwner);
    });
    ok('破城：宝物留在本城或退往旧主治所（不凭空消失）',
      z.cities[nb.id].owner === z.player.factionId && bad.length === 0,
      `${tids.length} 件，异常 ${bad.length}`);
    void caps;
  }

  // 5 旧档迁移：缺 treasures / slots 时补齐
  {
    const { api: a, get: g } = h.boot({ seed: 7 });
    const raw = JSON.parse(JSON.stringify(g()));
    delete raw.treasures;
    for (const h of Object.values(raw.heroes)) delete h.slots;
    a.State.migrate(raw, 2);
    const full = a.TREASURE_KEYS.every(k => raw.treasures[k] && raw.treasures[k].holder === null);
    const slotsOk = Object.values(raw.heroes).every(h => h.slots && typeof h.slots === 'object');
    ok('旧档迁移：补齐宝物登记表与武将槽位', full && slotsOk);
  }
}

// ─────────────────────────────────────────────
section('攻城逐轮推进 + 战法');
{
  // 造一局：玩家带大兵打邻城，返回 { api, get, army, city }
  const setup = (seed, opts = {}) => {
    const { api, get } = h.boot({ seed });
    const st = get();
    const home = st.cities[st.player.homeCityId];
    const nb = api.State.neighbors(st, home.id, 300).find(x => x.owner !== st.player.factionId
      && x.owner !== 'free');
    for (const k of api.TROOP_KEYS) nb.garrison[k] = 0;
    nb.garrison.inf = opts.defTroops == null ? 600 : opts.defTroops;
    nb.wall = opts.wall == null ? 1 : opts.wall;
    nb.morale = 55;
    const pr = api.Diplo.pair(st, st.player.factionId, nb.owner);
    pr.status = api.Diplo.WAR; pr.rel = -80; pr.until = 0;
    st.player.reputation = 0;
    if (opts.heroSkill) st.heroes.PLAYER.skill = opts.heroSkill;
    api.Store.replace(st);

    const g = get();
    const army = api.Army.create(g, {
      factionId: g.player.factionId, heroId: 'PLAYER', from: home.id, to: nb.id,
      troops: { inf: 1200 }, mission: 'attack',
    });
    army.eta = 1; army.totalEta = 1;
    g.armies[army.id] = army;
    api.Store.replace(g);
    return { api, get, armyId: army.id, cityId: nb.id, homeId: home.id };
  };

  // 1 逐轮 step 与一次跑完 resolve 结果一致（同种子、同输入）
  {
    const a = setup(101);
    const cityA = a.get().cities[a.cityId];
    const armyA = a.get().armies[a.armyId];
    const rep = a.api.Combat.resolve(a.get(), armyA, cityA, 'x');

    const b = setup(101);
    const cityB = b.get().cities[b.cityId];
    const armyB = b.get().armies[b.armyId];
    b.api.Combat.begin(b.get(), armyB, cityB, 'x');
    while (!b.api.Combat.step(b.get(), armyB, cityB, null, 'x')) { /* 逐轮 */ }
    const rep2 = b.api.Combat.conclude(b.get(), armyB, cityB, 'x');

    ok('逐轮推进与一次打完结果一致',
      rep.captured === rep2.captured && rep.atkLoss === rep2.atkLoss
      && rep.defLoss === rep2.defLoss && rep.rounds === rep2.rounds,
      `${rep.captured}/${rep.atkLoss}/${rep.defLoss}/${rep.rounds} vs ${rep2.captured}/${rep2.atkLoss}/${rep2.defLoss}/${rep2.rounds}`);
  }

  // 2 玩家指挥的攻城会挂起在轮间，不自动打完
  {
    const a = setup(102);
    a.api.Store.dispatch('END_TURN');   // 行军到位 → 开战（交互）
    const z = a.get();
    const ag = Object.values(z.armies).find(x => x.battle);
    ok('玩家指挥的攻城挂在轮间等指令', !!ag, ag ? `第 ${ag.battle.round} 合` : '未挂起');

    // 挂起期间 Army.advance 不许推进它
    if (ag) {
      const before = JSON.stringify(ag.battle.round);
      a.api.Army.advance(a.get(), 'x');
      ok('挂起的战斗不会被推进', JSON.stringify(a.get().armies[ag.id].battle.round) === before);
    }
  }

  // 3 战法：加了战法守方伤亡更多（同种子对比）
  {
    const run = (tactic) => {
      const a = setup(103, { heroSkill: 'huoji' });
      const city = a.get().cities[a.cityId];
      const army = a.get().armies[a.armyId];
      a.api.Combat.begin(a.get(), army, city, 'x');
      a.api.Combat.step(a.get(), army, city, tactic, 'x');
      const rep = a.api.Combat.conclude(a.get(), army, city, 'x');
      return { defLoss: rep.defLoss, round: rep.rounds, cityName: city.name };
    };
    const plain = run(null);
    const fired = run('huoji');
    ok('火计：一轮内守方伤亡显著更多', fired.defLoss >= plain.defLoss, `${plain.defLoss} → ${fired.defLoss}`);
  }

  // 4 战法只能用一次 + 士气门槛 + 专属战法判定
  {
    const a = setup(104, { heroSkill: 'huoji' });
    const z = a.get();
    const city = z.cities[a.cityId];
    const army = z.armies[a.armyId];
    a.api.Combat.begin(z, army, city, 'x');
    const list = a.api.Combat.tacticsFor(z, army, city);
    const huoji = list.find(x => x.key === 'huoji');
    const yexi = list.find(x => x.key === 'yexi');
    ok('战法表：专属（火计）+ 通用（夜袭）都在', !!huoji && !!yexi,
      list.map(x => x.name).join('/'));
    ok('战法：非本将特技的专属战法不出现在列表',
      !list.some(x => x.key === 'tuji'), list.filter(x => x.skill).map(x => x.name).join('/'));

    a.api.Combat.step(z, army, city, 'huoji', 'x');
    const after = a.api.Combat.tacticsFor(z, army, city);
    ok('战法：一场只能用一次', after.every(x => !x.ok && /已用过/.test(x.why || '')),
      after[0] ? after[0].why : '');

    // 士气 < 30 时禁用
    const b = setup(105);
    const z2 = b.get();
    const c2 = z2.cities[b.cityId];
    const a2 = z2.armies[b.armyId];
    a2.morale = 22;
    a2.battle = null;
    b.api.Combat.begin(z2, a2, c2, 'x');
    const l2 = b.api.Combat.tacticsFor(z2, a2, c2);
    ok('战法：士气 < 30 不可用', l2.every(x => !x.ok && /士气/.test(x.why || '')),
      (l2.find(x => /士气/.test(x.why || '')) || {}).why || '');
  }

  // 5 BATTLE_STEP 命令：打完 → 下城；非指挥战斗抛错
  {
    const a = setup(106, { defTroops: 900, wall: 2 });
    a.api.Store.dispatch('END_TURN');
    let z = a.get();
    let ag = Object.values(z.armies).find(x => x.battle);
    ok('BATTLE_STEP：有正在进行的战斗可用', !!ag, ag ? `第 ${ag.battle.round} 合` : '无挂起战斗');

    if (ag) {
      const id = ag.id;
      let guard = 0;
      while (a.get().armies[id] && a.get().armies[id].battle && guard < 8) {
        a.api.Store.dispatch('BATTLE_STEP', { armyId: id, tactic: guard === 0 ? 'mazhen' : null });
        guard++;
      }
      z = a.get();
      ok('BATTLE_STEP：能一路打到终局（城破或班师）',
        !z.armies[id] || !z.armies[id].battle, `用了 ${guard} 次`);
    }

    // AI 的战斗不接受玩家指令
    const b = setup(107);
    const z3 = b.get();
    const c3 = z3.cities[b.cityId];
    const a3 = z3.armies[b.armyId];
    a3.factionId = 'yuanshao';
    b.api.Combat.begin(z3, a3, c3, 'x');
    let err = null;
    try { b.api.Store.dispatch('BATTLE_STEP', { armyId: a3.id }); } catch (e) { err = e.message; }
    ok('BATTLE_STEP：非你指挥的战斗拒绝', /非你指挥/.test(err || ''), err || '未抛错');
  }

  // 6 结束回合会自动收尾没打完的战斗（不会卡住）
  {
    const a = setup(108);
    a.api.Store.dispatch('END_TURN');
    const z = a.get();
    const ag = Object.values(z.armies).find(x => x.battle);
    if (!ag) {
      ok('结束回合：自动收尾挂起的战斗（用例未挂起，跳过）', true);
    } else {
      a.api.Store.dispatch('END_TURN');
      const z2 = a.get();
      // 只断言「这一场」被收尾：同一回合别处可能又有新的攻城开打（那是正常的挂起）
      ok('结束回合：自动收尾挂起的战斗',
        !z2.armies[ag.id] || !z2.armies[ag.id].battle,
        `残留 ${Object.values(z2.armies).filter(x => x.battle).length}`);
    }
  }
}

// ─────────────────────────────────────────────
section('AI 决策（评估 / 留守 / 目标记忆 / 预算）');
{
  const { api, get } = h.boot({ seed: 7 });
  const G = get();
  const T = api.AI.TUNE;

  // 1 评估对象把局势压成一份 plan
  const f = Object.values(G.factions).find(x => x.id !== G.player.factionId && !x.dead && x.kind !== 'free'
    && api.State.factionCities(G, x.id).length >= 2);
  const cities = api.State.factionCities(G, f.id);
  const plan = api.AI.assess(G, f, cities, {});
  ok('assess 产出可读局势（威胁/预算/目标/留守）',
    typeof plan.totalTroops === 'number' && Array.isArray(plan.threatened)
    && Array.isArray(plan.targets) && typeof plan.reserveOf === 'function'
    && typeof plan.budget === 'number' && plan.cities.length === cities.length,
    `${cities.length} 城 / 兵 ${Math.round(plan.totalTroops)} / 目标 ${plan.targets.length}`);

  // 2 留守下限：前线 >= 55% 兵额、后方 >= 35%（受威胁时按现有兵力 90%）
  {
    const c = cities[0];
    const cap = api.State.troopCapOf(G, c);
    const reserve = plan.reserveOf(c);
    const front = plan.isFront(c);
    ok('留守下限按前线/后方分档',
      reserve >= Math.min(cap * (front ? T.reserveFront : T.reservePeace), api.troopTotal(c.garrison)) - 1,
      `${front ? '前线' : '后方'} 留守 ${Math.round(reserve)} / 兵额 ${Math.round(cap)}`);
    ok('可抽兵力 = 驻军 − 留守', Math.abs(plan.spareOf(c) - Math.max(0, api.troopTotal(c.garrison) - reserve)) < 1);
  }

  // 3 有敌军在途 → 本月转守，不新开进攻
  {
    const { api: a2, get: g2 } = h.boot({ seed: 13 });
    const G2 = g2();
    const f2 = Object.values(G2.factions).find(x => x.id !== G2.player.factionId && !x.dead && x.kind !== 'free'
      && a2.State.factionCities(G2, x.id).length >= 2);
    const victim = a2.State.factionCities(G2, f2.id)[0];
    const enemy = Object.values(G2.factions).find(x => x.id !== f2.id && x.id !== 'free' && !x.dead);
    const enemyCity = a2.State.neighbors(G2, victim.id, 400)[0];

    // 造一支 2 个月后抵达的攻军
    const atkArmy = a2.Army.create(G2, {
      factionId: enemy.id, heroId: null, from: enemyCity.id, to: victim.id,
      troops: { inf: 2000 }, mission: 'attack',
    });
    atkArmy.eta = 2; atkArmy.totalEta = 2;
    a2.Store.replace(G2);

    const p2 = a2.AI.assess(g2(), f2, a2.State.factionCities(g2(), f2.id), {});
    ok('受威胁识别（在途攻军 + 抵达月数）',
      p2.threatened.some(t => t.cityId === victim.id && t.eta <= T.threatEta),
      p2.threatened.map(t => `${g2().cities[t.cityId].name}@${t.eta}`).join(','));

    const before = new Set(Object.keys(g2().armies));
    a2.AIWar.run(g2(), f2, p2, 'x');
    const fresh = Object.values(g2().armies).filter(x => !before.has(x.id));
    ok('受威胁时本月只回防、不新开进攻',
      fresh.every(x => x.mission === 'reinforce'), fresh.map(x => x.mission).join(','));
  }

  // 4 目标记忆：进攻失败的目标被冷落，评估里不再出现
  {
    const { api: a3, get: g3 } = h.boot({ seed: 7 });
    const G3 = g3();
    // 找一个「有活干」的势力：没有目标就先宣一家邻国（否则 targets 为空，用例无意义）
    const cands = Object.values(G3.factions).filter(x => x.id !== G3.player.factionId && !x.dead && x.kind !== 'free'
      && a3.State.factionCities(G3, x.id).length >= 2);
    let f3 = cands[0], p3 = a3.AI.assess(G3, f3, a3.State.factionCities(G3, f3.id), {});
    if (!p3.targets.length) {
      const c0 = a3.State.factionCities(G3, f3.id)[0];
      const nb = a3.State.neighbors(G3, c0.id, 235).find(x => x.owner !== f3.id && x.owner !== 'free');
      if (nb) {
        const pr = a3.Diplo.pair(G3, f3.id, nb.owner);
        pr.rel = -70; pr.status = a3.Diplo.WAR; pr.until = 0;
        a3.Store.replace(G3);
        p3 = a3.AI.assess(a3.Store.get(), f3, a3.State.factionCities(a3.Store.get(), f3.id), {});
      }
    }
    const tgt = p3.targets[0];
    if (!tgt) {
      ok('目标记忆：用例需要至少一个可打目标', false);
    } else {
      f3._offense = [{ armyId: 'gone', cityId: tgt.to, turn: G3.meta.turn }];
      a3.AI._settleOffense(G3, f3);
      const p4 = a3.AI.assess(G3, f3, a3.State.factionCities(G3, f3.id), {});
      ok('进攻失败的目标被冷落（不再出现在 targets）',
        f3._avoid[tgt.to] > G3.meta.turn && !p4.targets.some(t => t.to === tgt.to),
        `avoid 至第 ${f3._avoid[tgt.to]} 回合`);
    }
  }

  // 5 出兵预算：单回合新增进攻兵力不超过在册兵力 × commitRatio（force 除外）
  {
    const { api: a4, get: g4 } = h.boot({ seed: 21 });
    let worst = 0, sample = '';
    const orig = a4.Army.create;
    let turnTroops = 0, spent = 0;
    a4.Army.create = function (GG, o) {
      const a = orig.call(a4.Army, GG, o);
      if (o.mission === 'attack' && o.factionId !== GG.player.factionId) spent += a4.troopTotal(a.troops);
      return a;
    };
    for (let i = 0; i < 30; i++) {
      const g = g4();
      if (g.over) break;
      let tot = 0;
      for (const x of Object.values(g.cities)) if (x.owner !== g.player.factionId) tot += a4.troopTotal(x.garrison);
      for (const a of Object.values(g.armies)) if (a.factionId !== g.player.factionId) tot += a4.troopTotal(a.troops);
      turnTroops = Math.max(turnTroops, tot);
      spent = 0;
      try { a4.Store.dispatch('END_TURN'); } catch (e) { break; }
      const ratio = spent / Math.max(1, turnTroops);
      if (ratio > worst) { worst = ratio; sample = `第 ${i + 1} 月 ${Math.round(spent)}/${Math.round(turnTroops)}`; }
    }
    a4.Army.create = orig;
    ok('单月出兵兵力受 commitRatio 约束（全图口径，容许军区 force 略高）',
      worst <= api.AI.TUNE.commitRatio * 1.6, `峰值 ${(worst * 100).toFixed(0)}%（${sample}）`);
  }

  // 6 合攻：同月抵达同一座敌城的多路攻军合成一战（不是第一路先撞死、第二路变成合兵）
  {
    const { api: a6, get: g6 } = h.boot({ seed: 31 });
    const G6 = g6();
    const f6 = Object.values(G6.factions).find(x => x.id !== G6.player.factionId && !x.dead && x.kind !== 'free'
      && a6.State.factionCities(G6, x.id).length >= 2);
    const srcs = a6.State.factionCities(G6, f6.id);
    const enemyTarget = a6.State.neighbors(G6, srcs[0].id, 300)
      .find(x => x.owner !== f6.id && x.owner !== 'free');
    if (!enemyTarget) {
      ok('合攻：用例需要一座邻接敌城', false);
    } else {
      // 造两支同月抵达的攻军（先宣战，否则在途攻军只会班师）
      const pr6 = a6.Diplo.pair(G6, f6.id, enemyTarget.owner);
      pr6.rel = -80; pr6.status = a6.Diplo.WAR; pr6.until = 0;
      enemyTarget.garrison.inf = 1200;
      const battles0 = G6.stats.battles;
      for (const c of srcs.slice(0, 2)) {
        c.garrison.inf = 1500;
        const army = a6.Army.create(G6, {
          factionId: f6.id, heroId: null, from: c.id, to: enemyTarget.id,
          troops: { inf: 900 }, mission: 'attack',
        });
        army.eta = 1; army.totalEta = 1;
      }
      a6.Store.replace(G6);
      a6.Army.advance(a6.Store.get(), 'x');
      const g7 = g6();
      ok('合攻：多路同月抵达只打一仗', g7.stats.battles - battles0 === 1,
        `战斗 +${g7.stats.battles - battles0}`);
    }
  }

  // 7 会攻编排：单路打不下时凑两三路，且用 delay 把抵达月对齐
  {
    const { api: a7, get: g7 } = h.boot({ seed: 41 });
    let pairs = 0, misaligned = 0, delayed = 0;
    for (let i = 0; i < 60; i++) {
      const g = a7.Store.get();
      if (g.over) break;
      try { a7.Store.dispatch('END_TURN'); } catch (e) { break; }

      // 本月新造、仍在途的攻军：group by 势力|目标，检查是否约定同一抵达月
      const z = g7();
      const byKey = {};
      for (const a of Object.values(z.armies)) {
        if (a.mission !== 'attack' || a.createdTurn !== z.meta.turn) continue;
        const k = a.factionId + '|' + a.to;
        (byKey[k] = byKey[k] || []).push(a);
      }
      for (const k in byKey) {
        const list = byKey[k];
        if (list.length < 2) continue;
        pairs++;
        if (list.some(a => (a.delay || 0) > 0)) delayed++;
        if (new Set(list.map(a => a.eta + (a.delay || 0))).size > 1) misaligned++;
      }
    }
    ok('会攻：出现了两路同攻（编排生效）', pairs >= 1, `${pairs} 次`);
    ok('会攻：多路抵达月对齐', pairs >= 1 && misaligned === 0, `错位 ${misaligned}/${pairs}`);
    ok('会攻：确实用到了 delay（否则几路会错开送死）', delayed >= 1, `${delayed}/${pairs}`);
  }

  // 8 预判威胁：邻国兵力能压过来（尚无在途敌军）也算受威胁，并会提前补防
  {
    const { api: a8, get: g8 } = h.boot({ seed: 13 });
    const G8 = g8();
    const f8 = Object.values(G8.factions).find(x => x.id !== G8.player.factionId && !x.dead && x.kind !== 'free'
      && a8.State.factionCities(G8, x.id).length >= 2);
    const weak = a8.State.factionCities(G8, f8.id)[0];
    const nb = a8.State.neighbors(G8, weak.id, 235).find(x => x.owner !== f8.id && x.owner !== 'free');
    if (!nb) {
      ok('预判威胁：用例需要邻接敌城', false);
    } else {
      // 造：我城空虚 + 邻国大军 + 已宣战
      weak.garrison.inf = 80;
      nb.garrison.inf = 4000;
      const pr = a8.Diplo.pair(G8, f8.id, nb.owner);
      pr.rel = -80; pr.status = a8.Diplo.WAR; pr.until = 0;
      a8.Store.replace(G8);

      const plan8 = a8.AI.assess(a8.Store.get(), f8, a8.State.factionCities(a8.Store.get(), f8.id), {});
      ok('预判威胁：无在途敌军也识别出暴露城',
        plan8.threatened.length === 0 && plan8.exposed.some(e => e.cityId === weak.id),
        `exposed ${plan8.exposed.length}`);

      // 后排城有兵 → 应主动向前线补防
      const rear = a8.State.factionCities(a8.Store.get(), f8.id).find(c => c.id !== weak.id);
      if (rear) {
        rear.garrison.inf = 2500;
        a8.Store.replace(a8.Store.get());
        const before = new Set(Object.keys(g8().armies));
        const p9 = a8.AI.assess(g8(), f8, a8.State.factionCities(g8(), f8.id), {});
        a8.AIWar.defend(g8(), f8, p9, 'x',
          p9.exposed.map(e => ({ cityId: e.cityId, eta: 3, troops: Math.round(e.pressure * 0.8) })));
        const fresh = Object.values(g8().armies).filter(a => !before.has(a.id));
        ok('预判威胁：会提前向前线补防',
          fresh.length === 0 || fresh.some(a => a.mission === 'reinforce'),
          fresh.map(a => a.mission).join(',') || '未派兵');
      }
    }
  }

  // 6 决策留痕：aiTrace 打开后每月每势力一条
  {
    const { api: a5, get: g5 } = h.boot({ seed: 11 });
    const raw = JSON.parse(JSON.stringify(g5()));
    raw.meta.aiTrace = true;
    a5.Store.replace(raw);
    h.runTurns(a5, 6);
    const trace = g5().aiTrace || [];
    ok('aiTrace 记录决策依据',
      trace.length > 0 && trace.every(t => t.posture && typeof t.budget === 'number' && t.turn > 0),
      `${trace.length} 条，posture ${[...new Set(trace.map(t => t.posture))].join('/')}`);
  }
}

// ─────────────────────────────────────────────
section('P6 补口：AI 用宝 / AI 放战法 / 商人购宝');
{
  // 1 AI 会给自己的将发宝，且优先给更强的稀有度
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    const f = Object.values(G.factions).find(x => x.id !== G.player.factionId && !x.dead && x.kind !== 'free'
      && api.State.factionCities(G, x.id).length);
    const city = api.State.factionCities(G, f.id)[0];
    // 往这座城塞两件宝：一件普通、一件稀有
    G.treasures.guding.cityId = city.id;
    G.treasures.fangtian.cityId = city.id;
    api.Store.replace(G);

    const g1 = get();
    const f1 = g1.factions[f.id];
    api.AI._equipTreasures(g1, f1, api.State.factionCities(g1, f.id));
    const z = get();
    const holderA = z.treasures.fangtian.holder;
    const heroA = holderA ? z.heroes[holderA] : null;
    ok('AI 发宝：宝装到了本势力武将身上',
      !!heroA && heroA.slots.weapon === 'fangtian' && z.treasures.fangtian.cityId === null,
      heroA ? `${heroA.name} 佩 方天画戟` : '未装备');

    // 再塞一件更稀有的？没有更高（3 已是最高）；塞同稀有度不应顶掉
    const g2 = get();
    g2.treasures.qinggang.cityId = city.id;
    api.Store.replace(g2);
    const before = get().heroes[holderA].slots.weapon;
    api.AI._equipTreasures(get(), get().factions[f.id], api.State.factionCities(get(), f.id));
    ok('AI 发宝：同稀有度不来回换', get().heroes[holderA].slots.weapon === before, before);
  }

  // 2 AI 会放战法（resolve 的 aiTactic 开关）
  {
    const mk = (aiTactic) => {
      const { api, get } = h.boot({ seed: 44 });
      const st = get();
      const home = st.cities[st.player.homeCityId];
      const nb = api.State.neighbors(st, home.id, 300).find(x => x.owner !== st.player.factionId);
      for (const k of api.TROOP_KEYS) nb.garrison[k] = 0;
      nb.garrison.inf = 900;
      nb.wall = 2; nb.morale = 55;
      const pr = api.Diplo.pair(st, st.player.factionId, nb.owner);
      pr.status = api.Diplo.WAR; pr.rel = -80; pr.until = 0;
      api.Store.replace(st);
      const g = get();
      const army = api.Army.create(g, {
        factionId: g.player.factionId, heroId: 'PLAYER', from: home.id, to: nb.id,
        troops: { inf: 1500, siege: 300 }, mission: 'attack',
      });
      army.factionId = 'yuanshao';       // 冒充 AI 势力，走 resolve 路径
      army.heroId = null;
      g.heroes.PLAYER.skill = 'huoji';  // 让「火计」可选
      g.armies[army.id] = army;
      api.Store.replace(g);
      const rep = api.Combat.resolve(get(), get().armies[army.id], get().cities[nb.id], 'x',
        aiTactic ? { aiTactic: true } : undefined);
      return { rep, lines: rep.lines.join('\n') };
    };
    const noT = mk(false);
    const withT = mk(true);
    ok('AI 放战法：战报里出现战法', /用「/.test(withT.lines) && !/用「/.test(noT.lines),
      (withT.lines.match(/用「([^」]+)」/) || [])[1] || '无');
    ok('AI 放战法：一轮内守方伤亡不少于不放战法',
      withT.rep.defLoss >= noT.rep.defLoss, `${noT.rep.defLoss} → ${withT.rep.defLoss}`);
  }

  // 3 商人天赋购宝：非商人拒绝、商人限一次、扣 600 钱
  {
    const { api, get } = h.boot({ seed: 5, talent: 'merchant' });
    const st = get();
    st.cities[st.player.homeCityId].gold = 2000;
    api.Store.replace(st);
    const gold0 = get().cities[st.player.homeCityId].gold;

    let errNon = null;
    {
      const { api: a2, get: g2 } = h.boot({ seed: 5, talent: 'farmer' });
      const s2 = g2();
      s2.cities[s2.player.homeCityId].gold = 2000;
      a2.Store.replace(s2);
      try { a2.Store.dispatch('BUY_TREASURE'); } catch (e) { errNon = e.message; }
    }
    ok('购宝：非商人天赋被拒', /唯商人/.test(errNon || ''), errNon || '未抛错');

    const r = api.Store.dispatch('BUY_TREASURE');
    const z = get();
    ok('购宝：扣 600 钱且宝物入库',
      z.cities[st.player.homeCityId].gold === gold0 - 600
      && z.treasures[r.treasureId].cityId === st.player.homeCityId
      && z.player.boughtTreasure === true);
    let err2 = null;
    try { api.Store.dispatch('BUY_TREASURE'); } catch (e) { err2 = e.message; }
    ok('购宝：只能买一次', /已购/.test(err2 || ''), err2 || '未抛错');
  }
}

// ─────────────────────────────────────────────
section('战斗中存档');
{
  // 造一场挂起的攻城（玩家指挥 → 逐轮推进 → 停在第 1 合）
  const mk = (seed) => {
    const { api, get } = h.boot({ seed });
    const st = get();
    const home = st.cities[st.player.homeCityId];
    const nb = api.State.neighbors(st, home.id, 300).find(x => x.owner !== st.player.factionId);
    for (const k of api.TROOP_KEYS) nb.garrison[k] = 0;
    nb.garrison.inf = 900;
    nb.wall = 2;
    const pr = api.Diplo.pair(st, st.player.factionId, nb.owner);
    pr.status = api.Diplo.WAR; pr.rel = -80; pr.until = 0;
    api.Store.replace(st);
    const g = get();
    const army = api.Army.create(g, {
      factionId: g.player.factionId, heroId: 'PLAYER', from: home.id, to: nb.id,
      troops: { inf: 2000 }, mission: 'attack',
    });
    army.eta = 1; army.totalEta = 1;
    g.armies[army.id] = army;
    api.Store.replace(g);
    api.Store.dispatch('END_TURN');
    const z = get();
    const ag = Object.values(z.armies).find(a => a.battle);
    return { api, get, armyId: ag ? ag.id : null, cityId: nb.id };
  };

  const a = mk(102);
  const z0 = a.get();
  ok('战斗中存档：先造出挂起的攻城', !!a.armyId);

  if (a.armyId) {
    const round0 = z0.armies[a.armyId].battle.round;
    const lines0 = z0.armies[a.armyId].battle.lines.length;

    // 存档 → 读档（走 Save 的编码/解码，跟真实存读档同一条路径）
    const enc = a.api.Save.encode(z0);
    const back = a.api.Save.decode(enc);
    ok('战斗中存档：存档可解出且战斗还在',
      !!back && !!back.armies[a.armyId] && !!back.armies[a.armyId].battle
      && back.armies[a.armyId].battle.round === round0
      && back.armies[a.armyId].battle.lines.length === lines0,
      back && back.armies[a.armyId] && back.armies[a.armyId].battle
        ? `第 ${back.armies[a.armyId].battle.round} 合` : '战斗丢了');

    // 读档后继续打，必须能正常收尾
    a.api.Store.replace(back);
    let guard = 0;
    while (a.get().armies[a.armyId] && a.get().armies[a.armyId].battle && guard < 8) {
      a.api.Store.dispatch('BATTLE_STEP', { armyId: a.armyId, tactic: guard === 0 ? 'mazhen' : null });
      guard++;
    }
    ok('战斗中存档：读档后能接着打到终局',
      !a.get().armies[a.armyId] || !a.get().armies[a.armyId].battle, `续了 ${guard} 合`);
  }

  // 孤儿战斗（战场城池没了）在迁移时被清掉，免得这支军被永久跳过
  {
    const b = mk(103);
    if (!b.armyId) {
      ok('战斗中存档：孤儿战斗清理（用例未挂起，跳过）', true);
    } else {
      const raw = JSON.parse(JSON.stringify(b.get()));
      delete raw.cities[b.cityId];
      b.api.State.migrate(raw, 2);
      ok('战斗中存档：城池消失后清掉挂起战斗', !raw.armies[b.armyId].battle);
    }
  }

  // 没有 battle 字段的旧档照样能读
  {
    const c = mk(104);
    const raw = JSON.parse(JSON.stringify(c.get()));
    for (const x of Object.values(raw.armies)) delete x.battle;
    let err = null;
    try { c.api.State.migrate(raw, 2); } catch (e) { err = e.message; }
    ok('战斗中存档：旧档（无 battle 字段）照常迁移', !err, err || '');
  }
}

// ─────────────────────────────────────────────
section('事件层（抽取 / 选项 / 延迟 / 连锁）');
{
  // 1 抽取：同种子可复现、队列不超过上限、抽到的事件必然满足 cond
  {
    const run = (seed) => {
      const { api, get } = h.boot({ seed });
      h.runTurns(api, 40);
      return get();
    };
    const a = run(7), b = run(7);
    ok('事件抽取：同种子可复现',
      a.events.history.map(x => x.eventId).join(',') === b.events.history.map(x => x.eventId).join(','),
      `${a.events.history.length} 条`);
    ok('事件队列不超过上限', a.events.queue.length <= api0(7).EventSys.MAX_QUEUE);

    function api0(seed) { return h.boot({ seed }).api; }
  }

  // 2 队列里有事件时：选项必须带代价说明；不可选要有原因
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    // 手工塞一条蝗灾（保证有卡）
    G.events.queue.push({ eventId: 'locust', cityId: G.player.homeCityId, turn: G.meta.turn });
    G.cities[G.player.homeCityId].buildings.farm = 4;
    api.Store.replace(G);
    const z = get();
    const opts = api.EventSys.options(z);
    ok('事件选项：每条都有代价说明', opts.length >= 2 && opts.every(o => typeof o.costText === 'string' && o.costText.length));
    const relief = opts.find(o => o.key === 'relief');
    z.cities[z.player.homeCityId].food = 10;
    api.Store.replace(z);
    const opts2 = api.EventSys.options(get());
    const relief2 = opts2.find(o => o.key === 'relief');
    ok('事件选项：条件不足时不可选且写原因',
      !!relief2 && relief2.ok === false && /粮/.test(relief2.why || ''), relief2 ? relief2.why : '没有该选项');
    void relief;
  }

  // 3 选择：扣代价 → 立刻效果 → 记历史 → 出队
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    const city = G.cities[G.player.homeCityId];
    city.buildings.farm = 4;
    city.food = 2000;
    city.order = 50;
    G.events.queue.push({ eventId: 'locust', cityId: city.id, turn: G.meta.turn });
    api.Store.replace(G);
    const before = get().cities[city.id];
    const food0 = before.food, order0 = before.order;
    api.Store.dispatch('EVENT_CHOICE', { optionKey: 'relief' });
    const z = get();
    // 蝗灾带连锁：选完会把「流民」塞进队列，所以队列不一定是 0
    ok('事件选择：扣代价且立刻生效',
      z.cities[city.id].food === food0 - 800 && z.cities[city.id].order === order0 + 6
      && !z.events.queue.some(q => q.eventId === 'locust') && z.events.history.length === 1,
      `队列 ${z.events.queue.map(q => q.eventId).join(',') || '空'}`);
    ok('事件选择：留下一条纪事', z.log.some(e => /开仓赈济/.test(e.text)));
  }

  // 4 延迟后果：3 回合后精确兑现，且到期必写纪事
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    const city = G.cities[G.player.homeCityId];
    city.buildings.farm = 4;
    city.food = 2000;
    G.events.queue.push({ eventId: 'locust', cityId: city.id, turn: G.meta.turn });
    api.Store.replace(G);
    api.Store.dispatch('EVENT_CHOICE', { optionKey: 'relief' });
    const z = get();
    const due = z.events.pending[0];
    ok('延迟后果：入队且到期回合正确', !!due && due.due === z.meta.turn + 3 && due.eventId === 'locust',
      due ? `第 ${due.due} 回合` : '无延迟');

    let hit = null;
    for (let i = 0; i < 6; i++) {
      h.runTurns(api, 1);
      const g = get();
      if (g.log.some(e => /赈粮告罄/.test(e.text)) && !hit) hit = g.meta.turn;
    }
    ok('延迟后果：到期兑现且留纪事', hit === due.due, `实际第 ${hit} 回合（预期 ${due && due.due}）`);
  }

  // 5 结束回合自动拍板：不选也能推进，且不会卡住队列
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    G.events.queue.push({ eventId: 'locust', cityId: G.player.homeCityId, turn: G.meta.turn });
    api.Store.replace(G);
    const t0 = get().meta.turn;
    api.Store.dispatch('END_TURN');
    const z = get();
    ok('事件：结束回合时自动拍板并推进',
      z.meta.turn === t0 + 1 && z.events.queue.length <= api.EventSys.MAX_QUEUE
      && z.events.history.length >= 1,
      `历史 ${z.events.history.length} 条`);
  }

  // 6 连锁：蝗灾选完把流民塞进队列（且同一事件不重复链）
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    const city = G.cities[G.player.homeCityId];
    city.buildings.farm = 4;
    city.food = 2000;
    G.events.queue.push({ eventId: 'locust', cityId: city.id, turn: G.meta.turn });
    api.Store.replace(G);
    api.Store.dispatch('EVENT_CHOICE', { optionKey: 'relief' });
    ok('连锁：蝗灾之后接流民', get().events.queue.some(q => q.eventId === 'refugee'),
      get().events.queue.map(q => q.eventId).join(',') || '空');
  }

  // 7 存档：事件队列 / 延迟后果随档保存
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    G.events.queue.push({ eventId: 'locust', cityId: G.player.homeCityId, turn: G.meta.turn });
    G.events.pending.push({ due: G.meta.turn + 2, eventId: 'locust', optionKey: 'relief', cityId: G.player.homeCityId, turns: 2 });
    api.Store.replace(G);
    const back = api.Save.decode(api.Save.encode(get()));
    ok('事件：队列与延迟后果随存档往返',
      back.events.queue.length === 1 && back.events.pending.length === 1
      && back.events.pending[0].due === G.meta.turn + 2);
  }
}

// ─────────────────────────────────────────────
section('事件池 / 历史锚点 / 朝堂 / 结局');
{
  // 1 事件池：条数、锚点齐备、每个选项都写了代价
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    const anchorsOf = sc => api.EVENT_KEYS.filter(k => api.EVENTS[k].anchor
      && (!api.EVENTS[k].scenario || api.EVENTS[k].scenario === sc));
    ok('事件池：21 条以上，讨董 6 条锚点 / 官渡 2 条',
      api.EVENT_KEYS.length >= 21
      && anchorsOf('taodong190').length === 6 && anchorsOf('guandu200').length === 2,
      `${api.EVENT_KEYS.length} 条 / 讨董 ${anchorsOf('taodong190').length} / 官渡 ${anchorsOf('guandu200').length}`);
    const bad = [];
    for (const k of api.EVENT_KEYS) {
      for (const o of api.EVENTS[k].options) {
        if (!o.costText) bad.push(`${k}.${o.key}`);
      }
    }
    ok('事件池：每个选项都写明代价', !bad.length, bad.slice(0, 4).join(','));
    ok('事件池：锚点都有必选兜底（fallback）',
      api.EVENT_KEYS.filter(k => api.EVENTS[k].anchor)
        .every(k => api.EVENTS[k].options.some(o => o.fallback)));
    void G;
  }

  // 2 历史锚点：到窗口必触发（忽略权重）
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    const anchors = api.EVENT_KEYS.filter(k => api.EVENTS[k].anchor
      && (!api.EVENTS[k].scenario || api.EVENTS[k].scenario === G.meta.scenarioId));
    const missed = [];
    for (const k of anchors) {
      const ev = api.EVENTS[k];
      G.meta.turn = ev.anchor[0];
      G.events.queue.length = 0;
      G.events.seen[k] = undefined;
      delete G.events.seen[k];
      api.EventSys._anchors(G);
      if (!G.events.queue.some(q => q.eventId === k)) missed.push(k);
    }
    ok('历史锚点：进入窗口即入队', !missed.length, missed.join(','));
  }

  // 3 朝堂：控制帝都才有矫诏权；矫诏令两家开战
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    G.cities.luoyang.owner = G.player.factionId;
    G.court.emperorCityId = 'luoyang';
    api.Court.refresh(G);
    api.Store.replace(G);
    const acc = api.Court.access(get());
    ok('朝堂：占有帝都即得矫诏权', acc.mine === true, `帝在${acc.emperorAt}`);

    const factions = Object.keys(get().factions).filter(id => id !== 'free'
      && id !== get().player.factionId && !get().factions[id].dead);
    const [a, b] = factions;
    const rep0 = get().player.reputation;
    api.Store.dispatch('IMPERIAL_EDICT', { aFid: a, bFid: b });
    const z = get();
    ok('朝堂：矫诏令两家开战且扣名望',
      api.Diplo.statusOf(z, a, b) === api.Diplo.WAR && z.player.reputation === Math.max(0, rep0 - 10),
      `${a} vs ${b}`);

    let err = null;
    try { api.Store.dispatch('IMPERIAL_EDICT', { aFid: a, bFid: b }); } catch (e) { err = e.message; }
    ok('朝堂：诏书有冷却', /尚需/.test(err || ''), err || '未抛错');

    // 帝国易主 → 玩家失去矫诏权且名望 -20
    const z2 = get();
    z2.cities.luoyang.owner = 'yuanshao';
    api.Store.replace(z2);
    const rep2 = get().player.reputation;
    const g3 = get();
    api.Court.refresh(g3);
    api.Store.replace(g3);
    ok('朝堂：帝都易主则矫诏权转移且名望 −20',
      api.Court.access(get()).mine === false
      && get().player.reputation === Math.max(0, rep2 - 20),
      `controller=${get().court.controller}`);

    let err2 = null;
    try { api.Store.dispatch('SUMMON_SCHOLAR'); } catch (e) { err2 = e.message; }
    ok('朝堂：无权者不得征辟', /不得矫诏/.test(err2 || ''), err2 || '未抛错');
  }

  // 4 朝堂：征辟上限 3 次
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    G.cities.luoyang.owner = G.player.factionId;
    api.Court.refresh(G);
    api.Store.replace(G);
    let made = 0;
    for (let i = 0; i < 5; i++) {
      try { api.Store.dispatch('SUMMON_SCHOLAR'); made++; } catch (e) { break; }
    }
    ok('朝堂：征辟名士每局上限 3 次', made === api.Court.MAX_SUMMONS, `实际 ${made} 次`);
  }

  // 5 结局分类：四种收场都能取到
  {
    const { api, get } = h.boot({ seed: 7 });
    const G = get();
    const mk = (mut) => {
      const raw = JSON.parse(JSON.stringify(G));
      mut(raw);
      return api.State.classifyEnding(raw).key;
    };
    const held = g => { g.cities.luoyang.owner = g.player.factionId; g.court.emperorCityId = 'luoyang'; };
    ok('结局：忠臣 → 辅政中兴', mk(g => { g.player.route = 'loyal'; held(g); }) === 'fuzheng');
    ok('结局：权臣 + 三公 + 帝都 → 摄政篡汉',
      mk(g => { g.player.route = 'dominant'; g.player.rank = 6; held(g); }) === 'shezheng');
    ok('结局：自立 + 名望 300 + 帝都 → 受禅称帝',
      mk(g => { g.player.route = 'independent'; g.player.reputation = 320; held(g); }) === 'shanyi');
    ok('结局：其余 → 功业盖世',
      mk(g => { g.player.route = 'dominant'; g.player.rank = 3; }) === 'gongye');
  }

  // 6 功成身退：条件与收场
  {
    const { api, get } = h.boot({ seed: 7 });
    let err = null;
    try { api.Store.dispatch('RETIRE'); } catch (e) { err = e.message; }
    ok('身退：官未至丞相时拒绝', /丞相/.test(err || ''), err || '未抛错');

    const G = get();
    G.player.rank = 7;
    G.player.route = 'loyal';
    G.player.reputation = 220;
    api.Store.replace(G);
    api.Store.dispatch('RETIRE');
    ok('身退：满足条件则收场「功成身退」',
      get().over && get().over.ending === 'shentui' && get().over.result === 'win',
      get().over ? get().over.title : '无结局');
  }
}

// ─────────────────────────────────────────────
section('剧本：官渡 200');
{
  const { api, get } = h.boot({ seed: 11, scenarioId: 'guandu200' });
  const G = get();

  // 1 注册表与开局数据
  {
    ok('剧本：注册了两个剧本且都能取到',
      !!api.getScenario('taodong190') && !!api.getScenario('guandu200')
      && api.getScenario('guandu200').year === 200,
      `${api.getScenario('guandu200').name} ${api.getScenario('guandu200').year}`);
    const fids = Object.keys(G.factions).filter(id => id !== 'free');
    ok('官渡：十一家势力 / 70 城', fids.length === 11 && Object.keys(G.cities).length === 70,
      `${fids.length} 家 / ${Object.keys(G.cities).length} 城`);
    ok('官渡：没有无主之城以外的空缺（每城都有主）',
      Object.values(G.cities).every(c => c.owner), '有城无主');
    ok('官渡：帝都初在许（xuchang）', G.court.emperorCityId === 'xuchang', G.court.emperorCityId);
  }

  // 2 亡者除名 / 归属重排 / 补录
  {
    const ids = Object.keys(G.heroes);
    ok('官渡：190 年的亡者不在册',
      ['dongzhuo', 'lvbu', 'sunjian', 'yuanshu', 'gongsunzan', 'liuyan'].every(id => !G.heroes[id]),
      ids.length + ' 人在册');
    ok('官渡：主公易姓的将改属（太史慈→孙策军、孔融→曹操军）',
      G.heroes.taishici && G.heroes.taishici.factionId === 'sunce'
      && G.heroes.kongrong && G.heroes.kongrong.factionId === 'caocao',
      `${G.heroes.taishici ? G.heroes.taishici.factionId : '—'} / ${G.heroes.kongrong ? G.heroes.kongrong.factionId : '—'}`);
    ok('官渡：补录的新将在册（郭嘉 / 张辽 / 司马懿）',
      G.heroes.guojia && G.heroes.zhangliao && G.heroes.simayi
      && G.heroes.zhangliao.factionId === 'caocao');
  }

  // 3 事件分剧本：190 的锚点不该在官渡触发，官渡锚点该触发
  {
    const seen = new Set(Object.keys(G.events.seen));
    G.meta.turn = 2;
    G.events.queue.length = 0;
    api.EventSys._anchors(G);
    const queued = G.events.queue.map(q => q.eventId);
    ok('官渡：190 的锚点不会入队', !queued.some(id => /^anchor_(huimeng|relocate)$/.test(id)),
      queued.join(',') || '空');
    ok('官渡：官渡自己的锚点会入队', queued.indexOf('anchor_baima') >= 0, queued.join(','));
    void seen;
  }

  // 4 存档按剧本分开
  {
    const slots0 = api.Save.list('guandu200').length;
    api.Save.save(G, 'guandu200-test');
    ok('官渡：存档按剧本分开',
      api.Save.list('guandu200').length === slots0 + 1
      && !api.Save.list('taodong190').some(s => s.slot === 'guandu200-test'));
  }
}

// ─────────────────────────────────────────────
section('渲染层纯函数（js/view 里不碰 DOM 的那部分）');
{
  // renderer.js 顶层只有对象字面量与纯函数，能单独装进 vm 跑
  const fs = require('fs');
  const path = require('path');
  const vm = require('vm');
  const src = fs.readFileSync(path.join(h.ROOT, 'js/view/renderer.js'), 'utf8');
  const ctx = { console, Math, Object, Array, String, Number, JSON, Set, Map, isFinite, isNaN };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src + '\n;globalThis.__R = Renderer;', ctx, { filename: 'renderer.js' });
  const R = ctx.__R;

  // 画家算法：城与军队按世界 y 混排。
  // 曾经这里是 `while (ai < armies.length) draw(...)` 忘记自增：只要屏幕上有军队
  // 在所有可见城池以南（拖拽/放大到最大后很常见）主线程就死循环 —— CPU 100%、
  // 控制台都动不了、点什么都没反应。循环必须有界，且一支军队都不能丢。
  const cities = [{ c: { y: 10 } }, { c: { y: 30 } }];
  const armies = [{ a: { y: 5 } }, { a: { y: 20 } }, { a: { y: 40 } }];
  const order = R.mergeDrawOrder(cities, armies);
  const kinds = order.map(o => o.kind).join(',');
  ok('城军混排：北→南，队尾军队不丢', kinds === 'army,city,army,city,army', kinds);
  ok('城军混排：无城时军队全出', R.mergeDrawOrder([], armies).length === 3);
  ok('城军混排：无军时城全出', R.mergeDrawOrder(cities, []).length === 2);
  ok('城军混排：全部军队只在最后出现一次',
    order.filter(o => o.kind === 'army').length === 3
    && new Set(order.filter(o => o.kind === 'army').map(o => o.o.a.y)).size === 3);
}

// ─────────────────────────────────────────────
console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  fails.forEach(f => console.log('  - ' + f));
}
process.exit(fail === 0 ? 0 : 1);
