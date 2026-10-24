# 卡顿排查手册（界面性能）

> 触发场景：玩家报「玩一会儿就卡」「点着没反应」「风扇狂转」。结论先行：**先量，别猜**。
> 本文记的是实际踩过并验证有效的路子，不是通用性能大道理。

---

## 0. 三个反直觉的事实（先记住这三条，能少走一天弯路）

1. **`Renderer.draw` 的 JS 耗时 ≠ 帧成本。** canvas 2D 的绘制命令是排队的，`performance.now()` 包住 `draw()` 只能量到"发命令"的时间（本机实测 0.7–1.9ms），真正的光栅化/合成在后面。
   所以「JS 很快」不能证明「不卡」；要量 CPU 与 `fps`。
2. **没开硬件加速时，页面 CPU ∝ 画布像素数 × 屏幕刷新率。** 2.7M 像素的 canvas 在 120Hz 屏上、软件光栅化下，光"合成"就能吃掉半核到一核，跟游戏逻辑一点关系没有。
3. **一条 `animation: ... infinite` 就能顶上一整帧的重绘。** 见 §5 的 `mlBlink` 案例：一个 1.1s 无限背景色动画，把 renderer 从 2% 拉到 12–17%（120Hz + 大窗口下 60–100%）。

---

## 1. 三层测量：从粗到细

| 层 | 工具 | 看什么 | 能得出什么 |
| --- | --- | --- | --- |
| 进程 | Edge `Shift+Esc` 任务管理器 | 「标签页」行的 CPU（不是 GPU 进程行） | 是不是这个页在烧；**必须记的是这一列**，页内角标没有 CPU |
| 页面 | `?perf=1` 角标（本项目内置） | fps / 重画次数与原因 / 绘制耗时 / 堆 / DOM / 网络 | JS 有没有在烧、地图有没有重画、DOM 有没有漏 |
| 细节 | `document.getAnimations()` | 正在跑的 CSS 动画 | 有没有无限动画在逼浏览器每帧重绘 |

### `?perf=1` 角标怎么读

```
fps 120  重画 0.0/s  画布 2096x1294 @1
重画原因 无
绘制 1.9ms/次  最大 1.9ms  合计 2ms/s
堆 61MB  DOM 1295  网络 1ms
```

| 读数 | 含义 | 下一步 |
| --- | --- | --- |
| `重画 50~60/s`，原因固定为 `cam`/`inertia`/`hover` | 脏标记失效，等于没优化 | 查那条条件为何每帧为真（`Renderer._inertia` 是否 NaN、`stale` 是否被反复置位） |
| `重画 0/s` + `绘制 0ms/s` 但 CPU 高 | **不关 JS 的事** | 直接 `document.getAnimations()`，再看 `edge://gpu` |
| `fps` 掉到 20 以下而重画很少 | 主线程被别的东西占着 | DevTools Performance 录 5s，看主线程长任务 |
| `DOM` 一直涨 | 视图层泄漏 | 对比两次 `UI.render` 前后的节点数 |
| `网络` 上千 ms | 服务/网络问题（不是渲染） | 查服务、路由 |

---

## 2. 一次跑完的排查清单

```js
// ① 版本确认：新代码在跑吗
typeof Renderer.moving            // "function" = 有脏标记那版

// ② 为什么在重画（2 秒采样）
window._log=[]; const _d=Renderer.draw;
Renderer.draw=function(g,dt){const c=Renderer.cam;
  window._log.push([Math.round(c.x),Math.round(c.y),c.zoom,Renderer.hoverId,Renderer.selectedId,Renderer.moving()]);
  return _d.apply(Renderer,arguments)};
setTimeout(()=>{console.log('2s 重画', window._log.length, '帧; 末 3 条', window._log.slice(-3)); Renderer.draw=_d}, 2000);

// ③ 有没有无限动画（最关键的一条）
document.getAnimations().map(a => [a.animationName, a.playState, a.effect?.target?.id || a.effect?.target?.className]);

// ④ 像素量是不是元凶：把渲染像素乘 0.7 再对比 CPU
//    打开 http://<host>:10300/index.html?perf=1&scale=0.7

// ⑤ 关掉所有 CSS 动画/过渡（视觉回归模式的开关），对比 CPU
document.body.classList.add('shot');      // 恢复：remove('shot')

// ⑥ 关掉小地图（150ms 一刷的第二块 canvas）
Renderer.drawMinimap = () => {};

// ⑦ 卡死时看错误环缓冲（不需要开 DevTools 也能看红条）
SanguoLog.dump();                          // 或 copy(SanguoLog.ring.join("\n")) 拷走
```

判定顺序建议：③（动画）→ ④（像素）→ ⑤⑥（排除法）→ ②（脏标记）→ ①（版本/缓存）。

---

## 3. 本项目内置的三件诊断设施

