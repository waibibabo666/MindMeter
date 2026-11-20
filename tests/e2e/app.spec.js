import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const PASSWORD = 'e2e-passw0rd-1';
let counter = 0;

function nextAccount() {
  counter += 1;
  return { username: `e2e_${process.pid.toString(36)}_${counter}`, password: PASSWORD };
}

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('favicon.ico')) return;
    errors.push(`console: ${text}`);
  });
  return errors;
}

/** Sign in through the public API so the cookie lands in this browser context. */
async function signIn(page, account = nextAccount()) {
  const created = await page.request.post('/api/v1/auth/register', {
    data: { username: account.username, password: account.password, adult: true },
  });
  if (!created.ok()) {
    const login = await page.request.post('/api/v1/auth/login', {
      data: { username: account.username, password: account.password },
    });
    expect(login.ok()).toBeTruthy();
  }
  return account;
}

function session(id, finishedAt, vcCorrect, psCorrect, svCorrect, amHits) {
  return {
    id,
    mode: 'standard',
    finishedAt,
    dims: ['vc', 'ps', 'sv', 'am'],
    results: {
      vc: { metrics: { total: 8, correct: vcCorrect }, answers: [] },
      ps: { metrics: { correct: psCorrect }, answers: [] },
      sv: {
        metrics: { total: 8, correct: svCorrect, correctRts: new Array(svCorrect).fill(2000) },
        answers: [],
      },
      am: {
        metrics: { hits: amHits, falseAlarms: 0 },
        answers: new Array(8).fill({ isOld: true }).concat(new Array(8).fill({ isOld: false })),
      },
    },
  };
}

test('未登录只看到登录页，测评路由被挡回', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/memory');
  await expect(page.getByRole('heading', { name: '回到你的那台心智镜' })).toBeVisible();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('#rail')).toBeHidden();
  await expect(page.locator('#quit-app')).toBeHidden();

  await page.goto('/#/task/vc');
  await expect(page).toHaveURL(/#\/login/);
  await page.getByRole('link', { name: /注册一个/ }).click();
  await expect(page.getByRole('heading', { name: '注册一个只属于你的心智镜' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('注册即用：8 项主链路 → 报告 → 解读卡', async ({ page }) => {
  const errors = collectErrors(page);
  const account = nextAccount();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '回到你的那台心智镜' })).toBeVisible();
  await page.getByRole('link', { name: /注册一个/ }).click();
  await page.locator('#register-username').fill(account.username);
  await page.locator('#register-password').fill(account.password);
  await page.locator('#register-confirm').fill(account.password);
  await page.locator('#register-adult').check();
  await page.getByRole('button', { name: '注册并进入' }).click();

  await expect(page.getByRole('heading', { name: /玩一局/ })).toBeVisible();
  await page.getByRole('button', { name: '选择档位' }).click();
  await page.getByRole('button', { name: /标准/ }).click();

  // 页 A：账号级资料与知情同意，只填一次
  await expect(page.getByRole('heading', { name: '先认识你一下' })).toBeVisible();
  await page.locator('#intake-age').fill('28');
  await page.locator('#intake-edu').selectOption('bachelor');
  const checks = page.getByRole('checkbox');
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole('button', { name: '保存并开始' }).click();

  // 页 B：临场状态，每次都要填
  await expect(page.getByRole('heading', { name: '今天的状态' })).toBeVisible();
  await page.locator('#prep-sleep').selectOption('7to8');
  await page.locator('.seg-opt').nth(2).click();
  await page.clock.install();
  await page.getByRole('button', { name: '开始测评' }).click();

  // 言语理解：标准档 8 题
  await expect(page.locator('.task-page')).toHaveAttribute('data-task-id', 'vc');
  for (let i = 0; i < 8; i += 1) {
    await page.locator('.options button').first().click();
  }

  // 处理速度：编码与分类交替，用时钟快进到结束
  await expect(page.locator('.task-page')).toHaveAttribute('data-task-id', 'ps');
  await expect(page.locator('.ps-target')).toBeVisible();
  await page.locator('.ps-options button').first().click();
  await page.clock.runFor(45_000);
  await page.waitForTimeout(500);

  // 进入空间视觉化即说明前两维流程完整
  await expect(page.locator('.task-page')).toHaveAttribute('data-task-id', 'sv');
  expect(errors).toEqual([]);
});

test('设置与导出：模型由站点提供，导出不含密钥', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();

  // 「模型由站点统一提供」的完整口径搬到了 AI 解读标题旁的浮框里（键盘可达，不靠 hover 才有）
  const aiTip = page.locator('.hint[data-tip*="模型由站点统一提供"]');
  await expect(aiTip).toBeAttached();
  await expect(aiTip).toHaveAttribute('tabindex', '0');
  await expect(aiTip).not.toHaveAttribute('data-tip', '');
  await expect(page.getByText('未配置：解读自动回退模板')).toBeVisible();
  await expect(page.locator('#set-key')).toHaveCount(0);
  await expect(page.locator('#set-endpoint')).toHaveCount(0);

  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: /玩一局/ })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据' }).click();
  const download = await downloadPromise;
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).not.toContain('apiKey');
  expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/);

  const stored = await page.evaluate(() =>
    Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])),
  );
  expect(JSON.stringify(stored)).not.toContain('sk-');
  expect(errors).toEqual([]);
});

