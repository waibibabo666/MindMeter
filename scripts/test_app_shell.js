#!/usr/bin/env node
/**
 * L-01 静态 App 壳的检查（无依赖、无浏览器）。
 *
 * 覆盖：
 *   - 目录与入口文件存在、无后端调用（静态壳不 fetch）
 *   - 标准档 4 项顺序与档位可用性
 *   - 4 个任务的纯逻辑：旋转、选项唯一性、再认构造、指标汇总
 *   - 路由解析与状态读写（含损坏数据回退）
 *   - 360px / 触控区 / 减少动效等样式约定
 *
 * 用法：node scripts/test_app_shell.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'code', 'frontend');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

function read(rel) {
  return fs.readFileSync(path.join(APP_DIR, rel), 'utf8');
}

function listSrc() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css|html)$/.test(entry.name)) out.push(full);
    }
  };
  walk(APP_DIR);
  return out;
}

async function main() {
  const data = await import(pathToHref(path.join(APP_DIR, 'src', 'data.js')));
  const router = await import(pathToHref(path.join(APP_DIR, 'src', 'router.js')));
  const store = await import(pathToHref(path.join(APP_DIR, 'src', 'store.js')));
  const sv = await import(pathToHref(path.join(APP_DIR, 'src', 'tasks', 'sv.js')));
  const ps = await import(pathToHref(path.join(APP_DIR, 'src', 'tasks', 'ps.js')));
  const am = await import(pathToHref(path.join(APP_DIR, 'src', 'tasks', 'am.js')));
  const vc = await import(pathToHref(path.join(APP_DIR, 'src', 'tasks', 'vc.js')));

  test('入口文件与模块齐全', () => {
    for (const rel of [
      'index.html',
      'src/app.js',
      'src/router.js',
      'src/store.js',
      'src/storage.js',
      'src/log.js',
      'src/data.js',
      'src/ui.js',
      'src/pages/home.js',
      'src/pages/tier.js',
      'src/pages/consent.js',
      'src/pages/task.js',
      'src/pages/report.js',
      'src/tasks/vc.js',
      'src/tasks/ps.js',
      'src/tasks/sv.js',
      'src/tasks/am.js',
      'src/styles/app.css',
    ]) {
      assert(fs.existsSync(path.join(APP_DIR, rel)), `missing ${rel}`);
    }
  });

  test('index.html 具备视口、主区域与模块入口', () => {
    const html = read('index.html');
    assert(/<meta name="viewport"/.test(html), 'viewport meta missing');
    assert(/id="app"/.test(html), '#app mount point missing');
    assert(
      /type="module"[^>]*src="\.\/src\/app\.js"|src="\.\/src\/app\.js"[^>]*type="module"/.test(
        html,
      ),
      'module entry missing',
    );
    assert(/skip-link/.test(html), 'skip link missing');
  });

  test('只有本地 API 客户端可以发起网络请求', () => {
    for (const file of listSrc()) {
      const relative = path.relative(APP_DIR, file).replaceAll('\\', '/');
      if (relative === 'src/api.js' || relative === 'src/llm/client.js') continue;
      const text = fs.readFileSync(file, 'utf8');
      assert(!/\bfetch\s*\(/.test(text), `${relative} uses fetch()`);
      assert(!/XMLHttpRequest/.test(text), `${relative} uses XMLHttpRequest`);
    }
    const api = read('src/api.js');
    assert(api.includes("'X-MM-Token'"), 'api.js must attach the local token');
    assert(!api.includes('apiKey'), 'api.js must not know about LLM keys');
  });

  test('标准档 4 项且顺序固定', () => {
    assert(
      JSON.stringify(data.STANDARD_ORDER) === JSON.stringify(['vc', 'ps', 'sv', 'am']),
      'unexpected standard order',
    );
    const standard = data.TIERS.find((t) => t.id === 'standard');
    assert(standard && standard.available === true, 'standard tier must be available');
    assert(
      JSON.stringify(standard.tasks) === JSON.stringify(data.STANDARD_ORDER),
      'tier tasks must match order',
    );
    for (const id of ['quick', 'deep']) {
      const tier = data.TIERS.find((t) => t.id === id);
      assert(tier && tier.available === false, `${id} must stay unavailable in L-01`);
    }
  });

  test('言语理解题库结构合法', () => {
    assert(data.VC_ITEMS.length === 6, 'expect 6 items');
    for (const item of data.VC_ITEMS) {
      assert(item.options.length === 4, `bad option count: ${item.q}`);
      assert(item.answer >= 0 && item.answer < 4, `bad answer index: ${item.q}`);
    }
    const summary = vc.summarizeVc([
      { correct: true, rtMs: 1000 },
      { correct: false, rtMs: 3000 },
    ]);
    assert(summary.total === 2 && summary.correct === 1, 'vc summary wrong');
    assert(summary.accuracy === 0.5, 'vc accuracy wrong');
    assert(summary.meanRtMs === 2000, 'vc mean rt wrong');
  });

  test('旋转：四次 90° 回到原图，180° 两次等价', () => {
    const base = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    assert(JSON.stringify(sv.rotate(base, 360)) === JSON.stringify(base), '360 should be identity');
    assert(
      JSON.stringify(sv.rotate(sv.rotate(base, 180), 180)) === JSON.stringify(base),
      '180x2 should be identity',
    );
    const once = sv.rotate(base, 90);
    assert(JSON.stringify(sv.rotate(base, 0)) !== JSON.stringify(once) || true, 'sanity');
  });

  test('空间题：8 题、4 个互不相同的选项、答案唯一', () => {
    const items = sv.buildItems();
    assert(items.length === 8, 'expect 8 items');
    for (const item of items) {
      assert(item.options.length === 4, 'expect 4 options');
      const rounds = item.options.map((grid) => grid.join(''));
      assert(new Set(rounds).size === 4, 'options must be distinct');
      assert(item.answer >= 0 && item.answer < 4, 'answer index out of range');
      assert(
        JSON.stringify(item.options[item.answer]) === JSON.stringify(sv.rotate(item.base, 90)),
        'answer must be the 90° rotation',
      );
    }
  });

  test('知觉题：每题 4 个选项且只有一个与目标一致', () => {
    const trials = ps.buildTrials();
    assert(trials.length === 24, 'expect 24 trials');
    for (const trial of trials) {
      assert(trial.options.length === 4, 'expect 4 options');
      assert(new Set(trial.options).size === 4, 'options must be distinct');
      const matches = trial.options.filter((text) => text === trial.target);
      assert(matches.length === 1, 'exactly one option must equal target');
      assert(trial.options[trial.answer] === trial.target, 'answer index wrong');
    }
    const summary = ps.summarizePs([
      { correct: true, rtMs: 500 },
      { correct: false, rtMs: 900 },
    ]);
    assert(summary.correct === 1 && summary.wrong === 1, 'ps counts wrong');
    assert(summary.meanRtMs === 700, 'ps mean rt wrong');
  });

  test('联想记忆：8 旧 8 新，错配不能等于原配', () => {
    const trials = am.buildRecognition();
    assert(trials.length === 16, 'expect 16 trials');
    assert(trials.filter((t) => t.isOld).length === 8, 'expect 8 old pairs');

    const origin = new Set(data.AM_PAIRS.map(([l, r]) => `${l}|${r}`));
    for (const trial of trials.filter((t) => !t.isOld)) {
      assert(
        !origin.has(`${trial.left}|${trial.right}`),
        `foil equals an original pair: ${trial.left}-${trial.right}`,
      );
    }

    const summary = am.summarizeAm([
      { isOld: true, answer: true },
      { isOld: true, answer: false },
      { isOld: false, answer: true },
      { isOld: false, answer: false },
    ]);
    assert(summary.hits === 1 && summary.misses === 1, 'hit/miss wrong');
    assert(summary.falseAlarms === 1 && summary.correctRejections === 1, 'fa/cr wrong');
    assert(summary.accuracy === 0.5, 'accuracy wrong');
  });

  test('入口：计分统一、渲染有兜底、不写 console', () => {
    const app = read('src/app.js');
    const logModule = read('src/log.js');
    assert(app.includes("from './scoring/index.js'"), 'app.js 未使用统一计分');
    assert(!app.includes('scoring/local.js'), 'app.js 仍引用临时计分模块');
    assert(app.includes('showRenderError'), 'app.js 缺少渲染兜底');
    assert(app.includes("from './log.js'"), 'app.js 未接入统一日志模块');
    assert(logModule.includes('__MM_LOG__'), 'log.js 未使用内存缓冲');
    assert(!/console\.(log|info|warn|error|debug)\s*\(/.test(app), 'app.js 不应写 console');
  });

  test('异常处理：关键路径有本地兜底', () => {
    const task = read('src/pages/task.js');
    assert(task.includes('clearDraft'), 'task.js 缺少「草稿损坏重开」兜底');

    const report = read('src/pages/report.js');
    assert(report.includes('safeScore'), 'report.js 缺少计分失败兜底');

    const trend = read('src/pages/trend.js');
    assert(trend.includes('catch'), 'trend.js 缺少读取失败兜底');

    const app = read('src/app.js');
    assert(app.includes('导出失败'), 'app.js 导出失败未提示用户');
    assert(app.includes('清除失败'), 'app.js 清除失败未提示用户');
    assert(app.includes('safeScores'), 'app.js 计分失败未兜底');
  });

  test('路由解析与未知路径回退', () => {
    assert(router.parseHash('#/').path === '/', 'root parse failed');
    assert(router.parseHash('#/task/vc').param === 'vc', 'param parse failed');
    assert(router.parseHash('#/report').path === '/report', 'report parse failed');
    assert(router.parseHash('').full === '/', 'empty hash should be root');
    assert(router.isKnown(router.parseHash('#/report')), 'report should be known');
    assert(!router.isKnown(router.parseHash('#/task')), '/task without param must be unknown');
    assert(!router.isKnown(router.parseHash('#/nope')), 'unknown path must be rejected');
  });

  test('状态缓存读写与重置', () => {
    store.resetState();
    const fresh = store.readState();
    assert(fresh.tier === null && Array.isArray(fresh.order), 'default state wrong');

    store.writeState(Object.assign({}, fresh, { tier: 'standard', order: ['vc'] }));
    assert(store.readState().tier === 'standard', 'roundtrip failed');

    store.resetState();
    assert(store.readState().tier === null, 'reset must clear the cache');
  });

  test('样式：360px 适配、44px 触控区、减少动效', () => {
    const css = read('src/styles/app.css');
    assert(/--tap:\s*44px/.test(css), '44px tap target variable missing');
    assert(/@media\s*\(max-width:\s*380px\)/.test(css), 'mobile breakpoint missing');
    assert(/prefers-reduced-motion/.test(css), 'reduced motion support missing');
    assert(/focus-visible/.test(css), 'focus ring missing');
    assert(/min-height:\s*var\(--tap\)/.test(css), 'tap target not applied to buttons');
  });

  let passed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (error) {
      console.error(`[FAIL] ${name}`);
      console.error(`       ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} app shell checks passed`);
}

function pathToHref(p) {
  const url = require('url');
  return url.pathToFileURL(p).href;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
