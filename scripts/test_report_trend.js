#!/usr/bin/env node
/**
 * L-08：报告与趋势的检查（无网络、无浏览器）。
 *
 * 覆盖：
 *   - 雷达：8 轴、未测不画 0、已测少于 3 个不连线
 *   - 趋势：只比共同维度、delta 计算、单边维度单列
 *   - 7 天提示：不足 7 天给提示，满 7 天不给
 *
 * 用法：node scripts/test_report_trend.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'code', 'frontend', 'src');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function main() {
  const radar = await import(pathToFileURL(path.join(SRC, 'charts', 'radar.js')).href);
  const trend = await import(pathToFileURL(path.join(SRC, 'trend.js')).href);

  test('雷达：8 轴，未测留空', () => {
    const dims = [
      { id: 'vc', name: '言语理解' },
      { id: 'vf', name: '言语流畅性' },
      { id: 'nc', name: '数字运算' },
      { id: 'ps', name: '知觉速度' },
      { id: 'ir', name: '归纳推理' },
      { id: 'sv', name: '空间视觉化' },
      { id: 'am', name: '联想记忆' },
      { id: 'ni', name: '自然探索' },
    ];
    const scores = { vc: 80, vf: null, nc: null, ps: 60, ir: null, sv: 70, am: null, ni: null };
    const built = radar.buildRadar(dims, scores);
    assert(built.axes.length === 8, '应为 8 轴');
    assert(built.measuredCount === 3, `已测应为 3，实际 ${built.measuredCount}`);
    assert(
      built.axes.filter((a) => !a.measured).every((a) => a.point === null),
      '未测不应有点坐标',
    );

    const markup = radar.radarMarkup(built);
    assert((markup.match(/未测/g) || []).length === 5, '未测标注数量不符');
    assert(markup.includes('<polygon'), '缺少雷达多边形');
    for (const point of markup.match(/<circle cx="([\d.]+)" cy="([\d.]+)"/g) || []) {
      const numbers = point.match(/[\d.]+/g).map(Number);
      assert(numbers[0] >= 0 && numbers[0] <= built.size, '点超出画布宽度');
      assert(numbers[1] >= 0 && numbers[1] <= built.size, '点超出画布高度');
    }
  });

  test('雷达：已测少于 3 个不连线', () => {
    const dims = [
      { id: 'vc', name: '言语理解' },
      { id: 'ps', name: '知觉速度' },
      { id: 'sv', name: '空间' },
    ];
    const built = radar.buildRadar(dims, { vc: 50, ps: null, sv: null });
    assert(built.polygon === '', '少于 3 个已测不应生成多边形');
  });

  test('趋势：只比共同维度', () => {
    const prev = { finishedAt: '2026-10-01T00:00:00Z', scores: { vc: 50, ps: 60, sv: 70 } };
    const next = { finishedAt: '2026-10-20T00:00:00Z', scores: { vc: 66, ps: 60, am: 40 } };
    const out = trend.buildTrend(prev, next, {
      vc: '言语理解',
      ps: '知觉速度',
      sv: '空间',
      am: '联想',
    });
    assert(out.rows.length === 2, `应只有 2 个共同维度，实际 ${out.rows.length}`);
    assert(out.rows[0].delta === 16, `vc 变化应为 +16，实际 ${out.rows[0].delta}`);
    assert(out.rows[1].delta === 0, 'ps 应持平');
    assert(out.onlyPrev.includes('sv') && out.onlyNext.includes('am'), '单边维度应单列');
    assert(out.days === 19, `间隔应为 19 天，实际 ${out.days}`);
  });

  test('7 天提示', () => {
    assert(trend.repeatHint(3).includes('练习效应'), '3 天应提示');
    assert(trend.repeatHint(6) !== null, '6 天应提示');
    assert(trend.repeatHint(7) === null, '7 天不应提示');
    assert(trend.repeatHint(30) === null, '30 天不应提示');
    assert(trend.repeatHint(null) === null, '缺少天数不提示');
  });

  test('页面文件存在且引用正确模块', () => {
    for (const rel of [
      'pages/report.js',
      'pages/trend.js',
      'charts/radar.js',
      'scoring/index.js',
      'trend.js',
    ]) {
      assert(fs.existsSync(path.join(SRC, rel)), `缺少 ${rel}`);
    }
    const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
    assert(app.includes("'/trend': renderTrend"), 'app.js 未注册 /trend');
    assert(app.includes('addSession('), 'app.js 未持久化 session');
    const report = fs.readFileSync(path.join(SRC, 'pages', 'report.js'), 'utf8');
    assert(report.includes('radarMarkup'), '报告页未使用雷达');
    assert(/不设总分|无总分/.test(report), '报告页应明确声明不设总分');
    assert(!/总分[:：]\s*\d/.test(report), '不应展示总分数值');
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
  console.log(`\n${passed}/${tests.length} report/trend checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
