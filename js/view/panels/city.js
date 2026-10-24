// 视图层 · 城池面板（概览 / 营造 / 士族 / 施政）
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_CITY = {

  // ───────── 武将效果展示的公用小工具 ────────
  _EFF_NAME: {
    wu: '武', tong: '统', zhi: '智', zheng: '政', mei: '魅',
    speed: '行军', cav: '骑兵', defenseCity: '守城', reputation: '名望',
  },
  // 这几个键是百分比，其余是平加
  _EFF_PCT: { speed: 1, cav: 1, defenseCity: 1 },

  /** 宝物效果 → 人看的字：武+4 / 守城+3% */
  _effText(eff) {
    return Object.keys(eff).map(k => {
      const v = eff[k];
      return `${UI_CITY._EFF_NAME[k] || k}${UI_CITY._EFF_PCT[k] ? '+' + Math.round(v * 100) + '%' : '+' + v}`;
    }).join(' ');
  },

  /** 该将身上宝物的效果合计（同类相加） */
  _treasureSum(G, h) {
    const sum = {};
    for (const cat in (h.slots || {})) {
      const def = TREASURES[h.slots[cat]];
      if (!def) continue;
      for (const k in def.eff) sum[k] = (sum[k] || 0) + def.eff[k];
    }
    return sum;
  },

  /**
   * 该将在本城的战力倍率（统率 + 特技 + 忠诚 + 甲胄）——
   * 把同一支样板兵带一遍有将 / 无将，比值就是这个人实际值多少。换将换宝，这个数当场变。
   */
  _heroPowerMul(G, c, h, isDef) {
    const opts = {
      terrain: c.terrain, isDefender: !!isDef, morale: 60,
      enemyTroops: { inf: 1000 }, factionId: c.owner,
      wall: isDef ? c.wall : 0, drill: State.bld(c, 'drill'),
    };
    const base = Combat.power(G, { inf: 1000 }, null, opts);
    const withHero = Combat.power(G, { inf: 1000 }, h.id, opts);
    return base > 0 ? withHero / base : 0;
  },

  // ───────── 城池面板 ─────────
  // ───────── 直辖城切换条：一眼看全城状态，点即切换，不用回地图 ─────────
  renderRail(G) {
    const rail = UI.$('cityRail');
    if (!rail) return;
    const cities = State.demesne(G);
    if (cities.length < 2 || G.over) { rail.classList.add('hidden'); return; }
    rail.classList.remove('hidden');

    const slots = c => State.buildSlots(c) - c.buildQueue.length;
    rail.innerHTML = cities.map(c => {
      const bd = [];
      if (slots(c) > 0) bd.push(['营', '']);
      const fill = troopTotal(c.garrison) / Math.max(1, State.troopCapOf(G, c));
      if (fill < 0.95) bd.push(['兵', fill < 0.6 ? 'bad' : 'warn']);
      if (State.clanSat(c) < 45) bd.push(['族', 'warn']);
      if (c.unrest > 0) bd.push(['安', 'warn']);
      if (c.food < State.foodCapOf(G, c) * 0.3) bd.push(['粮', 'bad']);
      const on = c.id === UI.selectedId;
      const tags = bd.map(([k, cls]) => `<span class="bdg ${cls}">${k}</span>`).join('');
      return `<span class="chip ${on ? 'on' : ''}" data-city="${c.id}" title="${U.esc(c.name)} · 兵 ${U.num(troopTotal(c.garrison))}/${U.num(State.troopCapOf(G, c))} · 士族 ${Math.round(State.clanSat(c))}${c.policy ? ' · ' + POLICIES[c.policy].name : ''}">${U.esc(c.name)}${tags}</span>`;
    }).join('');

    rail.onclick = e => {
      const el = e.target.closest('.chip[data-city]');
      if (el) UI.selectCity(el.dataset.city);
    };
  },

  /** 切城：只换选中与高亮，不挪镜头（避免地图乱跳） */
  selectCity(cityId) {
    const G = Store.get();
    if (!G || !G.cities[cityId]) return;
    UI.selectedId = cityId;
    Renderer.selectedId = cityId;
    UI.hideCityTip();
    UI.render(G);
  },

  /** 切换条上的上一个 / 下一个直辖城（键盘 ← →） */
  cycleCity(step) {
    const G = Store.get();
    if (!G) return false;
    const ids = State.demesne(G).map(c => c.id);
    if (ids.length < 2) return false;
    const i = ids.indexOf(UI.selectedId);
    const next = i < 0 ? 0 : (i + step + ids.length) % ids.length;
    UI.selectCity(ids[next]);
    return true;
  },

  // ───────── 一键理政条（直辖城 > 1 时显示在城池页顶部） ─────────
  renderBulk(G) {
    const bar = UI.$('bulkBar');
    if (!bar) return;
    const cities = State.demesne(G);
    if (cities.length < 2 || G.over) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');

    const cur = cities[0].policy;
    const sameParty = cities.every(c => c.policy === cur) ? cur : '__mixed';
    const polBtns = Object.keys(POLICIES).map(k =>
      `<button data-pol="${k}" class="${sameParty === k ? 'on' : ''}" title="${U.esc(POLICIES[k].desc)}">${POLICIES[k].name}</button>`).join('');
    const lowClan = cities.filter(c => State.clanSat(c) < 45).length;
    const short = cities.filter(c => troopTotal(c.garrison) < State.troopCapOf(G, c) * 0.95).length;

    bar.innerHTML =
      `<div class="bk-head">一键理政 · 全体 ${cities.length} 城</div>
       <div class="bk-row"><span class="bk-lab">方针</span>${polBtns}
         <button data-pol="__none" class="${sameParty === null ? 'on' : ''}">亲理</button></div>
       <div class="bk-row"><span class="bk-lab">省事</span>
         <button data-bulk="fill">一键补兵${short ? `（${short}）` : ''}</button>
         <button data-bulk="clan">安抚士族${lowClan ? `（${lowClan}）` : ''}</button></div>
       <div class="bk-row"><span class="bk-lab">同造</span>
         ${['farm', 'lumber', 'barracks', 'wall', 'market', 'granary'].map(k => {
           const n = cities.filter(c => Build.canBuild(G, c, k).ok).length;
           return `<button data-buildall="${k}" title="${U.esc(BUILDINGS[k].name)}：${n} 城可开工">${BUILDINGS[k].name}${n ? `（${n}）` : ''}</button>`;
         }).join('')}</div>`;

    bar.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      const G2 = Store.get();
      try {
        if (b.dataset.pol) {
          const p = b.dataset.pol === '__none' ? null : b.dataset.pol;
          const r = Store.dispatch('SET_POLICY_ALL', { policy: p });
          UI.flash(p ? `${r.total} 城行「${POLICIES[p].name}」之政，每月自动营建征兵。` : '诸城收归亲理。');
        } else if (b.dataset.bulk === 'fill') {
          const r = Store.dispatch('BATCH_FILL', { cityIds: State.demesne(G2).map(c => c.id) });
          UI.flash(`一键补兵：${r.cities} 城共募 ${U.num(r.total)}。`);
        } else if (b.dataset.buildall) {
          const r = Store.dispatch('BATCH_BUILD', { key: b.dataset.buildall });
          UI.flash(`同造${BUILDINGS[b.dataset.buildall].name}：${r.done} 城开工${r.skip ? `，${r.skip} 城未动` : ''}。`);
        } else if (b.dataset.bulk === 'clan') {
          const r = Store.dispatch('BATCH_PACIFY', {});
          UI.flash(`安抚 ${r.done} 城士族${r.held ? `（${r.held} 城未动）` : ''}。`);
        }
      } catch (err) { UI.flash(err.message, 'bad'); }
    };
  },

  renderSel(G) {
    const panel = UI.$('selPanel');
    const noSel = UI.$('noSel');
    const c = UI.selectedId ? G.cities[UI.selectedId] : null;

    if (!c) {
      panel.classList.add('hidden');
      noSel.classList.remove('hidden');
      return;
    }
    panel.classList.remove('hidden');
    noSel.classList.add('hidden');

    const f = G.factions[c.owner];
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const gov = c.governor ? G.heroes[c.governor] : null;

    UI.$('selName').textContent = c.name;
    const ownerEl = UI.$('selOwner');
    ownerEl.textContent = (f ? f.name : '—') + (isDemesne ? ' · 直辖' : '');
    ownerEl.style.setProperty('--c', f ? f.color : 'var(--ink)');

    UI.$('selSub').textContent =
      `${c.region} · ${TERRAIN[c.terrain].name}`
      + (gov ? ` · 守将 ${gov.name}` : ' · 无守将')
      + (c.policy ? ` · ${POLICIES[c.policy].name}` : '')
      + (() => {
          if (!c.rallyTo || !G.cities[c.rallyTo]) return '';
          const st = Rally.status(G, c);
          const tag = st.code === 'moving' ? '（送）' : st.code === 'full' ? '（满）'
            : st.code === 'low' ? '（兵少）' : st.code === 'ready' ? '（待发）' : '';
          return ` · 补给→${G.cities[c.rallyTo].name}${tag}`;
        })();

    const hint = UI.$('selHint');
    if (UI.pending && UI.pending.type === 'dispatch') {
      hint.classList.remove('hidden');
      UI._tint(hint, null);
      hint.textContent = `已选 ${G.cities[UI.pending.fromId].name}，抽兵 ${Math.round(UI.pending.ratio * 100)}%。点地图上目标城池进军（悬停看胜算）。`;
    } else {
      hint.classList.add('hidden');
    }

    const pane = UI.$('cityPane');
    const scroll = pane.scrollTop;
    if (UI.cityTab === 'build') UI.paneBuild(G, c);
    else if (UI.cityTab === 'clans') UI.paneClans(G, c);
    else if (UI.cityTab === 'heroes') UI.paneHeroes(G, c);
    else if (UI.cityTab === 'policy') UI.panePolicy(G, c);
    else UI.paneOverview(G, c);
    pane.scrollTop = scroll;
  },

  /** 本方非直辖城的说明 + 「收归直辖」入口（满员时列出要交出的城） */
  fillNonDemesne(box, G, c) {
    box.innerHTML = '';
    const own = c.owner === G.player.factionId;
    if (!own) {
      const total = troopTotal(c.garrison);
      box.innerHTML = `<span class="dim">${total > 0 ? '敌军城池' : '空城'}</span>`;
      return;
    }

    const cap = cityCap(G.player);
    const full = G.player.demesne.length >= cap;
    const info = document.createElement('div');
    info.className = 'dim lh-17';
    info.innerHTML = `本方势力城池 · 非你直辖，不可营造 / 征兵 / 调兵<br>`
      + `直辖 <b>${G.player.demesne.length}/${cap}</b>`
      + `${full ? ' 已满 · 收归须先交出一座' : ''}`;
    box.appendChild(info);
    if (G.over) return;

    const act = document.createElement('div');
    act.className = 'actions';
    act.appendChild(UI._btn(full ? '收归直辖（须交出一座）' : '收归直辖', '', () => {
      if (!full) {
        try { Store.dispatch('SET_DEMESNE', { cityId: c.id }); }
        catch (e) { UI.toast(e.message); }
        return;
      }
      UI._swapFor = UI._swapFor === c.id ? null : c.id;
      UI.render(G);
    }));
    box.appendChild(act);

    if (UI._swapFor === c.id && full) {
      const pick = document.createElement('div');
      pick.className = 'actions';
      for (const id of G.player.demesne) {
        const dc = G.cities[id];
        if (!dc) continue;
        pick.appendChild(UI._btn(`交出 ${dc.name}`, '', () => {
          UI._swapFor = null;
          try { Store.dispatch('SET_DEMESNE', { cityId: c.id, releaseId: id }); }
          catch (e) { UI.toast(e.message); }
        }));
      }
      box.appendChild(pick);
    }
  },

  _statGrid(rows) {
    return rows.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');
  },

  _btn(label, sub, onclick, reason) {
    const b = document.createElement('button');
    b.innerHTML = sub ? `${label}<span class="dim fs-tiny"> ${sub}</span>` : label;
    if (reason) { b.disabled = true; b.title = reason; }
    b.onclick = onclick;
    return b;
  },

  paneOverview(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const caps = State.troopCapByType(G, c);
    const capTotal = State.troopCapOf(G, c);
    const total = troopTotal(c.garrison);
    const clanSat = Math.round(State.clanSat(c));
    // 月产与结算共用同一份公式（Economy.project），面板数字就是真进账数字
    const P = Economy.project(G, c);
    const pt = P.parts;

    const rows = [
      ['丁口 / 户籍', `${Math.round(c.pop)} / ${State.popMaxOf(G, c)}`],
      ['治安', `${Math.round(c.order)}`],
      ['城墙', `${c.wall.toFixed(1)} / ${State.wallMaxOf(c)}`],
      ['士族', `${clanSat}`],
      ['城库钱', U.num(c.gold)],
      ['存粮', `${U.num(c.food)} / ${U.num(State.foodCapOf(G, c))}`],
      ['建材', U.num(c.mat)],
      ['铁料', U.num(c.iron)],
      ['驻军', `${U.num(total)} / ${U.num(capTotal)}`],
      ['城内宝物', State.treasuresAt(G, c.id).length
        ? `${State.treasuresAt(G, c.id).length} 件` : '—'],
      ['月净粮', U.signed(P.foodOut - P.armyUpkeep - P.popUpkeep)],
      ['月入钱', U.signed(P.goldOut)],
      ['月入建材', U.signed(P.matOut)],
      ['月入铁料', U.signed(P.ironOut)],
    ];

    let html = `<div class="statgrid">${UI._statGrid(rows)}</div>`;

    // 月产明细：每一项乘数都摊开，天赋 / 科技 / 士族 / 守将 / 军区的效果一望即知
    const f2 = v => v.toFixed(2);
    const talSuffix = id => (pt.talent.id ? `天赋${f2(pt.talent[id] || 1)}` : '天赋—');
    html += `<div class="seclabel">月产从哪来</div>`;
    html += `<div class="capformula">`
      + `粮 ${U.num(P.foodOut)} = 农田(${pt.farm})×78 × 季${f2(pt.season.food)} × 丁${f2(pt.popFactor)} × 治${f2(pt.orderFactor)}`
      + ` × 族${f2(pt.clanMul)} × 将${f2(pt.skillMul)} × 区${f2(pt.legionEco)} × 交${f2(pt.bondMul)}`
      + ` × 科${f2(pt.tech.food)} × ${talSuffix('food')}<br>`
      + `钱 ${U.num(P.goldOut)} = 市集(${pt.market})×30 × 季${f2(pt.season.tax)} × 丁 × 治`
      + ` × 族${f2(pt.clanMul)} × 将${f2(pt.skillMul)} × 区${f2(pt.legionEco)} × 交${f2(pt.bondMul)}`
      + ` × 科${f2(pt.tech.gold)} × 关市${f2(pt.customs)} × ${talSuffix('gold')}<br>`
      + `建材 ${U.num(P.matOut)} = (28 + 伐木(${pt.lumber})×13 + 采石(${pt.quarry})×21) × 季${f2(pt.season.mat)}`
      + ` × 科${f2(pt.tech.mat)} × 族${f2(pt.clanMul)} × ${talSuffix('mat')}<br>`
      + `铁料 ${U.num(P.ironOut)} = (4 + 冶铁(${pt.ironworks})×7) × 科${f2(pt.tech.iron)}`
      + ` × 族${f2(pt.clanMul)} × ${talSuffix('iron')}<br>`
      + `军耗粮 ${U.num(P.armyUpkeep)}　民食 ${U.num(P.popUpkeep)}`
      + `</div>`;
    html += `<div class="capnote">`
      + `丁 = 丁口系数　治 = 治安　族 = 士族均心　将 = 守将政治　区 = 军区都督政略　交 = 守将私交`
      + `　科 = 势力科技　天赋 = 开局天赋（<b>只作用于你的直辖城</b>）。<br>`
      + `上限：粮 ${U.num(P.foodCap)} · 建材 ${U.num(P.matCap)} · 铁料 ${U.num(P.ironCap)}。`
      + `</div>`;

    html += `<div class="seclabel">驻军 / 兵种兵额</div>`;
    html += `<div class="statgrid">${TROOP_KEYS.map(k =>
      `<span class="k">${TROOPS[k].short}</span><span class="v">${U.num(c.garrison[k] || 0)}<span class="dim"> / ${U.num(caps[k])}</span></span>`
    ).join('')}</div>`;

    // 兵额推导（与校验同一份公式）
    const bd = State.troopCapBreakdown(G, c);
    html += `<div class="seclabel">兵额上限从哪来</div>`;
    html += `<div class="capformula">`
      + `户籍 ${U.num(bd.hukou)} × (1.9 + 农田 ${bd.farm} × 0.9) = <b>${U.num(Math.round(bd.popBase))}</b><br>`
      + `× 治安 ${bd.orderMul.toFixed(2)}　× 兵营(${bd.barracks}) ${bd.barracksMul.toFixed(2)}<br>`
      + `× 校场(${bd.drill}) ${bd.drillMul.toFixed(2)}　× 士族(心${Math.round(bd.clanSat)}) ${bd.clanMul.toFixed(2)}<br>`
      + `× 科技 ${bd.techMul.toFixed(2)}　= <b class="gold-bright-ink">${U.num(bd.total)}</b>`
      + `</div>`;
    html += `<div class="capnote">兵额 = <b>户籍 × 农田</b> 打底，再乘治安、兵营、校场、士族满意度、军制科技。`
      + `户籍靠建造<b>府衙</b>与农政科技提升。<br>`
      + `征兵只消耗<b>丁口</b>（影响钱粮产出，每月回升），<b>不动户籍</b>，所以不会越征上限越低。<br>`
      + `骑兵另需<b>马场</b>（每级 +12% 骑兵额），水军另需<b>船坞</b>，器械受<b>冶铁坊</b>加成。</div>`;

    if (c.buildQueue.length) {
      html += `<div class="dim fs-label mt-6">在建</div>`;
      for (const j of c.buildQueue) {
        const pct = Math.round((1 - j.left / j.total) * 100);
        html += `<div class="qrow"><span>${BUILDINGS[j.key].name}→${j.to}</span>
          <div class="qbar"><div style="--w:${pct}%"></div></div>
          <span class="dim">${j.left}月</span></div>`;
      }
    }

    pane.innerHTML = html;

    const box = document.createElement('div');
    box.className = 'actions';

    if (!isDemesne) {
      UI.fillNonDemesne(box, G, c);
      pane.appendChild(box);
      return;
    }
    if (G.over) {
      box.innerHTML = `<span class="dim">战局已终</span>`;
      pane.appendChild(box);
      return;
    }

    // 一键补兵
    if (total < capTotal) {
      box.appendChild(UI._btn('一键补兵', `缺口 ${U.num(capTotal - total)}`, () => {
        try { Store.dispatch('FILL_TROOPS', { cityId: c.id, ratio: 1 }); }
        catch (e) { UI.toast(e.message); }
      }, null));
    }

    // 征兵（按钮上直接标出 钱 / 人口 双成本）
    const defs = [['inf', 300], ['inf', 800], ['arc', 300], ['cav', 300]];
    if (State.bld(c, 'shipyard') > 0) defs.push(['nvy', 300]);
    if (State.bld(c, 'ironworks') > 0) defs.push(['siege', 150]);

    for (const [troop, amt] of defs) {
      let reason = null;
      try { Recruit.check(G, c, troop, amt); } catch (e) { reason = e.message; }
      const cost = Economy.recruitCost(amt, troop);
      box.appendChild(UI._btn(`募${TROOPS[troop].short}${amt}`,
        reason ? reason : `${cost.gold}钱 ${cost.pop}口`, () => {
        try { Store.dispatch('RECRUIT', { cityId: c.id, troop, amount: amt }); }
        catch (e) { UI.toast(e.message); }
      }, reason));
    }

    const sep = document.createElement('div');
    sep.className = 'brk';
    box.appendChild(sep);

    if (total >= 20) {
      for (const r of [0.3, 0.5, 0.7, 0.9]) {
        box.appendChild(UI._btn(`出兵 ${Math.round(r * 100)}%`, null, () => {
          UI.pending = { type: 'dispatch', fromId: c.id, ratio: r };
          Renderer.targeting = true;
          UI.$('map').classList.add('targeting');
          UI.render(G);
        }));
      }
    } else {
      box.innerHTML += `<span class="dim">兵力不足，无法出征</span>`;
    }

    if (!isDemesne) {
      const extra = document.createElement('div');
      extra.className = 'actions';
      UI.fillNonDemesne(extra, G, c);
      box.appendChild(extra);
    }

    pane.appendChild(box);
  },

  paneBuild(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const free = Build.queueFree(c);
    const slots = State.buildSlots(c);

    let html = `<div class="dim mb-4">工程位 ${c.buildQueue.length}/${slots}`
      + `${slots > 1 ? '（府衙 3 级）' : '（府衙 3 级可并行 2 项）'}</div>`;

    if (c.buildQueue.length) {
      c.buildQueue.forEach((j, i) => {
        const pct = Math.round((1 - j.left / j.total) * 100);
        html += `<div class="qrow">
          <span class="minw-74">${BUILDINGS[j.key].name}→${j.to}</span>
          <div class="qbar"><div style="--w:${pct}%"></div></div>
          <span class="dim">${j.left}月</span>
          ${isDemesne ? `<button class="mini" data-cancel="${i}">撤</button>` : ''}
        </div>`;
      });
    }

    // 能建的排前面（造价低的优先），被卡住的沉底并直接写出原因
    const rows = BUILDING_KEYS.map(key => {
      const d = BUILDINGS[key];
      const lv = State.bld(c, key);
      const maxed = lv >= d.max;
      let reason = null;
      if (!isDemesne) reason = '非你直辖之城';
      else if (G.over) reason = '战局已终';
      else {
        const chk = Build.canBuild(G, c, key);
        if (!chk.ok) reason = chk.why;
      }
      const cost = Build.costOf(G, c, key);
      return {
        key, d, lv, maxed, reason, cost,
        turns: Build.turnsOf(G, key, lv, c),
        rank: maxed ? 2 : (reason ? 1 : 0),
      };
    }).sort((a, b) => a.rank - b.rank || a.cost.gold - b.cost.gold);

    const canCount = rows.filter(r => !r.rank).length;
    html += `<div class="dim fs-label my-6-3">可营造 ${canCount} 项（按造价排序，卡住的沉底）</div>`;

    for (const r of rows) {
      const costTxt = r.maxed ? '—'
        : `${r.cost.gold}钱 ${r.cost.mat}料${r.cost.iron ? ' ' + r.cost.iron + '铁' : ''}`;
      html += `<div class="brow ${r.maxed ? 'maxed' : (r.reason ? 'locked' : '')}"
        title="${U.esc(r.d.desc)}｜${U.esc(r.d.effect(Math.max(1, r.lv)))}">
        <span class="bname">${r.d.name}${(!r.rank) ? '<span class="bdg">可建</span>' : ''}</span>
        <span class="blv">${r.lv}/${r.d.max}</span>
        <span class="bcost">${r.reason && !r.maxed ? U.esc(r.reason) : costTxt}</span>
        <button data-build="${r.key}" ${(r.maxed || r.reason) ? 'disabled' : ''}
          title="${U.esc(r.reason || `工期 ${r.turns} 月`)}">${r.maxed ? '满' : `${r.turns}月`}</button>
      </div>`;
    }

    pane.innerHTML = html;

    if (!isDemesne) {
      const box = document.createElement('div');
      box.className = 'actions mt-8';
      UI.fillNonDemesne(box, G, c);
      pane.appendChild(box);
      return;
    }

    for (const b of pane.querySelectorAll('button[data-build]')) {
      b.onclick = () => {
        try { Store.dispatch('BUILD', { cityId: c.id, key: b.dataset.build }); }
        catch (e) { UI.toast(e.message); }
      };
    }
    for (const b of pane.querySelectorAll('button[data-cancel]')) {
      b.onclick = () => {
        try { Store.dispatch('CANCEL_BUILD', { cityId: c.id, index: Number(b.dataset.cancel) }); }
        catch (e) { UI.toast(e.message); }
      };
    }
  },

  paneClans(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const sat = State.clanSat(c);

    if (!c.clans || !c.clans.length) {
      pane.innerHTML = `<div class="dim">此城无大族。</div>`;
      return;
    }

    let html = `<div class="dim mb-5">
      士族均心 <b class="${sat > 60 ? 'sat-good' : sat > 40 ? 'sat-mid' : 'sat-bad'}">${Math.round(sat)}</b>
      · 钱粮产出 ×${State.clanEconMul(c).toFixed(2)}
      · 兵额战力 ×${State.clanMilMul(c).toFixed(2)}
    </div>`;

    for (const cl of c.clans) {
      html += `<div class="clan">
        <div class="crow">
          <span class="cname">${U.esc(cl.name)}</span>
          <span class="dim">心 ${Math.round(cl.sat)} · 势 ${Math.round(cl.inf)}</span>
        </div>
        <div class="barbox">
          <span class="dim fs-tiny">心</span>
          <div class="bar sat"><div style="--w:${Math.round(cl.sat)}%"></div></div>
          <span class="dim fs-tiny">势</span>
          <div class="bar inf"><div style="--w:${Math.round(cl.inf)}%"></div></div>
        </div>
      </div>`;
    }

    html += `<div class="dim mt-6 lh">
      均心低于 28 且影响力高时，有叛乱之虞（折兵、掠库、治安大跌）。<br>
      战乱邻近、兵额过载、断粮都会压低士气。
    </div>`;

    pane.innerHTML = html;

    const box = document.createElement('div');
    box.className = 'actions';

    if (!isDemesne) {
      UI.fillNonDemesne(box, G, c);
      pane.appendChild(box);
      return;
    }
    if (G.over) {
      box.innerHTML = `<span class="dim">战局已终</span>`;
      pane.appendChild(box);
      return;
    }

    const cool = c.clanActionTurn ? Math.max(0, 3 - (G.meta.turn - c.clanActionTurn)) : 0;
    const coolMsg = cool > 0 ? `士族新定，尚需 ${cool} 月方可再动` : null;

    const act = (kind, label, sub, checkReason) => {
      box.appendChild(UI._btn(label, sub, () => {
        try { Store.dispatch('CLAN_ACTION', { cityId: c.id, action: kind }); }
        catch (e) { UI.toast(e.message); }
      }, coolMsg || checkReason));
    };

    act('pacify', '安抚', '200钱 120粮', c.gold < 200 ? '钱不足' : c.food < 120 ? '粮不足' : null);
    act('recruit', '征辟', '500钱', c.gold < 500 ? '钱不足' : null);
    act('suppress', '打压', '免费', null);

    pane.appendChild(box);
  },

  /** 人物：忠诚 / 野心 / 私交 / 积怨 + 四个命令（docs/HERO.md §1.7） */
  paneHeroes(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const heroes = Object.values(G.heroes).filter(h =>
      h.alive && h.id !== PLAYER_HERO_ID && h.factionId === c.owner
      && (h.cityId === c.id || c.governor === h.id));

    if (!heroes.length) {
      pane.innerHTML = `<div class="dim">此城无将。</div>`;
      return;
    }

    heroes.sort((a, b) => (b.id === c.governor ? 1 : 0) - (a.id === c.governor ? 1 : 0) || b.tong - a.tong);

    let html = `<div class="dim mb-5 lh-17">
      忠诚 &lt; 30 且野心 &gt; 60 者会叛：叛前一月有预警，3 月内赏赐 / 抚慰可挽；
      守将忠诚影响守城战力，私交影响城池产出。
    </div>`;

    for (const h of heroes) {
      const loy = Math.round(h.loyalty || 0);
      const bond = Math.round(h.bond || 0);
      const amb = Math.round(h.ambition || 0);
      const sk = skillOf(G, h);
      const isGov = h.id === c.governor;
      const tags = [];
      if (isGov) tags.push('守将');
      if (amb > 60) tags.push(`野心 ${amb}`);
      if ((h.grievance || 0) > 0) tags.push(`积怨 ${h.grievance}`);
      if ((h.idle || 0) >= 6) tags.push(`闲置 ${h.idle} 月`);

      // 五维读数：本体 + 宝物（dim 加号后是宝物贡献，不做二次累加）
      const statText = ['wu', 'tong', 'zhi', 'zheng', 'mei'].map(k => {
        const raw = h[k] || 0;
        const b = State.heroStat(G, h.id, k) - raw;
        return `${UI_CITY._EFF_NAME[k]}${raw}${b ? `<span class="dim">+${b}</span>` : ''}`;
      }).join(' ');

      // 特技 + 它在本文城实际值多少（守将算守城，其余算带队）
      const mul = UI_CITY._heroPowerMul(G, c, h, isGov);
      const mulText = `本城${isGov ? '守城' : '带队'}战力 ×${mul.toFixed(2)}（含统率${State.heroStat(G, h.id, 'tong')}）`
        + (isGov ? `，守军合计 ${U.num(Combat.defenseScore(G, c))}` : '');
      const skillLine = (sk.name ? `${sk.name}：${sk.desc}` : '无特技') + ' → ' + mulText;

      const trSum = UI_CITY._treasureSum(G, h);
      const trLine = Object.keys(trSum).length
        ? `<div class="dim fs-tiny">宝物合计：${UI_CITY._effText(trSum)}</div>`
        : '<div class="dim fs-tiny">未佩宝</div>';

      html += `<div class="clan" data-hero="${h.id}">
        <div class="crow">
          <span class="cname">${U.esc(h.name)}</span>
          <span class="dim">${statText}</span>
        </div>
        <div class="barbox">
          <span class="dim fs-tiny">忠</span>
          <div class="bar sat"><div style="--w:${loy}%"></div></div>
          <span class="dim fs-tiny">私</span>
          <div class="bar inf"><div style="--w:${bond}%"></div></div>
        </div>
        <div class="dim fs-tiny">${skillLine}</div>
        ${trLine}
        <div class="dim fs-tiny">${tags.join(' · ') || '平平无奇'}</div>
      </div>`;
    }

    pane.innerHTML = html;

    if (!isDemesne || G.over) {
      if (!isDemesne) pane.insertAdjacentHTML('beforeend', `<div class="dim mt-8">非你直辖之城，不可赏罚任免。</div>`);
      return;
    }

    const turn = G.meta.turn;
    for (const h of heroes) {
      const row = pane.querySelector(`[data-hero="${h.id}"]`);
      if (!row) continue;
      const box = document.createElement('div');
      box.className = 'actions';

      const cd = h.cd || {};
      const cool = (kind, months) => (cd[kind] && turn - cd[kind] < months
        ? `尚需 ${months - (turn - cd[kind])} 月` : null);
      const cost = 80 * (1 + G.player.rank);

      const run = (type, payload) => () => {
        try { Store.dispatch(type, payload); } catch (e) { UI.toast(e.message); }
      };

      box.appendChild(UI._btn(`赏赐 ${cost}钱`, '忠+6 私+10',
        run('REWARD_HERO', { heroId: h.id }),
        cool('reward', 3) || (c.gold < cost ? '钱不足' : null)));

      box.appendChild(UI._btn('提拔为守', '战功-5 私+14',
        run('PROMOTE_HERO', { heroId: h.id, cityId: c.id }),
        c.governor === h.id ? '已是守将'
          : (c.promoteTurn && turn - c.promoteTurn < 6 ? `此城人事初定，尚需 ${6 - (turn - c.promoteTurn)} 月`
            : (G.player.merit < 5 ? '战功不足' : null))));

      box.appendChild(UI._btn('责罚', '忠-10 积怨+1 治安+3',
        run('PUNISH_HERO', { heroId: h.id }),
        c.governor === h.id ? cool('punish', 5) : '只可责罚守将'));

      box.appendChild(UI._btn('抚慰 60粮', '积怨-1 私+5',
        run('CONSOLE_HERO', { heroId: h.id }),
        (h.grievance || 0) <= 0 ? '并无积怨'
          : (cool('console', 3) || (c.food < 60 ? '粮不足' : null))));

      row.appendChild(box);

      // 宝物槽：已装备的点击即卸下（回到本城府库）
      const slotBox = document.createElement('div');
      slotBox.className = 'tslots';
      for (const cat of TREASURE_CATS) {
        const tid = h.slots && h.slots[cat];
        const def = tid ? TREASURES[tid] : null;
        const btn = document.createElement('button');
        btn.className = 'tslot' + (def ? ` on r${def.rare}` : '');
        btn.textContent = def ? `${TREASURE_CAT_NAME[cat]}·${def.name} ${UI_CITY._effText(def.eff)}`
          : `${TREASURE_CAT_NAME[cat]}·空`;
        btn.title = def ? `${def.name}：${UI_CITY._effText(def.eff)}\n${def.about}（点击卸下）`
          : `${TREASURE_CAT_NAME[cat]}槽未装`;
        if (def) btn.onclick = () => {
          try { Store.dispatch('UNEQUIP_TREASURE', { heroId: h.id, cat }); }
          catch (e) { UI.toast(e.message); }
        };
        else btn.disabled = true;
        slotBox.appendChild(btn);
      }
      row.appendChild(slotBox);

      // 本城府库里能装的东西
      const avail = State.treasuresAt(G, c.id)
        .filter(tid => !(h.slots || {})[TREASURES[tid].cat]);
      if (avail.length) {
        const pool = document.createElement('div');
        pool.className = 'tpool';
        for (const tid of avail) {
          const def = TREASURES[tid];
          const b = document.createElement('button');
          b.className = 'tslot';
          b.textContent = `装 ${def.name} ${UI_CITY._effText(def.eff)}`;
          b.title = `${TREASURE_CAT_NAME[def.cat]}：${UI_CITY._effText(def.eff)}\n${def.about}`;
          b.onclick = () => {
            try { Store.dispatch('EQUIP_TREASURE', { heroId: h.id, treasureId: tid }); }
            catch (e) { UI.toast(e.message); }
          };
          pool.appendChild(b);
        }
        row.appendChild(pool);
      }
    }

    // 商人天赋：一次性花 600 钱买一件宝（docs/HERO.md §4.2 ④）
    if (talentOf(G).id === 'merchant' && !G.player.boughtTreasure) {
      const bar = document.createElement('div');
      bar.className = 'actions';
      bar.appendChild(UI._btn('市肆购宝 600钱', '商人天赋 · 只此一次', () => {
        try {
          const r = Store.dispatch('BUY_TREASURE');
          UI.toast(`得${TREASURES[r.treasureId].name}一件`);
        } catch (e) { UI.toast(e.message); }
      }, c.gold < 600 ? '钱不足' : null));
      pane.appendChild(bar);
    }

    // 在野名士：三档登用（拜访 / 送礼 / 三顾），成功率逐项列出
    const free = Object.values(G.heroes)
      .filter(h => h.alive && h.factionId === 'free')
      .sort((a, b) => (b.tong + b.zhi) - (a.tong + a.zhi))
      .slice(0, 6);
    if (!free.length) return;

    const sec = document.createElement('div');
    sec.className = 'seclabel';
    sec.textContent = '在野名士（可延揽）';
    pane.appendChild(sec);

    const tierDefs = ['visit', 'gift', 'beseech'];
    for (const h of free) {
      const box = document.createElement('div');
      box.className = 'clan';

      const ch = Relations.recruitChance(G, h, 'beseech');
      const parts = ch.parts.map(([k, v]) => `${k}${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`).join(' ');
      box.innerHTML = `<div class="crow">
        <span class="cname">${U.esc(h.name)}</span>
        <span class="dim">武${h.wu} 统${h.tong} 智${h.zhi} 政${h.zheng} 魅${h.mei}</span>
      </div>
      <div class="dim fs-tiny">野心 ${Math.round(h.ambition || 0)} · 私交 ${Math.round(h.bond || 0)} · 三顾胜算 ${Math.round(ch.p * 100)}%<br>
        <span class="fs-tiny">${parts}</span>${ch.burnt ? '<br>已连败三次，其意难回' : ''}</div>`;

      const acts = document.createElement('div');
      acts.className = 'actions';
      for (const t of tierDefs) {
        const def = Relations.TIERS[t];
        const ch2 = Relations.recruitChance(G, h, t);
        const last = (h.visits || {})[t] || 0;
        const cool = last && G.meta.turn - last < def.cd
          ? `尚需 ${def.cd - (G.meta.turn - last)} 月` : null;
        const cost = `${def.gold}钱${def.food ? ` ${def.food}粮` : ''}`;
        acts.appendChild(UI._btn(`${def.name} ${Math.round(ch2.p * 100)}%`, cost, () => {
          try {
            const r = Store.dispatch(t === 'visit' ? 'VISIT_HERO'
              : t === 'gift' ? 'GIFT_HERO' : 'BESEECH_HERO', { heroId: h.id });
            UI.toast(r && r.ok ? `${h.name}愿附明公` : `${h.name}未应（胜算 ${Math.round((r ? r.chance : 0) * 100)}%）`);
          } catch (e) { UI.toast(e.message); }
        }, cool || (c.gold < def.gold ? '钱不足'
          : (def.food && c.food < def.food ? '粮不足' : null))));
      }
      box.appendChild(acts);
      pane.appendChild(box);
    }
  },

  panePolicy(G, c) {
    const pane = UI.$('cityPane');
    const isDemesne = c.grantedTo === PLAYER_HERO_ID;
    const gov = c.governor ? G.heroes[c.governor] : null;
    const caps = State.troopCapByType(G, c);

    let html = `<div class="statgrid">${UI._statGrid([
      ['守将', gov ? `${gov.name}（统 ${gov.tong}）` : '无'],
      ['当前方针', c.policy ? POLICIES[c.policy].name : '未委任（亲理）'],
      ['兵额上限', U.num(State.troopCapOf(G, c))],
      ['工程位', State.buildSlots(c)],
      ['步/弓', `${U.num(caps.inf)} / ${U.num(caps.arc)}`],
      ['骑/水/器', `${U.num(caps.cav)} / ${U.num(caps.nvy)} / ${U.num(caps.siege)}`],
    ])}</div>`;

    html += `<div class="dim mt-8 lh">
      委任太守后，每月自动按方营造、征兵，不必逐一手动。<br>
      你仍可随时手动操作同一座城，二者叠加。
    </div>`;

    // 持续调兵（补给线）
    const rTarget = c.rallyTo ? G.cities[c.rallyTo] : null;
    html += `<div class="seclabel">持续调兵（补给线）</div>`;
    if (rTarget) {
      const st = Rally.status(G, c);
      const d = Rally.detail(G, c, rTarget.id);

      html += `<div class="capformula ally-box">
        补给目标 <b class="ally-ink">${rTarget.name}</b>
        ${rTarget.owner === G.player.factionId ? '（同势力，到即并入）' : '（敌方，持续进攻）'}
        <div class="rallymath">
          本城 ${U.num(d.total)} 兵 ÷ 兵额 ${U.num(d.cap)}　（保护下限 ${U.num(d.keep)}）<br>
          · 抽 ${Math.round(d.ratio * 100)}% → 可送 <b>${U.num(d.byRatio)}</b>
          ${d.bind === 'ratio' ? '<span class="bindtag">← 生效</span>' : ''}<br>
          · 扣掉保护下限 → 可送 <b>${U.num(d.byKeep)}</b>
          ${d.bind === 'keep' ? '<span class="bindtag">← 生效</span>' : ''}<br>
          · 目标剩余容量 → <b>${U.num(Math.round(Math.min(d.room, 99999)))}</b>
          ${d.bind === 'room' ? '<span class="bindtag">← 生效</span>' : ''}
        </div>
        ${d.bind === 'keep' && d.send > 0
          ? `<div class="dim gold-ink mt-3">本城兵只比保护下限多 ${U.num(d.total - d.keep)}，实际送出受此限制。想多送先募兵。</div>`
          : ''}
        <div class="rally-state ${st.code} mt-5 fs-body">● ${U.esc(st.text)}</div>
      </div>`;
    } else {
      html += `<div class="capnote">未设定。设定后每月自动把本城兵力送往目标城 —— 后方向前线输送、或持续骚扰敌城。<br>
        抽得越狠送得越快，但本城会被抽空；后方城建议<strong>同时设「备战」方针</strong>，太守每月募兵回血，才能形成不断的流水。</div>`;
    }

    html += `<div class="batchbar mt-6">
      <span class="dim fs-label">每月送走本城</span>
      <select class="mini" id="rallyRatio">
        ${[0.1, 0.2, 0.35, 0.5, 0.7, 0.9].map(v => `<option value="${v}" ${Math.abs((c.rallyRatio || 0.5) - v) < 0.01 ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}
      </select>
      <span class="dim fs-label">补至目标兵额</span>
      <select class="mini" id="rallyFill">
        ${[1, 1.2, 1.5, 2].map(v => `<option value="${v}" ${Math.abs((c.rallyFill || 1.2) - v) < 0.01 ? 'selected' : ''}>${Math.round(v * 100)}%</option>`).join('')}
      </select>
    </div>`;

    pane.innerHTML = html;

    // 比例即时生效（已设目标时）
    const bindRallySelects = () => {
      const rs = UI.$('rallyRatio'), rf = UI.$('rallyFill');
      if (!rs) return;
      const push = () => {
        if (!c.rallyTo) return;
        try {
          Store.dispatch('SET_RALLY', {
            cityId: c.id, toId: c.rallyTo,
            ratio: Number(rs.value),
            fill: rf ? Number(rf.value) : undefined,
          });
        } catch (e) { UI.toast(e.message); }
      };
      rs.onchange = push;
      if (rf) rf.onchange = push;
    };
    bindRallySelects();

    const box = document.createElement('div');
    box.className = 'actions';

    if (!isDemesne) {
      UI.fillNonDemesne(box, G, c);
      pane.appendChild(box);
      return;
    }

    for (const key of POLICY_KEYS) {
      const P = POLICIES[key];
      const on = c.policy === key;
      const b = UI._btn(`${P.name}${on ? ' ✓' : ''}`, null, () => {
        try { Store.dispatch('SET_POLICY', { cityId: c.id, policy: on ? null : key }); }
        catch (e) { UI.toast(e.message); }
      });
      b.title = P.desc;
      if (on) b.classList.add('sel');
      box.appendChild(b);
    }

    const sep = document.createElement('div');
    sep.className = 'brk';
    box.appendChild(sep);

    if (c.policy) {
      box.appendChild(UI._btn('罢委任', null, () => {
        try { Store.dispatch('SET_POLICY', { cityId: c.id, policy: null }); }
        catch (e) { UI.toast(e.message); }
      }));
    }

    const sep2 = document.createElement('div');
    sep2.className = 'brk';
    box.appendChild(sep2);

    const ratioSel = UI.$('rallyRatio');
    const fillSel = UI.$('rallyFill');

    box.appendChild(UI._btn(c.rallyTo ? '改调兵目标' : '设持续调兵 → 点地图', null, () => {
      UI.pending = {
        type: 'rally',
        fromId: c.id,
        ratio: ratioSel ? Number(ratioSel.value) : (c.rallyRatio || 0.5),
        fill: fillSel ? Number(fillSel.value) : (c.rallyFill || 1.2),
      };
      Renderer.targeting = true;
      UI.$('map').classList.add('targeting');
      UI.render(G);
    }));

    if (c.rallyTo) {
      box.appendChild(UI._btn('罢持续调兵', null, () => {
        try { Store.dispatch('SET_RALLY', { cityId: c.id, toId: null }); }
        catch (e) { UI.toast(e.message); }
      }));
    }

    pane.appendChild(box);
  },
};