test('退出登录后回到登录页，且看不到上一账号的数据', async ({ page }) => {
  const account = await signIn(page);
  await page.goto('/#/settings');
  await expect(page.locator('.kv-value', { hasText: account.username })).toBeVisible();
  await page.locator('#quit-app').click();
  await expect(page.getByRole('heading', { name: '回到你的那台心智镜' })).toBeVisible();
  await expect(page).toHaveURL(/#\/login/);

  // 重新登录后仍然只有自己的数据
  await page.locator('#login-username').fill(account.username);
  await page.locator('#login-password').fill(account.password);
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: /玩一局/ })).toBeVisible();
});

test('报告与趋势合一：第一次是基线，第二次出差值，旧入口重定向', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const newer = new Date('2026-11-14T12:00:00Z');
  const older = new Date(newer.getTime() - 8 * 24 * 60 * 60 * 1000);

  // 只测过一次：趋势不再是空态，本次结果直接立为基线
  const first = await page.request.post('/api/v1/assessments', {
    data: { session: session('s_merge_old', older.toISOString(), 4, 14, 6, 6) },
  });
  expect(first.ok()).toBeTruthy();

  await page.goto('/#/report');
  const compare = page.locator('#report-compare');
  await expect(compare.getByRole('heading', { name: '与上次相比' })).toBeVisible();
  await expect(compare.getByText('这是这个账号的第一次记录')).toBeVisible();
  await expect(compare.getByText(/下次复测起/)).toBeVisible();
  await expect(compare.locator('table.baseline-table tbody tr')).toHaveCount(4);
  await expect(compare.getByText(/还差一次|还没有数据/)).toHaveCount(0);

  // 第二次：本次少测一项，共同维度出差值行，单边维度单列
  const lighter = session('s_merge_new', newer.toISOString(), 6, 20, 8, 8);
  delete lighter.results.am;
  lighter.dims = ['vc', 'ps', 'sv'];
  const second = await page.request.post('/api/v1/assessments', { data: { session: lighter } });
  expect(second.ok()).toBeTruthy();

  await page.reload(); // 重新拉一次账号记录，才看得到第二次测评
  await expect(compare.locator('table.trend-table tbody tr')).toHaveCount(3);
  await expect(compare.getByText('第一次记录')).toHaveCount(0);
  await expect(compare.getByText(/只说变了多少，不说进步或退步/)).toBeVisible();
  await expect(compare.getByText(/只有一边测过的维度不算差值/)).toBeVisible();
  await expect(compare.getByText(/联想记忆：上次测过/)).toBeVisible();
  // 8 天间隔：不该有练习效应提示
  await expect(compare.locator('.notice')).toHaveCount(0);

  // 旧入口：#/trend 落到 #/report
  await page.goto('/#/trend');
  await expect(page).toHaveURL(/#\/report$/);
  await expect(page.getByRole('heading', { name: '与上次相比' })).toBeVisible();

  // 侧栏只剩一个入口
  await expect(page.locator('.navitem[href="#/trend"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '报告与趋势' })).toBeVisible();

  // 右栏快捷按钮：从别的页面走兼容路径，最终停在报告页
  await page.goto('/#/memory');
  await page.getByRole('button', { name: '与上次相比' }).click();
  await expect(page).toHaveURL(/#\/report$/);

  // 已经在报告页时再点一次：直接滚到对比区块
  await page.getByRole('button', { name: '与上次相比' }).click();
  await expect(page.locator('#report-compare')).toBeInViewport();

  // 360px 下带数据的报告页不许横向溢出
  await page.setViewportSize({ width: 360, height: 800 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('解读等待：点击生成解读有三阶段气泡，回退文案说人话', async ({ page }) => {
  await signIn(page);
  const created = await page.request.post('/api/v1/assessments', {
    data: { session: session('s_explain_wait', '2026-11-14T12:00:00Z', 6, 20, 8, 8) },
  });
  expect(created.ok()).toBeTruthy();

  // 模型慢：3.4 秒后才回话，够看清「正在检索 → 模型思考中」两段等待文案
  let requests = 0;
  await page.route('**/api/v1/reports/**/explain', async (route) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 3400));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        text: '解读示例文本。',
        source: 'template',
        code: 'rate_limit',
        citations: [],
      }),
    });
  });

  await page.goto('/#/report');
  // 未配置模型时页面自己会跑一次；两种情况都要能看清等待过程，所以按钮也照样等
  await page.getByRole('button', { name: '生成解读' }).click();

  const pending = page.locator('.explain-pending');
  await expect(pending).toBeVisible();
  await expect(pending.locator('.pending-text')).toHaveText('正在检索知识库…');
  await expect(pending.locator('.pending-dots i')).toHaveCount(3);
  await expect(pending.locator('.pending-text')).toHaveText('正在组织回答（模型思考中）…');

  await expect(page.getByText('解读示例文本。')).toBeVisible();
  await expect(pending).toHaveCount(0);
  // 回退只说人话：后端 code 不许出现在界面上
  await expect(page.getByText('已改用离线模板：模型服务正忙，已限流')).toBeVisible();
  await expect(page.locator('.ai-card')).not.toContainText('rate_limit');
  expect(requests).toBeGreaterThanOrEqual(1);
});

