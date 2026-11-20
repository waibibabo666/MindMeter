#!/usr/bin/env node
/**
 * 文案精简与合规可见性门禁（人工测试反馈 2：「只留板块名与按钮名，解释改成悬浮浮框」）。
 *
 * 两类断言，缺一不可：
 *   1. 正向：说明性长句不许再常驻各页（每页 lead / disclaimer 有上限），
 *      同时解释必须真的被搬进 hint()/titled()，而不是被删掉；
 *   2. 反向：知情同意三句话、高风险与回退提示、等待动画、做题指令、
 *      「画像需要确认」这类合规与验收文案必须仍然常驻可见——
 *      防止后来的人为了"精简"把它们收进浮框甚至删掉（A1 / F-08 / A5 / A6）。
 *
 * 用法：node scripts/test_copy_discipline.js
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

function countHits(text, re) {
  return (text.match(re) || []).length;
}

/** 真正的悬浮解释入口：hint() 与 titled()（field-hint / seg-hint 这类小字不算）。 */
function tipCount(src) {
  return countHits(src, /(^|[^-\w])hint\(/g) + countHits(src, /(^|[^-\w])titled\(/g);
}

/**
 * 取出所有形参名：先把 `function f(a, b)` 与 `(a, b) =>` 的参数串抓出来，再 split。
 * 比"一个正则搞定"可读，也不会因为排除类 + 可选后随造成回溯爆炸。
 */
function paramNames(src) {
  const names = [];
  for (const match of src.matchAll(/function\s*\w*\(([^()]*)\)/g)) {
    names.push(...match[1].split(','));
  }
  for (const match of src.matchAll(/\(([^()]*)\)\s*=>/g)) {
    names.push(...match[1].split(','));
  }
  return names.map((name) => name.trim().split(/[=:,\s]/)[0]).filter(Boolean);
}

/** 取出 `const { a, b: c } = …` 里真正落地的绑定名（改名解构取别名）。 */
function destructuredNames(src) {
  const names = [];
  for (const match of src.matchAll(/(?:const|let|var)\s*\{([^{}]*)\}\s*=/g)) {
    for (const piece of match[1].split(',')) {
      const token = piece.trim();
      if (!token) continue;
      const [, alias] = token.split(':');
      names.push((alias || token).trim());
    }
  }
  return names;
}

/**
 * 每页允许常驻的「说明性长句」上限：lead = 页首口径句，disclaimer = 页尾边界句。
 * 这是上限而不是目标值：某页本来 0 条就是不许再加回来。
 */
const COPY_BUDGET = {
  'src/pages/home.js': { lead: 0, disclaimer: 0 },
  'src/pages/tier.js': { lead: 0, disclaimer: 0 },
  'src/pages/intake.js': { lead: 0, disclaimer: 0 },
  'src/pages/prep.js': { lead: 0, disclaimer: 0 },
  'src/pages/task.js': { lead: 0, disclaimer: 0 },
  'src/pages/report.js': { lead: 1, disclaimer: 0 },
  'src/pages/memory.js': { lead: 0, disclaimer: 1 },
  'src/pages/chat.js': { lead: 0, disclaimer: 1 },
  'src/pages/games.js': { lead: 0, disclaimer: 0 },
  'src/pages/game.js': { lead: 0, disclaimer: 0 },
  'src/pages/settings.js': { lead: 0, disclaimer: 0 },
  'src/pages/trend.js': { lead: 0, disclaimer: 0 },
  'src/pages/about.js': { lead: 1, disclaimer: 0 }, // 说明页是这些长句的落点
  'src/pages/auth.js': { lead: 1, disclaimer: 1 },
};

/** 需要「至少一处悬浮解释」的页面（about 是落点、auth/game 只有数据行，不在此列）。 */
const MUST_HAVE_TIPS = [
  'src/pages/home.js',
  'src/pages/tier.js',
  'src/pages/intake.js',
  'src/pages/prep.js',
  'src/pages/task.js',
  'src/pages/report.js',
  'src/pages/memory.js',
  'src/pages/chat.js',
  'src/pages/games.js',
  'src/pages/settings.js',
];

/** 知情同意三句话（F-08 验收项）：原文必须逐字常驻在 intake 上。 */
const CONSENT_LINES = [
  '数据只保存在你的账号下，可随时导出或清除，清除后不可恢复。',
  '本产品不是医疗器械，不提供诊断、治疗或医疗建议；报告不构成临床结论。',
  '不设总分、没有常模、不做百分位，不与人群比较；分数只描述你这次的任务表现。',
];

test('文案密度：说明性长句不再散落在各页', () => {
  let leadTotal = 0;
  let disclaimerTotal = 0;
  let tipTotal = 0;
  for (const [rel, budget] of Object.entries(COPY_BUDGET)) {
    const src = read(rel);
    const lead = countHits(src, /class:\s*'lead'/g);
    const disclaimer = countHits(src, /class:\s*'disclaimer'/g);
    assert(lead <= budget.lead, `${rel} 的 lead 长句 ${lead} 条，超过上限 ${budget.lead} 条`);
    assert(
      disclaimer <= budget.disclaimer,
      `${rel} 的 disclaimer 长句 ${disclaimer} 条，超过上限 ${budget.disclaimer} 条`,
    );
    leadTotal += lead;
    disclaimerTotal += disclaimer;
    tipTotal += tipCount(src);
  }
  assert(leadTotal <= 4, `全站常驻 lead 长句 ${leadTotal} 条，说明文字又长回来了`);
  assert(disclaimerTotal <= 3, `全站常驻 disclaimer 长句 ${disclaimerTotal} 条`);
  assert(tipTotal >= 20, `全站只有 ${tipTotal} 处悬浮解释：解释被删掉了，而不是搬进了浮框`);

  // 逐页确认「这一页确实有悬浮解释」，防止有人只删文字不搬解释。
  for (const rel of MUST_HAVE_TIPS) {
    assert(tipCount(read(rel)) >= 1, `${rel} 没有任何悬浮解释：说明该搬进 hint()/titled()，不是删`);
  }
});

test('合规红线 A1/F-08：知情同意三句话与两个必勾项主动可见', () => {
  const src = read('src/pages/intake.js');
  for (const line of CONSENT_LINES) {
    assert(src.includes(`'${line}'`), `知情同意少了这一句：${line}`);
  }
  // 必须是常驻段落，不能靠 hover 才看到。
  assert(/class:\s*'consent'/.test(src), '知情同意板块（.consent）不见了');
  assert(
    /CONSENT_LINES\.map\(\(text\) => el\('p', \{ text \}\)\)/.test(src),
    '知情同意不再是「每条一个段落」的常驻文案',
  );
  assert(!/hint\([^)]*CONSENT/.test(src), '知情同意被收进了悬浮解释');
  assert(!/hint\('[^']*医疗器械/.test(src), '医疗边界声明被收进了悬浮解释');
  assert(src.includes("check('age', '我已满 18 岁')"), '缺少「我已满 18 岁」必勾项');
  assert(src.includes('我理解以上边界，并同意在我的账号下保存这些数据'), '缺少数据同意必勾项');
  // 校验与错误反馈同样必须常驻。
  assert(/请填写 10–100 之间的年龄/.test(src), '年龄校验反馈丢了');
  assert(/请选择最高学历/.test(src), '学历校验反馈丢了');
  assert(/请先勾选下面两项确认/.test(src), '同意项校验反馈丢了');
});

test('合规红线：高风险提示、回退原因、等待动画、做题指令不靠悬浮', () => {
  const chat = read('src/pages/chat.js');
  assert(/class:\s*'notice'/.test(chat), '对话页的高风险提示样式（.notice）不见了');
  assert(chat.includes('高风险提示：请优先参考医生'), '高风险提示文案丢了');
  assert(/role:\s*'status'/.test(chat), '高风险提示不再是 live region');
  assert(!/hint\([^)]*风险/.test(chat), '风险提示被收进了悬浮解释');
  assert(chat.includes('离线回答（已改用模板）'), '回退原因不常驻了');
  assert(chat.includes('站点服务不可用，消息没有发送'), '发送失败提示丢了');
  assert(chat.includes('chat-pending') && chat.includes('正在检索知识库'), 'A6 等待动画被改坏');
  assert(chat.includes('中风险提示'), '中风险提示丢了');
  // 隐私与「问题会发给模型服务」的告知不能只活在浮框里
  assert(chat.includes('不要把手机号'), '敏感信息提醒丢了');
  assert(!/hint\([^)]*敏感信息/.test(chat), '敏感信息提醒被收进了悬浮解释');

  const report = read('src/pages/report.js');
  assert(report.includes('explain-pending'), 'A6 解读等待动画被改坏');
  assert(report.includes('会自动改用离线模板回答'), '解读等待第三阶段文案丢了');
  assert(report.includes('已改用离线模板'), '解读回退原因不常驻了');
  assert(report.includes('解读这次没有生成成功'), '解读失败提示丢了');
  assert(/不设总分|无总分/.test(report), '报告页少了「不设总分」的常驻声明');

  const task = read('src/pages/task.js');
  assert(task.includes('这一项打不开'), '任务页兜底标题丢了');
  assert(task.includes('已保存的进度可能已损坏'), '任务页兜底说明丢了');

  // 做题指令属于「用户必须知道怎么作答」，任务与游戏模块一律不许用悬浮解释。
  for (const dir of ['tasks', 'games']) {
    const base = path.join(APP_DIR, 'src', dir);
    for (const entry of fs.readdirSync(base)) {
      if (!entry.endsWith('.js')) continue;
      const src = fs.readFileSync(path.join(base, entry), 'utf8');
      assert(!/(^|[^-\w])hint\(/.test(src), `src/${dir}/${entry} 把做题指令收进了悬浮解释`);
    }
  }
});

test('合规红线：记忆与设置里影响决策的句子仍在页面上', () => {
  const memory = read('src/pages/memory.js');
  assert(memory.includes('画像需要确认'), '画像待确认状态从页面上消失了');
  assert(!/hint\([^)]*需要确认/.test(memory), '「需要确认」被收进了悬浮解释');
  assert(memory.includes('保留最近'), '对话保留条数消失了');

  const settings = read('src/pages/settings.js');
  assert(settings.includes('删除后不可恢复'), '注销账号的不可恢复提醒消失了');
  assert(settings.includes('保留账号本身'), '清除数据与注销账号的区别说明消失了');
  assert(countHits(settings, /class:\s*'plain-list'/g) >= 1, '「风险与限制」整节被删掉了');

  const game = read('src/pages/game.js');
  assert(game.includes('不计入测评报告'), '游戏成绩不进报告的口径消失了');
});

test('悬浮解释的可访问性：键盘可达 + aria/title 三重兜底', () => {
  const ui = read('src/ui.js');
  for (const piece of ["tabindex: '0'", "role: 'note'", "'data-tip'", "'aria-label'", 'title:']) {
    assert(ui.includes(piece), `ui.js 的 hint() 少了 ${piece}`);
  }
  const css = read('src/styles/app.css');
  assert(/\.hint:hover::after/.test(css), '浮框缺少悬浮显示');
  assert(/\.hint:focus-visible::after/.test(css), '浮框缺少键盘聚焦显示');
  assert(/\.hint\.edge-left/.test(css), '浮框缺少靠右边缘的防溢出样式');

  // 页面里不许出现名叫 hint 的局部绑定：它会遮蔽 ui.js 的 hint()
  // （真实踩过：trend.js 的 `const { hint } = model` 让浮框调用直接抛 TypeError）。
  for (const rel of Object.keys(COPY_BUDGET)) {
    const src = read(rel);
    assert(!paramNames(src).includes('hint'), `${rel} 有形参叫 hint，会遮蔽 ui.js 的 hint()`);
    assert(
      !destructuredNames(src).includes('hint'),
      `${rel} 解构出了名为 hint 的变量，会遮蔽 ui.js 的 hint()`,
    );
    assert(
      !/(?:const|let|var)\s+hint\s*=/.test(src),
      `${rel} 声明了名为 hint 的变量，会遮蔽 ui.js 的 hint()`,
    );
  }
});

test('内容文字不许用最低对比度的装饰色（课程测试表 A9）', () => {
  const css = read('src/styles/app.css');
  for (const selector of ['.tiny', '.disclaimer', '.sidefoot', '.dim-badge']) {
    const block = new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css);
    assert(block, `样式里找不到 ${selector} 规则`);
    assert(
      !/color:\s*var\(--dim\)/.test(block[1]),
      `${selector} 还在用 --dim（≈2.9:1），小字正文达不到 A9 对比度`,
    );
  }
});

/**
 * 人工测试反馈 3 第 3 条：「界面中有很多冗杂信息」——逐字重复、同义反复的文案
 * 是无效信息。这一节把已经处理掉的几处钉成门禁，防止后来的人又加回来。
 * 注意：它只禁止"重复"，不禁止"合规文案"（上面几条红线优先）。
 */
test('冗杂信息门禁：同一句话不在同一屏重复（反馈 3）', () => {
  const tier = read('src/pages/tier.js');
  assert(!/DIMS\.find\([^)]*\)\.name/.test(tier), 'tier.js 又在档位卡上拼完整维度名');
  assert(!/\.join\(' · '\)/.test(tier), 'tier.js 又把维度名串成一行常驻在卡片里');
  assert(/from '\.\.\/scoring\/levels\.js'/.test(tier), '档位差异数字应来自 scoring/levels.js');
  assert(/specFor\(/.test(tier), 'tier.js 应该用 specFor() 读 LEVEL_SPEC，不要手写常量');
  const said = countHits(tier, /同样的 8 个维度/g);
  assert(said <= 1, `「三档测同样的 8 个维度」在 tier.js 里出现 ${said} 次，只许说一次`);

  const chat = read('src/pages/chat.js');
  assert(!/hintText:\s*'Enter 发送/.test(chat), '空态又复述了一遍 placeholder 里的按键说明');
  assert(chat.includes('清空对话'), '对话页少了「清空对话」入口（反馈 3 第 1 条）');
  assert(/只删对话/.test(chat), '清空对话的确认文案没有说清删除范围');
  assert(/clearConversation/.test(chat), '清空对话必须走 memory.js 的定向删除');

  const games = read('src/pages/games.js');
  assert(!/text: '未玩过'/.test(games), '游戏卡又给每张都贴同一枚「未玩过」徽章');

  const report = read('src/pages/report.js');
  assert(/untestedFold/.test(report), '八维表的未测占位行又回来了（应合并成一行折叠）');

  const settings = read('src/pages/settings.js');
  assert(
    !/placeholder: '当前密码'/.test(settings),
    '字段标签已写「当前密码」，placeholder 不该重复',
  );

  const game = read('src/pages/game.js');
  assert(
    !/card-title' \}, \[item\.title/.test(game),
    '游戏页 h1 已经是游戏名，卡片标题不该再写一遍',
  );

  const css = read('src/styles/app.css');
  assert(/--fs-body/.test(css), '字号刻度变量（--fs-*）被删掉了');
  assert(/font-size:\s*var\(--fs-body\)/.test(css), 'body 应当使用 --fs-body');
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(`       ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed}/${tests.length} copy discipline checks passed`);