| 入口 | 作用 |
| --- | --- |
| `?perf=1` | 左下角性能角标（fps / 重画次数与原因 / 绘制耗时 / 堆 / DOM / 网络往返） |
| `?scale=0.7` | 渲染像素乘系数，CSS 尺寸不变；用来分离"像素量"和"别的开销" |
| `SanguoLog` | 统一错误日志环（最近 100 条带堆栈）+ 页内红条横幅；`[sanguo]` 前缀可在控制台搜 |

错误日志覆盖面（这些以前会被静默吞掉）：

- `[sanguo] [window]` 未捕获异常、`[promise]` 未处理 Promise
- `[sanguo] [render]` 界面渲染抛错（`Bus.emit` 会吞订阅者异常，所以订阅处自己接）
- `[sanguo] [bus]` 事件订阅者抛错
- `[sanguo] [frame]` 主循环绘制抛错（只跳过该帧，不打死 rAF）
- `[sanguo] [cmd]` 命令被拒（钱不够/条件不满足/未知命令，属正常业务，warn 级）

启动自检：`index.html` 尾部 3 秒后检查 `window.__bootOk`，没起来就出红条
「界面没启动：脚本没加载完整（服务在重启 / 刷新太快 / 缓存）」——
这是 `make server` 重启期间刷新页面时最常见的一种"点着没反应"，控制台只有网络错误、没有 JS 报错。

---

## 4. 已经做过的优化（改动要点，别改回去）

1. **静止不重绘**（`js/main.js` 主循环）：比对「局面对象 / 镜头 x,y,zoom / 悬停 / 选中 / 瞄准态 / `Renderer.stale` / 飞行·惯性·交战特效」，全没变就跳过整帧。实测 idle 从 49% 降到 1–2%。
   - 新增会改变画面的状态时，**必须进这个比对**，否则画面不刷新（看着像卡死）。
   - `resize()` / `attach()` 要置 `Renderer.stale = true`，否则改尺寸后留白。
2. **画布像素上限**（`js/view/renderer.js` `MAX_CANVAS_PX = 1.3e6`）：`devicePixelRatio` 封顶 1.5，超出像素预算再按 `sqrt(预算/实际)` 缩 dpr。小窗口不缩，大窗口自动降。
3. **跟不上就限流**（同一处）：用 rAF 间隔的滑动平均判断"光栅化跟不上"（>24ms 限到 30fps，>40ms 限到 18fps）。每帧都重画只会把光栅队列堆到 CPU 100%，宁可掉帧也不让页面卡死。`?perf=1` 角标里出现 `限流 33ms` 就是它在工作。
4. **主循环 try/catch**：一帧画崩只跳过该帧并记一次日志，不能让 `requestAnimationFrame` 断链（断了就是"地图永久冻结"）。
5. **禁用无限动画**：`mlBlink` 由 `infinite` 改为 `3` 次；`.`overlay` 加 `overflow:auto` + `>*{margin:auto}`；`#btnStart` 用 `position:sticky` 钉在底部（小窗口下按钮曾在屏幕外 17px，表现就是"点开局没反应"）。

---

## 5. 踩过的坑（照这个顺序怀疑）

- **无限 CSS 动画**：`animation: ... infinite` + 改背景色 = 每帧重绘。用 `document.getAnimations()` 一次抓出来。改法优先级：删掉 > 限定次数 > 换成 transform/opacity（合成层）> 降频。
- **把 `-webkit-` 之类的硬件加速当必然**：先看 `edge://gpu` 的 `Graphics Feature Status`（Canvas / Rasterization / Compositing）。`Software only` 时上面所有优化只能省一半，省不到零 —— 那是浏览器/驱动层要修的。
- **反了：有独显的机器更卡**。混合显卡（PRIME / Optimus）下浏览器可能来回切 GPU，或 GPU 进程反复重启回退。判定：`--disable-gpu` 起一个实例对比，顺了就是 GPU 路径的问题（改浏览器设置 / 强制走独显 / 更新驱动），跟代码无关。
- **鼠标一直在地图上动**：`mousemove` 会重建悬浮提示（`showCityTip` 每事件一次 `innerHTML` + 强制布局）。测 CPU 时手别放在地图上，否则读数虚高。
- **刷新早于服务就绪**：`make server` 是前台进程，等服务打印 `→ http://localhost:...` 再刷新。抢跑会拿到残缺脚本，页内自检红条会点出来。
- **只看页内角标不看进程 CPU**：角标是页面指标，CPU 只在任务管理器里。两者要一起看。
- **没有 `400ms` 就下结论**：CPU 采样窗口 ≥2s，比较不同状态时其他窗口都关掉，否则抖动比效果还大（曾出现"关动画后 CPU 反而更高"的假象）。

---

## 6. 回归守护

```bash
node tools/verify.js                 # 逻辑层 295 条断言，含"脚本被 index.html 引用"等静态检查
node tools/shots.js                  # 视觉回归：三机位像素差（基线在本机，不随仓库走）
node tools/shots.js --update         # 确认改动是有意的之后重写基线
```

视觉回归用 `?shot=1`：`<body>` 加 `.shot`，CSS 把所有动画/过渡停掉（`dt=0` 冻结动画），保证同机两次截图逐像素一致。