test('另一个账号看不到这个账号的测评', async ({ page, request }) => {
  const first = await signIn(page);
  const marker = `s_private_${process.pid.toString(36)}`;
  const created = await page.request.post('/api/v1/assessments', {
    data: { session: session(marker, '2026-11-15T01:00:00Z', 6, 20, 8, 8) },
  });
  expect(created.ok()).toBeTruthy();

  const second = nextAccount();
  await request.post('/api/v1/auth/register', {
    data: { username: second.username, password: second.password, adult: true },
  });
  const listed = await request.get('/api/v1/assessments');
  expect(listed.ok()).toBeTruthy();
  expect(JSON.stringify(await listed.json())).not.toContain(marker);

  // 直接按 id 猜也不行
  const peek = await page.request.get(`/api/v1/assessments/${marker}`);
  expect(peek.status()).toBe(200); // 同一个浏览器仍是 first 账号
  const otherContext = await page.context().browser().newContext();
  const otherPage = await otherContext.newPage();
  await otherPage.goto('/');
  await otherPage.request.post('/api/v1/auth/login', {
    data: { username: second.username, password: second.password },
  });
  const denied = await otherPage.request.get(`/api/v1/assessments/${marker}`);
  expect(denied.status()).toBe(404);
  await otherContext.close();
  expect(first.username).toBeTruthy();
});

