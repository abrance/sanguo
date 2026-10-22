// 存档：localStorage，多槽位。键名 = sanguo.save.<剧本>.<槽>
// 槽列表直接从 localStorage 现有键推出来，不另存索引 —— 没有索引就没有索引与存档不同步的 bug。
// 无槽后缀的键（sanguo.save.<剧本>）是旧版单槽存档，仍可读，槽名视为空串。
const Save = {
  PREFIX: 'sanguo.save.',
  AUTO: 'auto',       // 自动存档槽：每次结束回合都覆盖它
  LEGACY: '',         // 旧版单槽存档
  VERSION: 2,         // 状态形状版本；改了字段语义（不只是加字段）就 +1

  key(scenarioId, slot) {
    return Save.PREFIX + scenarioId + (slot ? '.' + slot : '');
  },

  /** 存档文本：localStorage 与导出文件用同一份格式，读到的东西永远一样 */
  encode(G) {
    return JSON.stringify({ v: Save.VERSION, at: Date.now(), G });
  },

  /** 解析存档文本 → G；版本过新或损坏返回 null（导入和本地读档共用） */
  decode(raw) {
    try {
      const data = JSON.parse(raw);
      if (!data || !data.G) return null;
      if (data.v > Save.VERSION) {
        console.error(`存档版本 ${data.v} 高于当前 ${Save.VERSION}，不予读取`);
        return null;
      }
      return State.migrate(data.G, data.v || 1);
    } catch (e) {
      console.error('读档失败', e);
      return null;
    }
  },

  /** 存档槽清单（新→旧），只读存档头，不做迁移 */
  list(scenarioId) {
    const prefix = Save.PREFIX + scenarioId;
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(prefix) !== 0) continue;
      const rest = k.slice(prefix.length);
      if (rest && rest[0] !== '.') continue;      // 别的剧本前缀不算（前缀是 taodong190 与 taodong1900 的区分）
      const slot = rest ? rest.slice(1) : Save.LEGACY;
      const head = Save.head(scenarioId, slot);
      if (head) out.push(head);
    }
    return out.sort((a, b) => b.at - a.at);
  },

  /** 单槽摘要：列表显示用，省得为了看一眼年月把整棵树迁移一遍 */
  head(scenarioId, slot) {
    try {
      const raw = localStorage.getItem(Save.key(scenarioId, slot));
      if (!raw) return null;
      const d = JSON.parse(raw);
      const G = d && d.G;
      if (!G || !G.meta || !G.player) return null;
      const f = G.factions && G.factions[G.player.factionId];
      return {
        scenarioId, slot, at: d.at || 0, v: d.v || 1,
        year: G.meta.year, month: G.meta.month, turn: G.meta.turn,
        player: G.player.name || '',
        faction: f ? f.name : '',
        home: (G.cities && G.cities[G.player.homeCityId] || {}).name || '',
        cities: (G.player.demesne || []).length,
      };
    } catch (e) { return null; }
  },

  /** 存一个槽：给了 slot 就覆盖，没给就新建。返回槽名，失败返回 null */
  save(G, slot) {
    const s = slot || 's' + Date.now();
    try {
      localStorage.setItem(Save.key(G.meta.scenarioId, s), Save.encode(G));
      return s;
    } catch (e) {
      console.error('存档失败', e);
      return null;
    }
  },

  load(scenarioId, slot) {
    try {
      const raw = localStorage.getItem(Save.key(scenarioId, slot || Save.AUTO));
      return raw ? Save.decode(raw) : null;
    } catch (e) {
      console.error('读档失败', e);
      return null;
    }
  },

  /** 最近一次玩到的局面：开局自动续档用它 */
  latest(scenarioId) {
    const all = Save.list(scenarioId);
    return all.length ? Save.load(scenarioId, all[0].slot) : null;
  },

  remove(scenarioId, slot) {
    try { localStorage.removeItem(Save.key(scenarioId, slot)); } catch (e) { }
  },
};
