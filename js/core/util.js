const U = {
  clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
  lerp(a, b, t) { return a + (b - a) * t; },
  dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); },
  sum(obj) { let t = 0; for (const k in obj) t += obj[k] || 0; return t; },
  num(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(n);
  },
  pct(a, b) { return b ? Math.round((a / b) * 100) : 0; },
  clone(o) { return JSON.parse(JSON.stringify(o)); },
  esc(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  // 凸包无关：简单 ID
  uid(prefix) {
    U._n = (U._n || 0) + 1;
    return prefix + '_' + U._n.toString(36);
  },
  // 月份 → 季节
  season(month) {
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'autumn';
    return 'winter';
  },
  monthName(m) { return m + '月'; },
};

// 季节系数表：影响粮产、税入、征兵、建设、士气
const SEASON = {
  spring: { name: '春', food: 0.40, tax: 0.85, recruit: 1.20, build: 0.90, morale: 0.00 },
  summer: { name: '夏', food: 0.80, tax: 0.95, recruit: 1.00, build: 1.20, morale: 0.00 },
  autumn: { name: '秋', food: 1.55, tax: 1.30, recruit: 0.90, build: 1.00, morale: 0.02 },
  winter: { name: '冬', food: 0.20, tax: 0.75, recruit: 0.60, build: 0.60, morale: -0.03 },
};

// 地形定义：影响移动与战斗
const TERRAIN = {
  plain:    { name: '平原', move: 1.00, atkMod: 1.00, defMod: 1.00, cav: 1.30, inf: 1.00, arc: 0.95, color: '#3f4a35' },
  forest:   { name: '林地', move: 0.65, atkMod: 0.90, defMod: 1.15, cav: 0.65, inf: 1.05, arc: 1.20, color: '#2f3d2b' },
  hill:     { name: '丘陵', move: 0.75, atkMod: 0.88, defMod: 1.20, cav: 0.80, inf: 1.10, arc: 1.05, color: '#4a4234' },
  mountain: { name: '山地', move: 0.45, atkMod: 0.75, defMod: 1.40, cav: 0.50, inf: 1.00, arc: 0.90, color: '#4e4839' },
  marsh:    { name: '沼泽', move: 0.55, atkMod: 0.85, defMod: 1.10, cav: 0.55, inf: 0.90, arc: 0.95, color: '#333f3a' },
  desert:   { name: '荒漠', move: 0.60, atkMod: 0.90, defMod: 0.95, cav: 0.95, inf: 0.90, arc: 0.90, color: '#4a4030' },
  water:    { name: '水域', move: 0.00, atkMod: 1.00, defMod: 1.00, cav: 0.00, inf: 0.00, arc: 0.00, color: '#22333f' },
};
