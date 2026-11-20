#!/usr/bin/env node
/**
 * L-08：报告与趋势的检查（无网络、无浏览器）。
 *
 * 覆盖：
 *   - 雷达：8 轴、未测不画 0、已测少于 3 个不连线
 *   - 趋势：只比共同维度、delta 计算、单边维度单列
 *   - 7 天提示：不足 7 天给提示，满 7 天不给
 *   - 报告页的「与上次相比」：单次测评给基线（不是空态）、两次给差值
 *   - #/trend 作为兼容路径重定向到 #/report
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

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** 把可见文案抽出来，便于断言「用户看到的是什么」。 */
function collectText(target, out = []) {
  if (!target) return out;
  if (target.nodeType === 3) {
    if (target.textContent.trim()) out.push(target.textContent.trim());
    return out;
  }
  if (target.textContent && target.children.length === 0) out.push(target.textContent);
  for (const child of target.children || []) collectText(child, out);
  return out;
}

/** 抽出某个 `const NAME = { code: '…' }` 表里的 code 列表。 */
function mapKeys(source, name) {
  const block = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(source);
  if (!block) return [];
  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(':') && !line.startsWith('//'))
    .map((line) => line.slice(0, line.indexOf(':')).trim())
    .filter((key) => /^[a-z_]+$/.test(key));
}

