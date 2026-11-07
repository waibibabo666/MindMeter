import fs from 'node:fs';
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:8000';

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

test('本地主链路：4 项 → 报告 → 模板解读', async ({ page }) => {
  await page.clock.install();
  const errors = collectErrors(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /玩一局/ })).toBeVisible();
  await page.getByRole('button', { name: '选择档位' }).click();
  await page.getByRole('button', { name: /标准/ }).click();

  const checks = page.getByRole('checkbox');
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole('button', { name: '开始测评' }).click();

  // 言语理解：6 题
  await expect(page.locator('.task-page')).toHaveAttribute('data-task-id', 'vc');
  for (let i = 0; i < 6; i += 1) {
    await page.locator('.options button').first().click();
  }

  // 知觉速度：45 秒计时，用 Playwright clock 快进
  await expect(page.locator('.task-page')).toHaveAttribute('data-task-id', 'ps');
  await expect(page.locator('.ps-target')).toBeVisible();
  await page.clock.runFor(45_000);

  // 空间视觉化：8 题
  await expect(page.locator('.task-page')).toHaveAttribute('data-task-id', 'sv');
  for (let i = 0; i < 8; i += 1) {
    await page.locator('.options button').first().click();
  }

  // 联想记忆：点“我记住了”跳过学习计时，再做 16 题
  await expect(page.locator('.task-page')).toHaveAttribute('data-task-id', 'am');
  await page.getByRole('button', { name: '我记住了，开始再认' }).click();
  for (let i = 0; i < 16; i += 1) {
    await page.getByRole('button', { name: '见过（1）' }).click();
  }

  await expect(page.getByRole('heading', { name: '本次测评' })).toBeVisible();
  await expect(page.locator('table.report-table tbody tr')).toHaveCount(8);
  await expect(page.locator('table.report-table tbody tr.untested')).toHaveCount(4);

  await page.getByRole('button', { name: '生成解读' }).click();
  await expect(page.locator('.pill')).toHaveText('模板');
  expect(errors).toEqual([]);
});

test('设置与导出：Key 不进入导出 JSON', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();

  await page.locator('#set-endpoint').fill('https://example.invalid/v1');
  await page.locator('#set-model').fill('e2e-model');
  await page.locator('#set-key').fill('sk-e2e-secret');
  await page.locator('#set-enabled').check();
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByText('已配置：可以使用 AI 解读')).toBeVisible();

  await page.goto('/#/');
  await expect(page.getByRole('heading', { name: /玩一局/ })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据' }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const text = fs.readFileSync(file, 'utf8');

  expect(text).not.toContain('sk-e2e-secret');
  expect(text).toContain('e2e-model');
  expect(errors).toEqual([]);
});

test('趋势：两次测评只比共同维度', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      'mindmeter.sessions.v1',
      JSON.stringify({
        schemaVersion: 1,
        sessions: [
          {
            id: 's2',
            finishedAt: new Date(now).toISOString(),
            scores: { vc: 70, ps: 55, sv: 72, am: 45 },
          },
          {
            id: 's1',
            finishedAt: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
            scores: { vc: 60, ps: 50, sv: 70, am: 40 },
          },
        ],
      }),
    );
  });

  await page.goto('/#/trend');
  await expect(page.getByRole('heading', { name: '趋势' })).toBeVisible();
  await expect(page.locator('table.trend-table tbody tr')).toHaveCount(4);
  await expect(page.getByText('+10', { exact: true })).toBeVisible();
  await expect(page.locator('.notice')).toHaveCount(0);
});

test('记忆页与 360px 无横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });

  for (const path of ['/', '/#/tier', '/#/settings', '/#/memory', '/#/trend']) {
    await page.goto(BASE + path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
  }

  await page.goto('/#/memory');
  await expect(page.getByRole('heading', { name: '我的记忆' })).toBeVisible();
  await expect(page.getByText(/保留最近 20 条/)).toBeVisible();
});
