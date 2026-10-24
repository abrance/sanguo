// 极简事件总线：系统层只 emit，视图层只 on
const Bus = (() => {
  const handlers = new Map();

  function on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, []);
    handlers.get(evt).push(fn);
    return () => off(evt, fn);
  }

  function off(evt, fn) {
    const arr = handlers.get(evt);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  /** 一个订阅者抛错不影响其余订阅者，也不让 dispatch 半途卡住 */
  function emit(evt, payload) {
    const arr = handlers.get(evt);
    if (!arr) return;
    for (const fn of arr.slice()) {
      try { fn(payload); }
      catch (e) {
        const msg = `bus 订阅者出错: ${evt} → ${e.message}`;
        if (typeof window !== "undefined" && window.SanguoLog) window.SanguoLog.push('bus', msg, e);
        else console.error(`[bus] ${msg}`, e);
      }
    }
  }

  return { on, off, emit };
})();
