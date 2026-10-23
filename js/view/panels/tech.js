// 视图层 · 科技面板
// 定义后由 ui.js 末尾装配进 UI 命名空间，调用点仍是 UI.xxx
const UI_TECH = {

  // ───────── 科技 ─────────
  renderTech(G) {
    const f = G.factions[G.player.factionId];
    const cur = f.tech.current;
    const queue = f.tech.queue || [];
    const rate = TechSys.rate(G, G.player.factionId);
    const body = UI.$('techBody');
    const scroll = body.scrollTop;

    UI.$('techCurrent').textContent = cur
      ? `${TECHS[cur.key].name} ${Math.round((1 - cur.left / cur.total) * 100)}%`
      : `空闲 · ${Math.floor(f.tech.rp)} 点`;

    let html = `<div class="techrate">
      产出 <b>${rate.toFixed(1)}</b> 点/月 · 库存 <b>${Math.floor(f.tech.rp)}</b>
      · 已研 <b>${TechSys.doneList(f).length}/${TECH_KEYS.length}</b>
    </div>`;

    if (cur) {
      const pct = Math.round((1 - cur.left / cur.total) * 100);
      const eta = TechSys.eta(G, G.player.factionId, cur);
      const color = BRANCH_COLOR[TECHS[cur.key].branch];
      html += `<div class="techcur bl-c" style="--c:${color}">
        <div class="tcrow">
          <span class="c" style="--c:${color}">研习中 · ${TECHS[cur.key].name}</span>
          <span class="dim">${Math.ceil(cur.left)}/${cur.total} 点 · 约 ${eta} 月</span>
        </div>
        <div class="qbar"><div style="--w:${pct}%"></div></div>
      </div>`;
    } else {
      html += `<div class="dim my-6">当前无研习项目，点下方「研」开工或排队。</div>`;
    }

    if (queue.length) {
      html += `<div class="techqueue">队列 `
        + queue.map(e => `<span class="qpill">${TECHS[e.key].name}<button data-unsched="${e.key}" title="移出队列">×</button></span>`).join('')
        + `</div>`;
    }

    for (const br of TECH_BRANCHES) {
      const list = TECH_KEYS.filter(k => TECHS[k].branch === br)
        .sort((a, b) => TECHS[a].tier - TECHS[b].tier);
      if (!list.length) continue;

      const doneN = list.filter(k => f.tech.done[k]).length;
      html += `<div class="tbranch">
        <div class="tbranch-head">
          <span class="c" style="--c:${BRANCH_COLOR[br]}">${br}</span>
          <span class="dim fs-tiny">${doneN}/${list.length}</span>
        </div>`;

      for (const key of list) {
        const t = TECHS[key];
        const done = !!f.tech.done[key];
        const isCur = cur && cur.key === key;
        const inQ = queue.some(e => e.key === key);
        const avail = TechSys.available(f, key);
        const cls = done ? 'done' : isCur ? 'cur' : inQ ? 'queued' : avail ? '' : 'locked';

        let stateTxt;
        if (done) stateTxt = '已成';
        else if (isCur) stateTxt = '研习中';
        else if (inQ) stateTxt = '排队中';
        else if (avail) {
          const eta = Math.max(1, Math.ceil(t.cost / Math.max(0.1, rate)));
          stateTxt = `${t.cost} 点 · 约 ${eta} 月`;
        } else stateTxt = `${t.cost} 点`;

        html += `<div class="titem ${cls}" title="${U.esc(t.desc)}">
          <span class="tname">${done ? '✓ ' : ''}${t.name}</span>
          <span class="tcost">${stateTxt}</span>
          ${(!done && !isCur && !inQ && avail)
            ? `<button class="mini" data-tech="${key}">研</button>` : ''}
        </div>`;
      }
      html += `</div>`;
    }

    html += `<div class="capnote mt-8">
      科研点由<b>学宫</b>产出：每级 6 点/月，另加守将政治加成。无学宫之城仅 0.8 点/月。<br>
      可连续点「研」排入队列，最多 ${TechSys.MAX_QUEUE} 项。
    </div>`;

    body.innerHTML = html;
    body.scrollTop = scroll;

    for (const b of body.querySelectorAll('button[data-tech]')) {
      b.onclick = () => {
        try { Store.dispatch('RESEARCH', { key: b.dataset.tech }); }
        catch (e) { UI.toast(e.message); }
      };
    }
    for (const b of body.querySelectorAll('button[data-unsched]')) {
      b.onclick = () => {
        try { Store.dispatch('UNSCHEDULE_TECH', { key: b.dataset.unsched }); }
        catch (e) { UI.toast(e.message); }
      };
    }
  },
};
