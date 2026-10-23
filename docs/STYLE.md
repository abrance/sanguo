# 视觉规范（分层 / token / 图标 / 排版）

> 事实来源：`style.css` 顶部 `:root` 与 `index.html` 的 `#icon-sprite`。
> 四层分工与红线见下面 §0；违反红线时 `node tools/verify.js` 的「分层守护」直接报错。

---

## 0. 四层分工（写样式前先看这里）

| 层 | 住在哪 | 只准写 |
|---|---|---|
| token | `style.css` 的 `:root` | 颜色 / 字号 / 圆角 |
| 组件 | `style.css` 各 `/* ---------- 域 ---------- */` 段 | 这类组件长什么样 |
| 工具 | `style.css` 末尾「工具层」 | 纯间距 / 字号（`.fs-label .mt-6 .p-4 …`） |
| 数据变量 | JS 写 `style="--w:…"`，CSS 译成属性 | 数值、数据层配色 |

四条红线，`verify.js` 都会拦：

1. `style.css` 的规则区不允许裸色值 —— 全部走 token。
2. `js/view/**` 与 `index.html` 的内联 `style` 只允许 `--自定义属性`；
   `width:` / `font-size:` / `color:` 这类属性名一律进 CSS。
3. JS 里不写颜色字面量（`#xxx` / `rgba(...)`）。颜色只能来自：
   token、数据层自带配色（`f.color` / `TERRAIN[].color` / `BRANCH_COLOR`）。
4. 一处语义一个类。同一串 `margin-top:6px;line-height:1.6` 出现第二次就该变成类。

写数据的套路：

```html
<div class="qbar"><div style="--w:42%"></div></div>      <!-- 进度：CSS 侧 width:var(--w) -->
<span class="c" style="--c:${f.color}">曹操</span>          <!-- 势力色：CSS 侧 color:var(--c) -->
<i class="csw fill" style="--fill:${f.color}"></i>          <!-- 色点：background:var(--fill) -->
```

例外：`renderer.js` / `map.js` / 顶栏 sparkline 是 canvas，拿不到 CSS 继承，用色自带在脚本里。

改完必须跑两条：`node tools/verify.js`（分层与逻辑）、`node tools/shots.js`（像素差）。

---

## 1. 为什么有这套 token

2025 年整理前，`style.css` 里散着 **184 处裸色值（77 个不同颜色）**、9 种字号、4 种圆角，
另有一批颜色活在 JS 模板字符串的内联样式里（改配色得全局搜 `#`）。
现在全部收进 `:root`；写新样式时找不到合适 token，说明要么该复用现有语义，要么这是一类新语义（那就加 token 并写注释）。

**当前状态**：规则区裸色值 = 0（只有 `#icon-sprite` 里没有颜色，图标统一走 `currentColor`）。

---

## 2. 颜色 token

### 底与面（层级由低到高）

| token | 值 | 用在哪 |
|---|---|---|
| `--bg` | `#12100e` | 页面底 |
| `--bg-top` | `#191612` | 侧栏渐变顶部 |
| `--bg-deep` | `#0d0c0a` | 地图底 |
| `--bg-veil` | `#0b0a08` | 开局遮罩径向底 |
| `--bg-scroll` | `#171411` | 滚动条轨道 |
| `--bg2` | `#1c1916` | 卡片 |
| `--bg3` | `#252017` | 顶栏（资源条） |
| `--surface-2` | `#221d16` | 行 / 输入 / 未选中页签 |
| `--surface-3` | `#2a241d` | 进度轨道 / 分隔 |
| `--surface-4` | `#1e1a14` | 嵌套块（阶梯行 / 路线卡 / 战报卡） |
| `--surface-5` | `#2f2718` | 选中行底 |
| `--surface-6` | `#332a1c` | 激活页签底 |
| `--sunken` | `#1c1812` | 公式 / 说明块 |
| `--tag-bg` | `#332c22` | 标签底 |
| `--row-hover` | `#2b241b` | 列表行悬停 |

### 线

`--line` `--line-soft` `--line-2` `--line-warm` `--line-warm-2` `--btn-line` `--btn-line-hover` `--gold-line`
—— 分别对应：主分隔、行分隔、稍亮行分隔、浮层悬停边、路线卡悬停边、按钮描边、按钮悬停描边、金色描边。

### 文字

| token | 值 | 语义 |
|---|---|---|
| `--ink` | `#e8dcc8` | 正文 |
| `--ink-dim` | `#9a8c76` | 次要 |
| `--ink-faint` | `#8a7f6c` | 说明文字 |
| `--ink-mute` | `#8a7a5c` | 极弱（静默图标） |
| `--ink-soft` | `#c9b48a` | 偏金的次级（排队项） |
| `--ink-warm` | `#b8a888` | 注释强调 |
| `--ink-locked` | `#5f574a` | 未解锁 |

### 强调与语义

