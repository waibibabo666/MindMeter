#!/usr/bin/env node
/**
 * L-02：本地计分 scoring-v3 的检查。
 *
 * 覆盖：
 *   - 8 个维度公式（full 口径按算法文档；short 口径按本壳题量）
 *   - 手算金标准（每个维度至少一条）
 *   - 边界：0 分、满分、超额截断、负数截断
 *   - 缺失：没有指标 / 分母为 0 → null，不补 0
 *   - 规则：空间正确试次不足 → null；记忆用 d′ 且做 +0.5/+1 校正
 *   - 无总分；确定性；8 维计分 < 100ms
 *
 * 用法：node scripts/test_scoring.js
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'code', 'frontend', 'src');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const eq = (actual, expected, label) => {
  assert(actual === expected, `${label}：期望 ${expected}，实际 ${actual}`);
};

async function main() {
  const S = await import(pathToFileURL(path.join(SRC, 'scoring', 'local.js')).href);
  const FULL = S.FORM.FULL;
  const SHORT = S.FORM.SHORT;

  // ---------- 结构 ----------
  test('8 个维度都有实现', () => {
    eq(S.DIM_IDS.length, 8, '维度数量');
    for (const id of ['vc', 'vf', 'nc', 'ps', 'ir', 'sv', 'am', 'ni']) {
      assert(typeof S.SCORERS[id] === 'function', `缺 ${id} 的实现`);
    }
  });

  // ---------- 手算金标准（full 口径） ----------
  test('金标准：言语理解 12/15 = 80', () => {
    eq(S.scoreVc({ correct: 12 }, FULL), 80, 'vc');
  });

  test('金标准：言语流畅性 10 词 = 0，30 词 = 100，20 词 = 50', () => {
    eq(S.scoreVf({ validCount: 10 }, FULL), 0, 'vf@10');
    eq(S.scoreVf({ validCount: 30 }, FULL), 100, 'vf@30');
    eq(S.scoreVf({ validCount: 20 }, FULL), 50, 'vf@20');
  });

  test('金标准：数字运算 18/20 = 90', () => {
    eq(S.scoreNc({ correct: 18 }, FULL), 90, 'nc');
  });

  test('金标准：知觉速度 20 次 = 0，40 次 = 50，60 次 = 100', () => {
    eq(S.scorePs({ correct: 20 }, FULL), 0, 'ps@20');
    eq(S.scorePs({ correct: 40 }, FULL), 50, 'ps@40');
    eq(S.scorePs({ correct: 60 }, FULL), 100, 'ps@60');
  });

  test('金标准：归纳推理 9/15 = 60', () => {
    eq(S.scoreIr({ correct: 9 }, FULL), 60, 'ir');
  });

  test('金标准：空间 16/20、RT 2000ms = 86', () => {
    eq(S.scoreSv({ correct: 16, total: 20, medianRtMs: 2000 }, FULL), 86, 'sv');
  });

  test('金标准：自然探索 15/20 = 75', () => {
    eq(S.scoreNi({ correct: 15 }, FULL), 75, 'ni');
  });

  test('金标准：联想记忆全对（12/12、0 虚报）= 91', () => {
    const value = S.scoreAm({ hits: 12, misses: 0, falseAlarms: 0, targets: 12, foils: 12 }, FULL);
    eq(value, 91, 'am 全对');
  });

  test('金标准：联想记忆 d′ 随表现单调上升', () => {
    const strong = S.scoreAm({ hits: 10, misses: 2, falseAlarms: 1, targets: 12, foils: 12 }, FULL);
    const weak = S.scoreAm({ hits: 5, misses: 7, falseAlarms: 6, targets: 12, foils: 12 }, FULL);
    assert(strong > weak, `强表现应更高：${strong} vs ${weak}`);
    assert(strong >= 0 && strong <= 100 && weak >= 0 && weak <= 100, '越界');
  });

  // ---------- short 口径（本壳实际题量） ----------
  test('short：言语 5/6 = 83', () => {
    eq(S.scoreVc({ correct: 5, total: 6 }, SHORT), 83, 'vc short');
  });

  test('short：知觉 24/30 = 80（按完成题数）', () => {
    eq(S.scorePs({ correct: 24, trials: 30 }, SHORT), 80, 'ps short');
  });

  test('short：空间 7/8、RT 2000ms = 91', () => {
    eq(S.scoreSv({ correct: 7, total: 8, medianRtMs: 2000 }, SHORT), 91, 'sv short');
  });

  test('short：空间无 RT 时只看正确率', () => {
    eq(S.scoreSv({ correct: 6, total: 8 }, SHORT), 75, 'sv 无 RT');
  });

  // ---------- 边界 ----------
  test('边界：0 分与满分', () => {
    eq(S.scoreVc({ correct: 0 }, FULL), 0, 'vc 0');
    eq(S.scoreVc({ correct: 15 }, FULL), 100, 'vc 满分');
  });

  test('边界：超额与负数截断到 0–100', () => {
    eq(S.scoreVc({ correct: 30 }, FULL), 100, 'vc 超额');
    eq(S.scoreVc({ correct: -5 }, FULL), 0, 'vc 负数');
    eq(S.scoreVf({ validCount: 5 }, FULL), 0, 'vf 低于下限');
    eq(S.scoreVf({ validCount: 500 }, FULL), 100, 'vf 超上限');
  });

  test('边界：结果都是 0–100 的整数', () => {
    const samples = [
      S.scoreVc({ correct: 7 }, FULL),
      S.scoreVf({ validCount: 13 }, FULL),
      S.scoreNc({ correct: 3 }, FULL),
      S.scorePs({ correct: 27 }, FULL),
      S.scoreIr({ correct: 4 }, FULL),
      S.scoreSv({ correct: 11, total: 20, medianRtMs: 3100 }, FULL),
      S.scoreAm({ hits: 4, misses: 8, falseAlarms: 7, targets: 12, foils: 12 }, FULL),
      S.scoreNi({ correct: 2 }, FULL),
    ];
    for (const value of samples) {
      assert(Number.isInteger(value), `应为整数：${value}`);
      assert(value >= 0 && value <= 100, `越界：${value}`);
    }
  });

  // ---------- 缺失 ----------
  test('缺失：没有指标一律 null，不补 0', () => {
    for (const id of S.DIM_IDS) {
      eq(S.SCORERS[id](null, FULL), null, `${id} 无指标`);
      eq(S.SCORERS[id]({}, FULL), null, `${id} 空指标`);
    }
  });

  test('缺失：分母为 0 时返回 null', () => {
    eq(S.scorePs({ correct: 0, trials: 0 }, SHORT), null, 'ps trials=0');
    eq(S.scoreSv({ correct: 0, total: 0 }, SHORT), null, 'sv total=0');
    eq(S.scoreVc({ correct: 0, total: 0 }, SHORT), null, 'vc total=0');
  });

  test('规则：空间正确试次不足一半 → null', () => {
    eq(S.scoreSv({ correct: 3, total: 8, medianRtMs: 2000 }, SHORT), null, 'short 3/8');
    eq(S.scoreSv({ correct: 9, total: 20, medianRtMs: 2000 }, FULL), null, 'full 9/20');
    eq(
      S.scoreSv({ correct: 10, total: 20, medianRtMs: 2000 }, FULL) !== null,
      true,
      'full 10/20 应可计分',
    );
  });

  test('规则：记忆缺 foils 时能从 trials 推出', () => {
    const value = S.scoreAm({ hits: 6, misses: 2, falseAlarms: 1, trials: 16 }, SHORT);
    assert(Number.isInteger(value) && value >= 0 && value <= 100, `应可计分：${value}`);
  });

  // ---------- 会话级 ----------
  test('scoreSession 输出 8 维、无总分', () => {
    const out = S.scoreSession({
      vc: { metrics: { correct: 5, total: 6 } },
      ps: { metrics: { correct: 24, trials: 30 } },
    });
    eq(Object.keys(out.scores).length, 8, '维度数');
    assert(!('total' in out.scores), '不应有 total 字段');
    eq(
      Object.keys(out).sort().join(','),
      ['form', 'scores', 'version'].sort().join(','),
      '顶层字段',
    );
    eq(out.version, S.SCORING_VERSION, '版本号');
  });

  test('确定性：同输入同输出', () => {
    const input = {
      vc: { metrics: { correct: 5, total: 6 } },
      am: { metrics: { hits: 6, misses: 2, falseAlarms: 1, trials: 16 } },
    };
    eq(
      JSON.stringify(S.scoreSession(input, SHORT)),
      JSON.stringify(S.scoreSession(input, SHORT)),
      '两次结果不一致',
    );
  });

  test('性能：8 维计分 1000 次 < 100ms', () => {
    const input = {
      vc: { metrics: { correct: 5, total: 6 } },
      vf: { metrics: { validCount: 18 } },
      nc: { metrics: { correct: 16, total: 20 } },
      ps: { metrics: { correct: 24, trials: 30 } },
      ir: { metrics: { correct: 11, total: 15 } },
      sv: { metrics: { correct: 7, total: 8, medianRtMs: 2200 } },
      am: { metrics: { hits: 6, misses: 2, falseAlarms: 1, trials: 16 } },
      ni: { metrics: { correct: 15, total: 20 } },
    };
    const rounds = 1000;
    const start = process.hrtime.bigint();
    for (let i = 0; i < rounds; i += 1) S.scoreSession(input, SHORT);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert(elapsedMs < 100, `1000 次耗时 ${elapsedMs.toFixed(1)}ms，超过 100ms 预算`);
    console.log(`       性能：${rounds} 次 ${elapsedMs.toFixed(1)}ms`);
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
  console.log(`\n${passed}/${tests.length} scoring checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