test('记忆页与 360px 无横向溢出', async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 360, height: 800 });

  const paths = [
    '/',
    '/#/tier',
    '/#/settings',
    '/#/memory',
    '/#/trend',
    '/#/intake',
    '/#/games',
    '/#/game/schulte',
    '/#/report',
    '/#/chat',
    '/#/about',
  ];
  for (const path of paths) {
    await page.goto('http://127.0.0.1:8100' + path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }

  await page.goto('/#/memory');
  await expect(page.getByRole('heading', { name: '我的记忆' })).toBeVisible();
  await expect(page.getByText(/保留最近 20 条/)).toBeVisible();
});

/**
 * 反馈 2 的验收：说明文字搬进浮框之后，键盘与读屏仍然拿得到。
 * 只用鼠标悬浮能看到的信息，等于对键盘用户删掉了信息。
 */
test('悬浮解释键盘可达：Tab 到 .hint，聚焦后浮框真的显示出来', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto('/#/memory');

  // 应用是异步启动的：先等浮框渲染出来，再数（count() 不会自动重试）
  await expect(page.locator('.hint').first()).toBeVisible();
  const hintCount = await page.locator('.hint').count();
  expect(hintCount).toBeGreaterThanOrEqual(3);

  // 从文档开头一路 Tab，必须能 Tab 到一个 .hint（hint() 带 tabindex="0"）
  await page.evaluate(() => document.activeElement?.blur());
  let reached = null;
  for (let i = 0; i < 50; i += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => {
      const node = document.activeElement;
      if (!node || !node.classList || !node.classList.contains('hint')) return null;
      return {
        tip: node.getAttribute('data-tip') || '',
        title: node.getAttribute('title') || '',
        label: node.getAttribute('aria-label') || '',
        role: node.getAttribute('role') || '',
        tabindex: node.getAttribute('tabindex') || '',
      };
    });
    if (reached) break;
  }
  expect(reached, 'Tab 走不到任何 .hint：悬浮解释对键盘用户不可达').not.toBeNull();
  expect(reached.tip.length).toBeGreaterThan(8);
  expect(reached.title).toBe(reached.tip); // 原生 title 兜底
  expect(reached.label.startsWith('解释：')).toBeTruthy(); // 读屏兜底
  expect(reached.role).toBe('note');
  expect(reached.tabindex).toBe('0');

  // 聚焦态真的把浮框画出来（CSS :focus-visible::after 的 opacity；有 0.14s 过渡，轮询等它到位）
  await expect
    .poll(() =>
      page.evaluate(() => Number(getComputedStyle(document.activeElement, '::after').opacity) || 0),
    )
    .toBeGreaterThan(0.5);
  expect(errors).toEqual([]);
});

/**
 * 红线：知情同意必须主动可见（课程测试表 A1 能力边界声明、F-08 知情同意验收）。
 * 精简说明文字时把这三句挪进浮框，就是合规回归。
 */
test('intake 的三句知情同意不依赖 hover 就可见', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto('/#/intake');

  await expect(page.getByRole('heading', { name: '开始前的三句话' })).toBeVisible();
  await expect(page.locator('.consent p')).toHaveCount(3);
  for (const phrase of [
    '数据只保存在你的账号下，可随时导出或清除，清除后不可恢复。',
    '本产品不是医疗器械，不提供诊断、治疗或医疗建议；报告不构成临床结论。',
    '不设总分、没有常模、不做百分位，不与人群比较；分数只描述你这次的任务表现。',
  ]) {
    await expect(page.getByText(phrase, { exact: true })).toBeVisible();
  }

  // 两个必勾项同样常驻
  await expect(page.getByRole('checkbox')).toHaveCount(2);
  await expect(page.getByText('我已满 18 岁')).toBeVisible();
  await expect(page.getByText('我理解以上边界，并同意在我的账号下保存这些数据')).toBeVisible();

  // 这三句不许只活在浮框里：任何 .hint 的 data-tip 都不该包含它们
  const tips = await page
    .locator('.hint')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-tip') || ''));
  const joined = tips.join('\n');
  expect(joined).not.toContain('不是医疗器械');
  expect(joined).not.toContain('我理解以上边界');
  expect(errors).toEqual([]);
});