- 金：`--gold` `--gold-bright` `--gold-deep` `--gold-dark` `--gold-pale`
- 主行动（朱红）：`--primary-1/2`、`--primary-1/2-hover`、`--primary-line`、`--primary-ink`
- 交战 / 损失：`--war` `--war-deep` `--war-soft` `--war-text` `--battle-line` `--battle-line-hover` `--battle-line-fail` `--battle-text`
- 同盟 / 收益：`--ally` `--ally-deep` `--ally-soft` `--ally-ink` `--ally-past`
- 守方（战报条）：`--def-deep` `--def`
- 其他：`--blue` `--blue-soft` `--blue-pale` `--red` `--green` `--warn-bg` `--warn-ink` `--warn-line` `--bad-line` `--ink-ghost`
- 图例（与画布同源）：`--legend-faction` `--legend-own` `--legend-free` `--arc-war` `--arc-truce` `--arc-ally`
- 资源：`--food` `--food-deep` `--goldres` `--troop` `--mat` `--iron` `--rp` `--inf` `--inf-deep`
- 阴影/黑：`--scrim-1` `--scrim-2` `--hair` `--glint` `--black`

### 已知的近似色（**故意保留，未合并**）

这些值差 1–2 个色阶，看起来像冗余，但合并会改变画面，需要人拍板后再动（改了就跑 `shots.js` 看差异）：

- `--bg2 #1c1916` / `--surface-4 #1e1a14` / `--sunken #1c1812`
- `--surface-2 #221d16` / `--bg3 #252017` / `--surface-3 #2a241d`
- `--line-warm #4a3f30` / `--btn-line #463c2d` / `--line #3a3229`
- `--ink-dim #9a8c76` / `--ink-faint #8a7f6c` / `--ink-mute #8a7a5c`

---

## 3. 圆角与字号

| 类别 | token |
|---|---|
| 圆角 | `--r-xs:1px` `--r-sm:2px`（默认）`--r-md:3px`（面板）`--r-lg:4px`（开局面板） |
| 字号 | `--fs-tiny:9` `--fs-label:10` `--fs-body:11`（正文默认）`--fs-body-2:12` `--fs-title:13` `--fs-lead:14` `--fs-name:15` `--fs-date:17` `--fs-display:34` |

规则区已无 `font-size:<px>` 与 `border-radius:<px>` 裸值。

**间距**：没做成 token，而是工具层固定几档（`.mt-3 .mt-4 .mt-5 .mt-6 .mt-8` / `.mb-4 .mb-5 .mb-6` /
`.my-6 .my-6-3 .my-8-3` / `.ml-auto` / `.p-4 .py-4 .p-6-2`）。
只用这几种，别现编 `margin-top:7px`；确实需要新档就加到工具层里（这样它能被 grep 到）。
上 4px 栅格会真实改变布局，属于下一轮，届时必须逐个机位看截图。

---

## 4. 图标

图标源：`index.html` 顶部内联 `<svg id="icon-sprite">`，12 个 `<symbol>`：

| id | 用途 | id | 用途 |
|---|---|---|---|
| `ico-food` | 粮草 | `ico-wall` | 城墙 |
| `ico-gold` | 钱币 | `ico-order` | 治安 |
| `ico-troop` | 兵力 | `ico-clan` | 士族 |
| `ico-mat` | 建材 | `ico-diplo` | 外交 |
| `ico-iron` | 铁料 | `ico-mission` | 上命 |
| `ico-rp` | 科研点 | `ico-tech` | 科技 |

用法：

```html
<svg class="ico food" aria-hidden="true"><use href="#ico-food"/></svg>
```

- 尺寸 12×12，`fill:none; stroke:currentColor; stroke-width:1.4`
- 颜色由 class 决定（`.ico.food{color:var(--food)}` …），不写内联颜色
- `aria-hidden="true"`：图标只是装饰，语义靠旁边的数字与单位
- 需要新图标：先加 `<symbol>`（16×16 视口、只用 stroke），再在 `.ico` 里挂颜色

---

## 5. 改样式的流程

1. 先判断这值属于哪层：颜色/字号 → token；重复的间距 → 工具类；数据（宽度/势力色）→ 数据变量；都不是 → 组件类
2. 找不到 token 就判断“复用 / 新增”（新 token 必须配注释说明语义）
3. 跑 `node tools/verify.js`，确认「分层守护」仍全绿
4. 跑 `node tools/shots.js`
   - **0 px**：纯等价改动，直接提交
   - 有差异：打印的是像素数，人眼看 `tools/shots/*.png` 与运行页面
5. 确认是有意的改动 → `node tools/shots.js --update` 重写基线
6. 提交时一起带上 `tools/shots/*.png`，否则下一个人会看到“凭空多了差异”

## 结局弹窗（`js/view/panels/end.js`）

天下一统 / 势力覆亡只在**结局首次出现**时铺满一屏（`UI._endKey` 记忆，读档读到已终局面也会铺）：

- 卷轴式外框：内嵌一圈 `--line-soft` 细边（`.end-box::before`），胜利描金边、覆亡降饱和
- 标题朱印：`.end-seal` 落章动效（放大砸下 + 回弹），角度固定 −8°
- 六格战绩（城 / 覆灭势力 / 征战月数 / 战功 / 官阶 / 仕途）逐格上浮，错峰靠内联 `--i` + CSS `calc()`（继续遵守"内联只给自定义属性"）
- 镜头：胜利时 `Renderer.flyTo(全图中心, 1200ms, ZOOM_MIN)`，天下尽收眼底
- 三个出口：览图（关掉弹窗看地图）/ 看纪事（切纪事侧栏）/ 重开一局（回起始界面）
- 结局后「结束回合」按钮变成「天下一统 / 势力覆亡」，点它重看这一幕
