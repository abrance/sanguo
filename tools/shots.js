#!/usr/bin/env node
// 视觉回归：无头浏览器按固定机位截图，与基线做像素差比对。
//
//   node tools/shots.js            对比基线（差异超阈值 → 退出码 1）
//   node tools/shots.js --update   重写基线（改完美术、确认无回归后跑一次）
//
// 基线目录 tools/shots/ 不进版本库（截图受机器字体/显卡影响），首次跑先 --update 生成本地基线。
//   node tools/shots.js -v         打印每个机位的差异像素数
//
// 依赖：一个 Chrome/Chromium 可执行文件（自动找 playwright/puppeteer 缓存或 PATH），
//       以及 ImageMagick 的 compare（缺失时只截图、不比对，并以 0 退出）。
// 游戏本身仍然零依赖：这个脚本只在开发机上跑。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(__dirname, 'shots');
const V = process.argv.includes('-v');
const UPDATE = process.argv.includes('--update');
const TOLERANCE = 200;          // 允许的差异像素数（抗锯齿抖动）

const W = 900;
const H = 600;

// 机位：覆盖 远景地形 / 近景城池 / 纪事战报
const SHOTS = [
  { name: 'map-far', query: 'zoom=0.5&cx=1200&cy=900&seed=11' },
  { name: 'map-near', query: 'zoom=1.2&cx=1180&cy=760&seed=11&turn=6' },
  { name: 'log-battle', query: 'zoom=1.0&cx=1180&cy=760&seed=11&turn=4&fight=1&turn2=2&tab=log' },
];

function findChrome() {
  const cands = [];
  if (process.env.CHROME) cands.push(process.env.CHROME);

  const pw = path.join(process.env.HOME || '', '.cache/ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw)) {
      if (!d.startsWith('chromium_headless_shell-')) continue;
      cands.push(path.join(pw, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
      cands.push(path.join(pw, d, 'chrome-linux64', 'chrome'));
    }
    for (const d of fs.readdirSync(pw)) {
      if (!d.startsWith('chromium-')) continue;
      cands.push(path.join(pw, d, 'chrome-linux64', 'chrome'));
    }
  }

  const pp = path.join(process.env.HOME || '', '.cache/puppeteer');
  if (fs.existsSync(pp)) {
    const stack = [pp];
    while (stack.length) {
      const dir = stack.pop();
      let names = [];
      try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const n of names) {
        const p = path.join(dir, n.name);
        if (n.isDirectory()) stack.push(p);
        else if (n.name === 'chrome-headless-shell' || n.name === 'chrome') cands.push(p);
      }
    }
  }

  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome-stable']) {
    cands.push(p);
  }

  for (const c of cands) {
    try { if (fs.existsSync(c) && fs.statSync(c).size > 0) return c; } catch (e) { /* keep looking */ }
  }
  return null;
}

function shoot(chrome, shot, outPath) {
  const url = pathToFileURL(path.join(ROOT, 'index.html')).href + '?shot=1&' + shot.query;
  const r = spawnSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    `--window-size=${W},${H}`,
    '--virtual-time-budget=4000',
    `--screenshot=${outPath}`,
    url,
  ], { timeout: 90000, stdio: ['ignore', 'ignore', 'pipe'] });

  if (!fs.existsSync(outPath)) {
    const err = r.stderr ? String(r.stderr).trim().split('\n').slice(-3).join(' | ') : '';
    throw new Error(`截图失败${err ? '：' + err : ''}`);
  }
}

function hasCompare() {
  const r = spawnSync('compare', ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

/** ImageMagick compare -metric AE：返回差异像素数（读不到返回 null） */
function diffPixels(a, b) {
  const r = spawnSync('compare', ['-metric', 'AE', a, b, 'null:'], { encoding: 'utf8' });
  const text = String(r.stderr || '') + String(r.stdout || '');
  const m = /(\d+(?:\.\d+)?)\s*$/m.exec(text);
  if (!m) {
    const any = /(\d+)/.exec(text);
    return any ? Number(any[1]) : null;
  }
  return Math.round(Number(m[1]));
}

function main() {
  fs.mkdirSync(DIR, { recursive: true });

  const chrome = findChrome();
  if (!chrome) {
    console.log('跳过视觉回归：没找到 Chrome/Chromium（设 CHROME=<可执行文件> 可指定）');
    return 0;
  }
  const compare = hasCompare();
  if (!compare) console.log('提示：没有 ImageMagick compare，只截图不比对');

  const tmp = path.join(DIR, '.candidate.png');
  let fail = 0;

  for (const shot of SHOTS) {
    const base = path.join(DIR, shot.name + '.png');
    if (UPDATE || !fs.existsSync(base)) {
      shoot(chrome, shot, base);
      console.log(`基线已写入 ${path.relative(ROOT, base)}`);
      continue;
    }

    shoot(chrome, shot, tmp);
    if (!compare) { console.log(`拍摄 ${shot.name}（无 compare，跳过比对）`); continue; }

    const d = diffPixels(base, tmp);
    if (d == null) { console.log(`✗ ${shot.name}：比对失败（compare 无输出）`); fail++; continue; }

    const bad = d > TOLERANCE;
    if (bad) fail++;
    const mark = bad ? '✗' : '✓';
    const extra = V || bad ? `（差异 ${d}px，阈值 ${TOLERANCE}）` : '';
    console.log(`${mark} ${shot.name}${extra}`);
    if (bad) console.log(`   基线 ${path.relative(ROOT, base)}；本次 ${path.relative(ROOT, tmp)}`);
  }

  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);

  if (fail) {
    console.log(`\n视觉回归失败：${fail} 个机位超出阈值。确认改动是有意的，跑 node tools/shots.js --update 重写基线。`);
    return 1;
  }
  console.log('\n视觉回归通过。');
  return 0;
}

process.exit(main());
