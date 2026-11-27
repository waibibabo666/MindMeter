#!/usr/bin/env node
/**
 * L-02 本地计分（scoring-v3.3）的金标准检查。
 *
 * 覆盖：
 *   - 4 组手算金标准：全对 / 中等 / 偏低 / 最低边界
 *   - 缺失与边界：未测、完成率不足、sv 正确数不足、vc 空题
 *   - 结构约束：返回值没有 total，只给八维
 *   - 性能：1000 次计分 < 100ms
 *
 * 用法：node scripts/test_scoring.js
 */
'use strict';

const path = require('path');
const url = require('url');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'code', 'frontend');
const href = (p) => url.pathToFileURL(p).href;

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const eq = (actual, expected, label) => {
  if (actual !== expected) {
    throw new Error(`${label}：期望 ${expected}，实际 ${actual}`);
  }
};

/** 造 answers：前 targets 个 isOld，后 foils 个不是。 */
function makeAnswers(targets, foils) {
  const list = [];
  for (let i = 0; i < targets; i += 1) list.push({ isOld: true, answer: true });
  for (let i = 0; i < foils; i += 1) list.push({ isOld: false, answer: false });
  return list;
}

const rts = (n, value) => new Array(n).fill(value);

async function main() {
  const scoring = await import(href(path.join(APP_DIR, 'src', 'scoring', 'index.js')));

  // ---------- 金标准 ----------

  test('金标准·全对（四个满分档）', () => {
    const r = scoring.scoreSession({
      vc: { metrics: { total: 8, correct: 8 } },
      ps: { metrics: { correct: 24 } },
      sv: { metrics: { total: 8, correct: 8, correctRts: rts(8, 1500) } },
      am: { metrics: { hits: 8, falseAlarms: 0 }, answers: makeAnswers(8, 8) },
    });
    eq(r.dimensions.vc, 100, 'vc');
    eq(r.dimensions.ps, 100, 'ps');
    eq(r.dimensions.sv, 100, 'sv');
    eq(r.dimensions.am, 84, 'am'); // d' = 3.186
  });

  test('金标准·中等（vc 5/8、ps 14、sv 6/8 2500ms、am 6命中2虚报）', () => {
    const r = scoring.scoreSession({
      vc: { metrics: { total: 8, correct: 5 } },
      ps: { metrics: { correct: 14 } },
      sv: { metrics: { total: 8, correct: 6, correctRts: rts(6, 2500) } },
      am: { metrics: { hits: 6, falseAlarms: 2 }, answers: makeAnswers(8, 8) },
    });
    eq(r.dimensions.vc, 50, 'vc');
    eq(r.dimensions.ps, 38, 'ps');
    eq(r.dimensions.sv, 71, 'sv');
    eq(r.dimensions.am, 44, 'am'); // d' = 1.179
  });

  test('金标准·偏低（vc 3/8、ps 9、sv 4/8 3800ms、am 3命中5虚报）', () => {
    const r = scoring.scoreSession({
      vc: { metrics: { total: 8, correct: 3 } },
      ps: { metrics: { correct: 9 } },
      sv: { metrics: { total: 8, correct: 4, correctRts: rts(4, 3800) } },
      am: { metrics: { hits: 3, falseAlarms: 5 }, answers: makeAnswers(8, 8) },
    });
    eq(r.dimensions.vc, 17, 'vc');
    eq(r.dimensions.ps, 6, 'ps');
    eq(r.dimensions.sv, 37, 'sv');
    eq(r.dimensions.am, 9, 'am'); // d' = -0.564
  });

  test('金标准·最低边界（0 分不是 null）', () => {
    const r = scoring.scoreSession({
      vc: { metrics: { total: 8, correct: 0 } },
      ps: { metrics: { correct: 8 } },
      am: { metrics: { hits: 0, falseAlarms: 8 }, answers: makeAnswers(8, 8) },
    });
    eq(r.dimensions.vc, 0, 'vc');
    eq(r.dimensions.ps, 0, 'ps');
    eq(r.dimensions.am, 0, 'am'); // d' = -3.186 → 截断到 0
  });

  // ---------- 缺失与边界 ----------

  test('未测：results 为空时八维全为 null', () => {
    const r = scoring.scoreSession({});
    eq(r.measured.length, 0, 'measured 长度');
    eq(r.missing.length, 8, 'missing 长度');
    Object.entries(r.dimensions).forEach(([k, v]) => eq(v, null, k));
  });

  test('sv：正确试次少于 4 时记 null', () => {
    const r = scoring.scoreSession({
      sv: { metrics: { total: 8, correct: 3, correctRts: rts(3, 2000) } },
    });
    eq(r.dimensions.sv, null, 'sv');
  });

  test('sv：完成率不足（5/8）记 null', () => {
    const r = scoring.scoreSession({
      sv: { metrics: { total: 5, correct: 5, correctRts: rts(5, 2000) } },
    });
    eq(r.dimensions.sv, null, 'sv');
  });

  test('sv：剔除 <200ms 与 >3×中位数的异常反应时', () => {
    // 中位数 1000；2000 与 5000 中 5000 > 3000 被剔除，150 被剔除
    const r = scoring.scoreSession({
      sv: {
        metrics: { total: 8, correct: 6, correctRts: [1000, 1000, 1000, 1000, 2000, 150, 5000] },
      },
    });
    assert(r.dimensions.sv !== null, 'sv 不应为 null');
    // 有效值 [1000,1000,1000,1000,2000] 中位数 1000 → acc 0.75、rt 满分
    eq(r.dimensions.sv, 83, 'sv');
  });

  test('vc：total 为 0 时记 null', () => {
    const r = scoring.scoreSession({ vc: { metrics: { total: 0, correct: 0 } } });
    eq(r.dimensions.vc, null, 'vc');
  });

  test('ps：超过上锚点时截断到 100', () => {
    const r = scoring.scoreSession({ ps: { metrics: { correct: 30 } } });
    eq(r.dimensions.ps, 100, 'ps');
  });

  test('am：没有 answers 时按默认 8/8 计算', () => {
    const r = scoring.scoreSession({
      am: { metrics: { hits: 8, falseAlarms: 0 } },
    });
    eq(r.dimensions.am, 84, 'am');
  });

  // ---------- 结构约束 ----------

  test('结构：返回值里没有总分字段', () => {
    const r = scoring.scoreSession({
      vc: { metrics: { total: 8, correct: 8 } },
      ps: { metrics: { correct: 20 } },
    });
    ['total', 'mean', 'average', 'composite', 'score'].forEach((key) => {
      assert(!(key in r), `不应出现 ${key} 字段`);
    });
    eq(r.version, 'scoring-v3.3', 'version');
    eq(Object.keys(r.dimensions).length, 8, '维度数');
  });

  test('复现：同一输入两次调用结果相同', () => {
    const input = {
      vc: { metrics: { total: 6, correct: 5 } },
      ps: { metrics: { correct: 17 } },
      sv: { metrics: { total: 8, correct: 7, correctRts: rts(7, 2100) } },
      am: { metrics: { hits: 7, falseAlarms: 1 }, answers: makeAnswers(8, 8) },
    };
    const a = JSON.stringify(scoring.scoreSession(input));
    const b = JSON.stringify(scoring.scoreSession(input));
    eq(a, b, '两次结果');
  });

  test('性能：1000 次计分 < 100ms', () => {
    const input = {
      vc: { metrics: { total: 6, correct: 5 } },
      ps: { metrics: { correct: 17 } },
      sv: { metrics: { total: 8, correct: 7, correctRts: rts(7, 2100) } },
      am: { metrics: { hits: 7, falseAlarms: 1 }, answers: makeAnswers(8, 8) },
    };
    const start = Date.now();
    for (let i = 0; i < 1000; i += 1) scoring.scoreSession(input);
    const cost = Date.now() - start;
    assert(cost < 100, `1000 次耗时 ${cost}ms，超过 100ms`);
    console.log(`       （1000 次计分耗时 ${cost}ms）`);
  });

  // ---------- 运行 ----------

  // ---------- 补齐的四个维度（vf / nc / ir / ni） ----------

  test('金标准·言语流畅性 10/20/30 个有效词 = 0/50/100', () => {
    eq(scoring.scoreVf({ validCount: 10 }), 0, 'vf@10');
    eq(scoring.scoreVf({ validCount: 20 }), 50, 'vf@20');
    eq(scoring.scoreVf({ validCount: 30 }), 100, 'vf@30');
  });

  test('金标准·数字运算 18/20 = 90', () => {
    eq(scoring.scoreNc({ total: 20, correct: 18 }), 90, 'nc');
  });

  test('金标准·归纳推理（四选一，0.25 校正）9/15 = 47，全猜得 0', () => {
    eq(scoring.scoreIr({ total: 15, correct: 9 }), 47, 'ir');
    eq(scoring.scoreIr({ total: 8, correct: 2 }, 8), 0, 'ir 纯猜水平应为 0 分，不是 25');
    eq(scoring.scoreIr({ total: 8, correct: 8 }, 8), 100, 'ir 全对');
  });

  test('金标准·自然探索（三选一，1/3 校正）15/20 = 63，全猜得 0', () => {
    eq(scoring.scoreNi({ total: 20, correct: 15 }), 63, 'ni');
    eq(scoring.scoreNi({ total: 6, correct: 2 }, 6), 0, 'ni 纯猜水平应为 0 分，不是 33');
    eq(scoring.scoreNi({ total: 6, correct: 6 }, 6), 100, 'ni 全对');
  });

  test('边界·流畅性低于 10 词记 0，满分封顶 100', () => {
    eq(scoring.scoreVf({ validCount: 5 }), 0, 'vf 下限');
    eq(scoring.scoreVf({ validCount: 120 }), 100, 'vf 60 秒内 120 个词仍在合法范围，封顶 100');
  });

  // ---------- v3.3：作答合法性（客户端上报的计数不可信） ----------

  test('合法性·正确数不能超过总数，也不能为负', () => {
    eq(scoring.scoreVc({ total: 6, correct: 60 }), null, 'vc correct>total');
    eq(scoring.scoreIr({ total: 15, correct: -1 }), null, 'ir 负数');
    eq(scoring.scoreNc({ total: 20, correct: 21 }), null, 'nc correct>total');
    eq(scoring.scoreNi({ total: 20, correct: Number.POSITIVE_INFINITY }), null, 'ni Infinity');
    eq(scoring.scoreSv({ total: 8, weighted: 80 }), null, 'sv weighted>total');
  });

  test('合法性·总题数不能超过该档发放的题数', () => {
    // 标准档 nc 只发 10 题：上报 40 题 40 对就是伪造
    eq(scoring.scoreNc({ total: 40, correct: 40 }, 10), null, 'nc total>expected');
    eq(scoring.scoreNc({ total: 10, correct: 10 }, 10), 100, '正常的满题量仍可计分');
  });

  test('合法性·限时任务的作答速度不能超过人类上限', () => {
    eq(scoring.scorePs({ encCorrect: 9999, catCorrect: 9999 }), null, 'ps 新口径 9999');
    eq(scoring.scorePs({ correct: 9999 }), null, 'ps 旧口径 9999');
    eq(
      scoring.scorePs({ encCorrect: 30, encWrong: 0, catCorrect: 30, catWrong: 0 }),
      100,
      'ps 60 次/45 秒合法',
    );
    eq(scoring.scorePs({ encCorrect: -5, catCorrect: 10 }), null, 'ps 负数');
    eq(scoring.scoreVf({ validCount: 500 }), null, 'vf 60 秒 500 个词');
  });

  test('合法性·联想记忆一次点对数不能超过目标数', () => {
    eq(scoring.scoreAm({ targets: 6, firstTry: 60 }), null, 'am PAL');
    eq(scoring.scoreAm({ hits: 99, falseAlarms: 0 }), null, 'am hits>targets');
  });

  test('边界·题量不足（截断的题本）记 null', () => {
    // total 是本次实际下发的题量；低于设计题量的 80% 视为未完成。
    eq(scoring.scoreNc({ total: 10, correct: 10 }), null, 'nc 只发 10/20 题');
    eq(scoring.scoreIr({ total: 5, correct: 5 }), null, 'ir 只发 5/15 题');
    eq(scoring.scoreNi({ total: 4, correct: 4 }), null, 'ni 只发 4/20 题');
    eq(scoring.scoreNc({ total: 16, correct: 12 }), 75, 'nc 刚好 80% 题量应可计分');
  });

  test('缺失·新四维无指标时为 null', () => {
    eq(scoring.scoreVf(null), null, 'vf null');
    eq(scoring.scoreNc({}), null, 'nc 空对象');
    eq(scoring.scoreIr({ total: 15 }), null, 'ir 缺 correct');
    eq(scoring.scoreNi(null), null, 'ni null');
  });

  test('结构·八维齐全时 measured=8、missing=0', () => {
    const r = scoring.scoreSession({
      vc: { metrics: { total: 8, correct: 8 } },
      vf: { metrics: { validCount: 20 } },
      // 标准档真实题量：nc 10 / ir 8 / ni 8（总题数超过发放数会被判不合法）
      nc: { metrics: { total: 10, correct: 9 } },
      ps: { metrics: { correct: 24 } },
      ir: { metrics: { total: 8, correct: 7 } },
      sv: { metrics: { total: 8, correct: 8, correctRts: rts(8, 1500) } },
      am: { metrics: { hits: 8, falseAlarms: 0 }, answers: makeAnswers(8, 8) },
      ni: { metrics: { total: 8, correct: 7 } },
    });
    eq(r.measured.length, 8, 'measured 数量');
    eq(r.missing.length, 0, 'missing 数量');
    eq(r.dimensions.nc, 90, 'nc');
    eq(r.dimensions.ir, 83, 'ir');
    eq(r.dimensions.ni, 81, 'ni');
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
