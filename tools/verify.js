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
console.log(`\n${fail === 0 ? '全部通过' : '有失败'}：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  fails.forEach(f => console.log('  - ' + f));
}
process.exit(fail === 0 ? 0 : 1);
