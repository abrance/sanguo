// 确定性随机（mulberry32），同种子同结果，便于复现与调试
const RNG = (() => {
  let s = 1;

  function seed(v) { s = (v >>> 0) || 1; }
  // 序列游标也可存取：存档要能从中断处续上，不能只存初始种子
  function getState() { return s; }
  function setState(v) { s = (v >>> 0) || 1; }

  function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const int = n => Math.floor(next() * n);
  const range = (a, b) => a + next() * (b - a);
  const pick = arr => arr[int(arr.length)];
  const chance = p => next() < p;
  // 整数区间 [a,b]
  const between = (a, b) => a + int(b - a + 1);
  const jitter = (v, pct) => v * (1 + (next() * 2 - 1) * pct);

  return { seed, getState, setState, next, int, range, pick, chance, between, jitter };
})();
