// 视图层 · 起始界面 / 天赋选择
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_START = {

  // ───────── 起始界面 ─────────
  buildStart() {
    const list = UI.$('factionPick');
    list.innerHTML = '';

    const sc = getScenario(DEFAULT_SCENARIO);   // 视图不硬编码剧本数据
    const rows = sc.factionRows.filter(r => r[5].length > 0);
    rows.sort((a, b) => b[5].length - a[5].length);

    for (const [id, name, color, rulerId, , cityIds] of rows) {
      const ruler = sc.heroRows.find(h => h[0] === rulerId);
      const el = document.createElement('div');
      el.className = 'pick';
      el.dataset.fid = id;
      el.innerHTML = `<i class="csw fill" style="--fill:${color}"></i>
        <span>${U.esc(name)}</span>
        <span class="pk-meta">${cityIds.length}城</span>`;
      el.title = ruler ? `君主：${ruler[1]}` : '';
      el.onclick = () => UI.pickFaction(id);
      list.appendChild(el);
    }

    UI.pickFaction('caocao');
    UI.buildTalents();
    UI.$('btnStart').onclick = UI.doStart;
  },

  /** 开局天赋：一排卡片，默认选第一项 */
  buildTalents() {
    const box = UI.$('talentPick');
    box.innerHTML = '';
    for (const key of TALENT_KEYS) {
      const t = TALENTS[key];
      const el = document.createElement('div');
      el.className = 'pick';
      el.dataset.talent = key;
      el.innerHTML = `<i class="tal-icon">${t.icon}</i>
        <span>${t.name}</span>
        <span class="pk-meta">${U.esc(t.desc)}</span>`;
      el.onclick = () => UI.pickTalent(key);
      box.appendChild(el);
    }
    UI.pickTalent(UI._startTalent);
  },

  pickTalent(key) {
    UI._startTalent = key;
    for (const el of UI.$('talentPick').children) {
      el.classList.toggle('on', el.dataset.talent === key);
    }
  },

  pickFaction(fid) {
    UI._startFaction = fid;
    UI._startCity = null;

    const cur = getScenario(DEFAULT_SCENARIO).factionRows.find(r => r[0] === fid);
    for (const el of UI.$('factionPick').children) {
      el.classList.toggle('on', el.dataset.fid === fid);
    }

    const cityList = UI.$('cityPick');
    cityList.innerHTML = '';
    const cities = cur[5].map(id => getScenario(DEFAULT_SCENARIO).cityRows.find(r => r[0] === id)).filter(Boolean);
    cities.sort((a, b) => b[6] - a[6]);

    for (const row of cities) {
      const [id, name, , , terrain, region, pop] = row;
      const el = document.createElement('div');
      el.className = 'pick';
      el.dataset.cid = id;
      el.innerHTML = `<span>${U.esc(name)}</span>
        <span class="pk-meta">${region}·${TERRAIN[terrain].name}·${pop}</span>`;
      el.onclick = () => UI.pickCity(id);
      cityList.appendChild(el);
    }

    if (cities.length) UI.pickCity(cities[0][0]);
    UI.refreshStartBtn();
  },

  pickCity(cid) {
    UI._startCity = cid;
    for (const el of UI.$('cityPick').children) {
      el.classList.toggle('on', el.dataset.cid === cid);
    }
    UI.refreshStartBtn();
  },

  refreshStartBtn() {
    UI.$('btnStart').disabled = !(UI._startFaction && UI._startCity);
  },

  doStart() {
    const name = (UI.$('playerName').value || '无名').trim().slice(0, 8) || '无名';
    const G = State.create({
      scenarioId: DEFAULT_SCENARIO,
      factionId: UI._startFaction,
      cityId: UI._startCity,
      playerName: name,
      talent: UI._startTalent,
      seed: Date.now(),
    });
    UI.$('startOverlay').classList.add('hidden');
    Store.init(G);
    Renderer.attach(G);
    UI.selectedId = G.player.homeCityId;
    Renderer.selectedId = UI.selectedId;
    Renderer.cam.zoom = 0.72;
    UI.sideTab = 'city';
    UI.cityTab = 'overview';
    UI._hist = [];
    UI._histTurn = null;
    UI.syncTabs();
    UI.render(G);
    Save.save(G, Save.AUTO);     // 新局只覆盖自动档，别人存的命名档不动
  },
};