/** 只给 compareSection 用的 DOM 替身：el()/button() 只碰这几个方法。 */
function makeDocument() {
  const node = () => {
    const self = {
      nodeType: 1,
      className: '',
      id: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      attributes: {},
      children: [],
      listeners: {},
      setAttribute(name, value) {
        self.attributes[name] = String(value);
        if (name === 'class') self.className = String(value);
        if (name === 'id') self.id = String(value);
      },
      addEventListener(type, handler) {
        self.listeners[type] = handler;
      },
      appendChild(child) {
        child.parentNode = self;
        self.children.push(child);
        return child;
      },
      removeChild(child) {
        self.children = self.children.filter((item) => item !== child);
        child.parentNode = null;
        return child;
      },
      get firstChild() {
        return self.children[0];
      },
    };
    return self;
  };
  return {
    createElement: () => node(),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}

/** 临时换上 DOM 替身跑一段，跑完还原（脚本里不能真的需要浏览器）。 */
function withDocument(run) {
  const previous = globalThis.document;
  globalThis.document = makeDocument();
  try {
    return run();
  } finally {
    globalThis.document = previous;
  }
}

/** 给 router 造一个 location/history/事件都能控制的 globalThis。 */
function fakeWindow(initialHash) {
  const handlers = {};
  const fake = {
    location: { hash: initialHash },
    listeners: handlers,
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
    removeEventListener(type) {
      delete handlers[type];
    },
    fire(type) {
      if (handlers[type]) handlers[type]();
    },
  };
  fake.history = {
    replaceState(_state, _title, url) {
      fake.location.hash = url;
    },
  };
  return fake;
}

function withGlobals(fake, run) {
  const previous = {
    location: globalThis.location,
    history: globalThis.history,
    addEventListener: globalThis.addEventListener,
    removeEventListener: globalThis.removeEventListener,
  };
  globalThis.location = fake.location;
  globalThis.history = fake.history;
  globalThis.addEventListener = fake.addEventListener.bind(fake);
  globalThis.removeEventListener = fake.removeEventListener.bind(fake);
  try {
    return run();
  } finally {
    globalThis.location = previous.location;
    globalThis.history = previous.history;
    globalThis.addEventListener = previous.addEventListener;
    globalThis.removeEventListener = previous.removeEventListener;
  }
}

async function main() {
  const radar = await import(pathToFileURL(path.join(SRC, 'charts', 'radar.js')).href);
  const trend = await import(pathToFileURL(path.join(SRC, 'trend.js')).href);
  const router = await import(pathToFileURL(path.join(SRC, 'router.js')).href);
  const trendPage = await import(pathToFileURL(path.join(SRC, 'pages', 'trend.js')).href);

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

  test('单次测评：报告页应给出基线区块，而不是空态', () => {
    const only = [
      {
        id: 's1',
        finishedAt: '2026-11-18T00:00:00Z',
        scores: { vc: 62, ps: 55, sv: 70, am: null, nc: null, ir: null, ni: null, vf: null },
      },
    ];
    const model = trendPage.buildCompareModel(only);
    assert(model.kind === 'baseline', `只有一次记录应为基线形态，实际 ${model.kind}`);
    assert(model.rows.length === 3, `基线应列出 3 个已测维度，实际 ${model.rows.length}`);
    assert(
      model.rows.every((row) => typeof row.score === 'number'),
      '基线行必须是真实分数',
    );
    assert(!model.rows.some((row) => row.name === '联想记忆'), '未测维度不该进基线（不许按 0 计）');

    const visible = withDocument(() =>
      trendPage
        .compareSection({ go: () => {} }, model, only)
        .map((item) => collectText(item).join('\n'))
        .join('\n'),
    );
    assert(/与上次相比/.test(visible), '基线卡片缺少「与上次相比」标题');
    assert(/第一次记录/.test(visible), '单次测评应写「这是这个账号的第一次记录」');
    assert(/基线/.test(visible), '基线卡片没有说明这些分数是基线');
    assert(/下次复测起/.test(visible), '基线卡片应说明下次复测起会显示变化');
    assert(
      !/还没有数据|还差一次|无法比较/.test(visible),
      `不该出现「像坏了」的空态文案：${visible}`,
    );
  });

  test('两次测评：基线换成差值，单边维度单列', () => {
    const sessions = [
      { id: 'b', finishedAt: '2026-11-18T00:00:00Z', scores: { vc: 66, ps: 60, am: 40 } },
      { id: 'a', finishedAt: '2026-11-01T00:00:00Z', scores: { vc: 50, ps: 60, sv: 70 } },
    ];
    const model = trendPage.buildCompareModel(sessions);
    assert(model.kind === 'compare', `两次可比应为差值形态，实际 ${model.kind}`);
    assert(model.rows.length === 2, `应只比 2 个共同维度，实际 ${model.rows.length}`);
    assert(model.days === 17, `间隔应 17 天，实际 ${model.days}`);
    assert(model.hint === null, '满 7 天不该提示练习效应');
    assert(
      model.trend.onlyPrev.includes('sv') && model.trend.onlyNext.includes('am'),
      '单边维度应单列',
    );

    const visible = withDocument(() =>
      trendPage
        .compareSection({ go: () => {} }, model, sessions)
        .map((item) => collectText(item).join('\n'))
        .join('\n'),
    );
    assert(/与上次相比/.test(visible), '差值卡片缺少「与上次相比」标题');
    assert(/\+16/.test(visible), '差值应显示 +16');
    assert(/持平/.test(visible), 'ps 应显示持平');
    assert(!/第一次记录/.test(visible), '两次记录不该还说「第一次记录」');
    assert(/只说变了多少，不说进步或退步/.test(visible), '缺少「不判断进步退步」口径');
    assert(/空间视觉化/.test(visible) && /联想记忆/.test(visible), '单边维度应单独列出');
    assert(!/进步了|退步了/.test(visible), '界面不许下进步/退步结论');
    assert(/只有 2 次记录/.test(visible), '两次记录应说明还谈不上下「趋势」');
  });

  test('间隔不足 7 天：差值卡片带练习效应提示', () => {
    const sessions = [
      { id: 'b', finishedAt: '2026-11-18T00:00:00Z', scores: { vc: 66 } },
      { id: 'a', finishedAt: '2026-11-16T00:00:00Z', scores: { vc: 50 } },
    ];
    const model = trendPage.buildCompareModel(sessions);
    assert(model.kind === 'compare', '两次记录应可比');
    assert(/练习效应/.test(String(model.hint)), `<7 天应给练习效应提示，实际 ${model.hint}`);
    const texts = withDocument(() =>
      collectText(trendPage.compareSection({ go: () => {} }, model, sessions)[0]).join('\n'),
    );
    assert(/练习效应/.test(texts), '卡片里应带上练习效应提示');
  });

  test('没有共同维度：退回基线而不是空表', () => {
    const sessions = [
      { id: 'b', finishedAt: '2026-11-18T00:00:00Z', scores: { am: 40 } },
      { id: 'a', finishedAt: '2026-11-01T00:00:00Z', scores: { sv: 70 } },
    ];
    const model = trendPage.buildCompareModel(sessions);
    assert(model.kind === 'baseline', `没有共同维度应退回基线，实际 ${model.kind}`);
    assert(model.reason === 'no-common-dims', '应说明退回基线的原因');
    const texts = withDocument(() =>
      collectText(trendPage.compareSection({ go: () => {} }, model, sessions)[0]).join('\n'),
    );
    assert(/算不出差值/.test(texts), `应说明为什么没有差值：${texts}`);
    assert(/基线/.test(texts), '仍然要把本次分数立为基线');
    assert(!/还没有数据/.test(texts), '不许出现「还没有数据」这种像坏了的文案');
  });

  test('没有任何记录：不渲染对比区块', () => {
    assert(trendPage.buildCompareModel([]).kind === 'none', '空列表应为 none');
    assert(trendPage.buildCompareModel(null).kind === 'none', 'null 应为 none 而不是抛错');
    assert(
      trendPage.buildCompareModel([{ id: 'x', scores: { vc: null } }]).kind === 'none',
      '全是未测（null）不该冒充基线',
    );
    withDocument(() => {
      const nodes = trendPage.compareSection({ go: () => {} }, trendPage.buildCompareModel([]), []);
      assert(nodes.length === 0, 'none 形态不应产出节点');
    });
  });

  test('等待动画：解读卡复用 .explain-pending 三阶段且不写内部术语', () => {
    const report = readSrc('pages/report.js');
    assert(report.includes('explain-pending'), '报告页没有使用等待气泡样式');
    assert(report.includes('pending-dots'), '报告页没有复用三颗点的动画');
    assert(report.includes('正在检索知识库'), '缺少第一阶段文案');
    assert(report.includes('模型思考中'), '缺少第二阶段文案');
    assert(report.includes('会自动改用离线模板回答'), '缺少第三阶段文案');
    assert(!/reason\.textContent = '正在/.test(report), '不该再用纯文字当等待反馈');

    // 用户能看到的字符串：text: '…' 与 xxx.textContent = '…'
    const literals = [
      ...[...report.matchAll(/\btext:\s*'([^']*)'/g)].map((m) => m[1]),
      ...[...report.matchAll(/\.textContent = '([^']*)'/g)].map((m) => m[1]),
    ].join(' ');
    assert(!/[A-Za-z]{4,}/.test(literals), `界面文案里混进了内部术语或后端 code：${literals}`);

    // 回退表与 pages/chat.js 的 LLM_FALLBACK_REASON 保持同一套 code（那个文件不能改）
    const chatKeys = mapKeys(readSrc('pages/chat.js'), 'LLM_FALLBACK_REASON');
    const reportKeys = mapKeys(report, 'EXPLAIN_FALLBACK');
    assert(chatKeys.length > 0, 'chat.js 的回退表结构变了，请同步报告页副本');
    const missing = chatKeys.filter((code) => !reportKeys.includes(code));
    assert(missing.length === 0, `报告页回退表缺少：${missing.join(', ')}`);
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
    const app = readSrc('app.js');
    assert(!app.includes("'/trend': renderTrend"), '趋势不应再是独立一页（已并入报告页）');
    assert(app.includes('redirectRoute'), 'app.js 的闸门没有走统一重定向');
    assert(app.includes('addSession('), 'app.js 未持久化 session');
    const report = readSrc('pages/report.js');
    assert(report.includes('radarMarkup'), '报告页未使用雷达');
    assert(report.includes('compareBlock'), '报告页没有挂「与上次相比」区块');
    assert(/不设总分|无总分/.test(report), '报告页应明确声明不设总分');
    assert(!/总分[:：]\s*\d/.test(report), '不应展示总分数值');
  });

  test('路由：#/trend 兼容重定向到 #/report', () => {
    assert(router.ROUTES.includes('/trend'), 'ROUTES 仍应认识旧路径 /trend');
    assert(router.ROUTES.includes('/report'), 'ROUTES 缺少 /report');
    assert(router.LEGACY_REDIRECTS['/trend'] === '/report', '/trend 应重定向到 /report');
    const legacy = router.parseHash('#/trend');
    assert(router.isKnown(legacy), '旧路径不该变成「未知路由」');
    assert(router.redirectRoute(legacy).full === '/report', 'redirectRoute 未落到 /report');
    const kept = router.redirectRoute(router.parseHash('#/chat'));
    assert(kept.full === '/chat', '非兼容路径应原样通过');

    const fake = fakeWindow('#/trend');
    withGlobals(fake, () => {
      const seen = [];
      const r = router.createRouter((route) => seen.push(route.full));
      r.start();
      assert(seen[0] === '/report', `初次分发应落 /report，实际 ${seen[0]}`);
      assert(
        fake.location.hash === '#/report',
        `地址栏应改写成 #/report，实际 ${fake.location.hash}`,
      );
      fake.location.hash = '#/chat';
      fake.fire('hashchange');
      assert(seen[seen.length - 1] === '/chat', '非兼容路由应正常分发');
      r.stop();
    });
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
