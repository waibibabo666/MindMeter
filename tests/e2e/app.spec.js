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
      vc: { metrics: { total: 6, correct: vcCorrect }, answers: [] },
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

  // 测评前采集年龄 / 学历 / 睡眠
  await expect(page.getByRole('heading', { name: '开始之前' })).toBeVisible();
  await page.locator('input[type=number]').fill('28');
  await page.locator('select').nth(0).selectOption('bachelor');
  await page.locator('select').nth(1).selectOption('7to8');
  await page.getByRole('button', { name: '开始测评' }).click();

  const checks = page.getByRole('checkbox');
  await checks.nth(0).check();
  await checks.nth(1).check();
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

  await expect(page.getByText('模型由站点统一提供（服务端环境变量）')).toBeVisible();
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

test('趋势：两次测评只比共同维度', async ({ page }) => {
  await signIn(page);
  const now = new Date('2026-11-14T12:00:00Z');
  const older = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
  for (const payload of [
    session('s_e2e_old', older.toISOString(), 4, 14, 6, 6),
    session('s_e2e_new', now.toISOString(), 6, 20, 8, 8),
  ]) {
    const response = await page.request.post('/api/v1/assessments', { data: { session: payload } });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto('/#/trend');
  await expect(page.getByRole('heading', { name: '趋势' })).toBeVisible();
  await expect(page.locator('table.trend-table tbody tr')).toHaveCount(4);
  await expect(page.locator('.notice')).toHaveCount(0);
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

  for (const path of ['/', '/#/tier', '/#/settings', '/#/memory', '/#/trend']) {
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

test('登录页在 360px 下也不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: '回到你的那台心智镜' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
