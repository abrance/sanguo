// 存档：localStorage，每个剧本一个独立槽位
const Save = {
  PREFIX: 'sanguo.save.',
  VERSION: 1,

  key(scenarioId) { return Save.PREFIX + scenarioId; },

  exists(scenarioId) {
    try { return !!localStorage.getItem(Save.key(scenarioId)); } catch (e) { return false; }
  },

  save(G) {
    try {
      localStorage.setItem(Save.key(G.meta.scenarioId), JSON.stringify({
        v: Save.VERSION, at: Date.now(), G,
      }));
      return true;
    } catch (e) {
      console.error('存档失败', e);
      return false;
    }
  },

  load(scenarioId) {
    try {
      const raw = localStorage.getItem(Save.key(scenarioId));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.G) return null;
      return data.G;
    } catch (e) {
      console.error('读档失败', e);
      return null;
    }
  },

  remove(scenarioId) {
    try { localStorage.removeItem(Save.key(scenarioId)); } catch (e) { }
  },
};