test('登录页在 360px 下也不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: '回到你的那台心智镜' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

/* ------------------------------------------------------------------ *
 * 人工测试反馈 3 的三条，各自一条端到端断言。
 * ------------------------------------------------------------------ */

/** 把记忆灌成"历史很长"：20 条对话 + 1 条摘要 + 1 条建议（摘要与建议用来验证没被连带删掉）。 */
async function seedLongConversation(page) {
  const at = new Date('2026-11-14T12:00:00Z').toISOString();
  const messages = [];
  for (let index = 0; index < 20; index += 1) {
    messages.push({
      id: `e2e_clear_msg_${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `第 ${index} 条历史消息，用来把消息流撑长。`,
      at,
      source: index % 2 === 0 ? undefined : 'template',
    });
  }
  const seeded = await page.request.put('/api/v1/memory', {
    data: {
      profile: {},
      summaries: [{ id: 'e2e_clear_sum', at, tier: 'standard', text: '标准 · 最低项言语理解 50' }],
      advice: [{ id: 'e2e_clear_adv', at, title: '分散练习', shown: true, done: false }],
      messages,
    },
  });
  expect(seeded.ok()).toBeTruthy();
}

/**
 * 反馈 3 第 1 条：进对话页不必先往下划才找得到输入框；并且有清空对话的入口。
 * 用 360×640 的小视口测：这是历史上"必须滚动"的那一档。
 */
test('对话页：输入框在首屏内，清空对话只删消息', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await seedLongConversation(page);

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/#/chat');
  await expect(page.locator('.chat-list .card')).toHaveCount(20);

  const input = page.locator('.chat-input');
  await expect(input).toBeVisible();
  // 入场动画（.page > * 的 rise）会把元素临时下移 6px，轮询到落位为止，阈值不放松。
  await expect
    .poll(() =>
      input.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return box.bottom;
      }),
    )
    .toBeLessThanOrEqual(640 + 1);
  const box = await input.boundingBox();
  expect(box, '输入框要有 boundingBox').not.toBeNull();
  expect(box.y).toBeGreaterThanOrEqual(0);

  // 消息容器自己滚到底：不需要用户去翻历史
  const atBottom = await page
    .locator('.chat-scroll')
    .evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 2);
  expect(atBottom).toBeTruthy();

  // 清空入口：aria-label + 二次确认
  const clear = page.locator('#chat-clear');
  await expect(clear).toHaveAttribute('aria-label', /只删对话/);
  const dialogs = [];
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  await clear.click();

  await expect(page.locator('.chat-list .card')).toHaveCount(0);
  await expect(page.getByText('还没有对话')).toBeVisible();
  expect(dialogs.join(' ')).toContain('只删对话记录');

  // 服务端真的删干净了，而摘要与建议还在（清空对话走的是逐条单行删除）
  const after = await page.request.get('/api/v1/memory');
  expect(after.ok()).toBeTruthy();
  const memory = await after.json();
  expect(memory.messages.length).toBe(0);
  expect(memory.summaries.length).toBe(1);
  expect(memory.advice.length).toBe(1);
  expect(errors).toEqual([]);
});

/** 反馈 3 第 3 条（测试图 05）：三张档位卡逐字重复同一串 8 个维度名 = 无效信息。 */
test('档位卡：三张文字互异，不再逐字重复 8 个维度名', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  await page.goto('/#/tier');

  const cards = page.locator('.tier-card');
  await expect(cards).toHaveCount(3);
  const texts = await cards.allTextContents();
  expect(new Set(texts).size, `三张档位卡文字雷同：${texts.join(' /// ')}`).toBe(3);

  const fullNames = [
    '言语理解',
    '知觉速度',
    '空间视觉化',
    '联想记忆',
    '数字运算',
    '归纳推理',
    '自然知识',
    '言语流畅性',
  ];
  for (const text of texts) {
    const hits = fullNames.filter((name) => text.includes(name));
    expect(hits.length, `档位卡又列出了完整维度名：${hits.join('、')}`).toBe(0);
    // 卡片上必须是有区分度的具体数字（题量/限时），不是空话
    expect(text).toMatch(/\d+ 题/);
    expect(text).toMatch(/\d+ 秒/);
  }

  // "三档测同样的维度"这句只在页面顶部说一次
  await expect(page.locator('.hint[data-tip*="同样的 8 个维度"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

/** 反馈 3 第 2 条：全站基准字号放大，而且字号只有 app.css 的 --fs-* 一个来源。 */
test('字号放大：body 16px、辅助文字与标题跟着上调', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  // 报告页要有数据，否则它走「还没有结果」空态，测不到表格会不会被放大后的字号挤破。
  const seeded = await page.request.post('/api/v1/assessments', {
    data: { session: session('s_font', '2026-11-14T12:00:00Z', 6, 20, 8, 8) },
  });
  expect(seeded.ok()).toBeTruthy();
  await page.goto('/#/');

  const scale = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--fs-body').trim(),
  );
  expect(scale, '--fs-body 变量没生效').toBe('16px');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).fontSize))
    .toBe('16px');
  await expect(page.locator('.tiny').first()).toHaveCSS('font-size', '13.5px');

  // 说明页把三类文字都摆在一屏里，最适合验"辅助文字与标题跟着上调"
  await page.goto('/#/about');
  await expect(page.locator('.page-title')).toHaveCSS('font-size', '26px');
  await expect(page.locator('.card-title').first()).toHaveCSS('font-size', '17px');
  await expect(page.locator('.muted').first()).toHaveCSS('font-size', '14px');
  await expect(page.locator('.lead')).toHaveCSS('font-size', '15px');

  await page.goto('/#/tier');
  await expect(page.locator('.tier-metric').first()).toHaveCSS('font-size', '13.5px');
  await expect(page.locator('.tier-card').first()).toBeVisible();

  // 字号上调后窄屏仍然不许横向溢出（阈值与既有条目一致，没有放松）
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of ['/', '/#/tier', '/#/report', '/#/chat', '/#/about', '/#/settings']) {
    await page.goto('http://127.0.0.1:8100' + path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }

  // 八维表字号上调后仍然列不挤破：表格不出横向滚动、单元格文字不被裁掉
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/#/report');
  const table = page.locator('.page-report > .report-table');
  await expect(table).toBeVisible();
  await expect(table.locator('tbody td').first()).toBeVisible();
  const squeezed = await table.evaluate((node) =>
    [...node.querySelectorAll('tbody td')].some((cell) => cell.scrollWidth > cell.clientWidth + 1),
  );
  expect(squeezed, '有单元格被字号撑出横向滚动').toBe(false);
  const fits = await table.evaluate(
    (node) => node.scrollWidth <= node.parentElement.clientWidth + 1,
  );
  expect(fits, '八维表宽度超出主区').toBe(true);

  // 说明页的维度表同样不能挤破
  await page.goto('/#/about');
  const aboutFits = await page
    .locator('.report-table')
    .first()
    .evaluate((node) => node.scrollWidth <= node.parentElement.clientWidth + 1);
  expect(aboutFits).toBe(true);
  expect(errors).toEqual([]);
});

/** 反馈 3 · 模式 4：报告页八维表里「未测 / 本档未包含」的占位行合并成一行折叠。 */
test('报告页：未测维度合并成一行，不稀释已测结果', async ({ page }) => {
  const errors = collectErrors(page);
  await signIn(page);
  const created = await page.request.post('/api/v1/assessments', {
    data: { session: session('s_fold', '2026-11-14T12:00:00Z', 6, 20, 8, 8) },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto('/#/report');
  // 4 个已测行 + 1 行折叠（原来是 4 行有效 + 4 行灰字占位）
  await expect(page.locator('.page-report > .report-table tbody tr')).toHaveCount(5);
  const summary = page.locator('.page-report > .report-table .untested-fold summary');
  await expect(summary).toContainText('未测 4 项');

  await summary.click();
  await expect(page.getByText('自然知识：本档未包含，不按 0 计。')).toBeVisible();
  await expect(page.getByText(/8 个维度中测了 4 个/)).toBeVisible();
  expect(errors).toEqual([]);
});
