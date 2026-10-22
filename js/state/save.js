// 存档：localStorage，每个剧本一个独立槽位
const Save = {
  PREFIX: 'sanguo.save.',
  VERSION: 2,   // 状态形状版本；改了字段语义（不只是加字段）就 +1

  key(scenarioId) { return Save.PREFIX + scenarioId; },

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

  save(G) {
    try {
      localStorage.setItem(Save.key(G.meta.scenarioId), Save.encode(G));
      return true;
    } catch (e) {
      console.error('存档失败', e);
      return false;
    }
  },

  load(scenarioId) {
    try {
      const raw = localStorage.getItem(Save.key(scenarioId));
      return raw ? Save.decode(raw) : null;
    } catch (e) {
      console.error('读档失败', e);
      return null;
    }
  },

  remove(scenarioId) {
    try { localStorage.removeItem(Save.key(scenarioId)); } catch (e) { }
  },
};
