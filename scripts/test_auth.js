#!/usr/bin/env node
/**
 * 账号与传输层测试（auth.js / api.js 纯逻辑，无 DOM、无网络）。
 *
 * 覆盖：
 *   - 用户名与密码规则：与服务端 app/auth.py 同源口径（前端只做即时提示，不是安全边界）
 *   - credentialIssues：确认密码与 18+ 勾选
 *   - messageFor：服务端错误码 -> 人话
 *   - needsAuth / AUTH_PATHS：闸门放行范围
 *   - api.js：同源 Cookie、401 广播、JSON 头、超时归一化
 */

'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.resolve(__dirname, '..', 'code', 'frontend', 'src');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

/**
 * Shared transport double: one fake fetch + one fake event target, so the
 * api.js instance used by auth.js and the one under test are the same object.
 */
const transport = {
  calls: [],
  events: [],
  respond: () => ({ ok: true, status: 200, json: async () => ({}) }),
  boom: null,
};

function resetTransport() {
  transport.calls.length = 0;
  transport.events.length = 0;
  transport.respond = () => ({ ok: true, status: 200, json: async () => ({}) });
  transport.boom = null;
}

globalThis.fetch = async (url, options) => {
  transport.calls.push({ url, options });
  if (transport.boom) throw transport.boom;
  return transport.respond(url, options);
};
globalThis.document = { dispatchEvent: (event) => transport.events.push(event) };

async function main() {
  const auth = await import(pathToFileURL(path.join(SRC, 'auth.js')).href);
  const {
    AUTH_PATHS,
    credentialIssues,
    loadSession,
    login,
    messageFor,
    needsAuth,
    normalizeUsername,
    passwordIssues,
    session,
    usernameIssue,
  } = auth;

  test('normalizeUsername：去空白并转小写', () => {
    assert(normalizeUsername('  Demo.User ') === 'demo.user', 'trim + lower');
    assert(normalizeUsername(null) === '', 'null -> 空串');
    assert(normalizeUsername('心智镜') === '心智镜', '中文不受影响');
  });

  test('usernameIssue：长度、首字符与字符集', () => {
    assert(usernameIssue('') !== '', '空用户名要有提示');
    assert(usernameIssue('a') !== '', '1 位太短');
    assert(usernameIssue('_bad') !== '', '不能以下划线开头');
    assert(usernameIssue('x'.repeat(33)) !== '', '超过 32 位');
    assert(usernameIssue('ok.name_1') === '', '合法用户名不该有提示');
    assert(usernameIssue('心智镜2号') === '', '中文用户名应放行');
    assert(usernameIssue('Demo.User') === '', '大写在前端已归一化，不该报错');
  });

  test('passwordIssues：长度、字符种类与字母数字要求', () => {
    assert(passwordIssues('abc1').length === 1, '短密码只提示一条');
    assert(
      passwordIssues('abc1').some((t) => t.includes('至少')),
      '短密码要说「至少」',
    );
    // 人工测试反馈：密码规则下调到 8 位，边界必须锁住，别悄悄回弹。
    assert(passwordIssues('abcdef12').length === 0, '8 位含字母数字必须放行');
    assert(passwordIssues('abcdefg1').length === 0, '8 位另一种排布同样放行');
    assert(passwordIssues('abcdefg').length > 0, '7 位仍然要拒');
    assert(passwordIssues('aaaaaaaaaa').length > 0, '同一种字符要拒绝');
    assert(passwordIssues('alllettersnovalue').length > 0, '无数字要拒绝');
    assert(passwordIssues('1234567890').length > 0, '无字母要拒绝');
    assert(passwordIssues('abcdef12345').length === 0, '达标密码不该有提示');
    assert(passwordIssues('x'.repeat(200)).length > 0, '超长要拒绝');
  });

  test('credentialIssues：确认密码与 18+ 勾选', () => {
    const ok = { username: 'demo.user', password: 'abcdef12345', confirm: 'abcdef12345' };
    assert(credentialIssues(ok).length === 0, '合法输入不该有提示');
    assert(
      credentialIssues({ ...ok, confirm: 'abcdef12346' }).some((t) => t.includes('不一致')),
      '两次密码不一致要提示',
    );
    assert(
      credentialIssues(
        { username: 'demo.user', password: 'abcdef12345', adult: false },
        { requireAdult: true },
      ).some((t) => t.includes('勾选')),
      '注册必须勾选确认',
    );
    assert(credentialIssues({ username: '', password: '' }).length >= 2, '两项都缺要各给一条');
  });

  test('needsAuth：只放行登录与注册', () => {
    assert(AUTH_PATHS.includes('/login') && AUTH_PATHS.includes('/register'), '两个认证页要放行');
    assert(!AUTH_PATHS.includes('/'), '首页不属于放行集合');
    assert(needsAuth('/') === true, '未登录访问首页要被拦');
    assert(needsAuth('/task/vc') === true, '任务页要被拦');
    assert(needsAuth('/login') === false, '登录页不该再被拦');
    assert(needsAuth('/register') === false, '注册页不该再被拦');
  });

  test('messageFor：错误码翻译与兜底', () => {
    assert(messageFor({ code: 'invalid_credentials' }).includes('用户名或密码'), '登录失败要说清');
    assert(messageFor({ code: 'username_taken' }).includes('占用'), '重名要说清');
    assert(messageFor({ code: 'unauthenticated' }).includes('重新登录'), '会话失效要说清');
    assert(messageFor({ code: 'too_many_login_attempts' }).includes('5 分钟'), '限流要给时间');
    assert(messageFor('registration_disabled').includes('关闭'), '关闭注册要可读');
    assert(
      messageFor({ code: 'weird_code', message: '服务端原文' }) === '服务端原文',
      '未知码回退原文',
    );
    assert(messageFor({ code: 'weird_code' }) === '操作没有完成，请重试', '什么都没有时给通用文案');
  });

  test('session：默认未登录且带注册开关', () => {
    assert(session.authenticated === false, '初始必须是未登录');
    assert(session.user === null, '初始没有用户');
    assert(session.registrationOpen === true, '默认开放注册');
  });

  test('api.js：同源 Cookie、JSON 头与 Authorization 缺席', async () => {
    const { api, configure } = await import(pathToFileURL(path.join(SRC, 'api.js')).href);
    resetTransport();
    configure({ apiBase: '/api/v1' });
    await api.get('/state');
    await api.post('/auth/login', { username: 'a', password: 'b' });
    await api.del('/data');

    assert(transport.calls[0].url === '/api/v1/state', 'GET 拼上 apiBase');
    assert(transport.calls[0].options.credentials === 'same-origin', '必须带同源 Cookie');
    assert(transport.calls[1].options.method === 'POST', 'POST 方法');
    assert(
      transport.calls[1].options.headers['Content-Type'] === 'application/json',
      '写请求是 JSON',
    );
    assert(transport.calls[2].options.method === 'DELETE', 'del 走 DELETE');
    assert(transport.calls[2].options.body === undefined, '无体 DELETE 不带 body');
    for (const call of transport.calls) {
      assert(!('Authorization' in call.options.headers), '浏览器不该出现 Authorization');
      assert(!('X-MM-Token' in call.options.headers), '没有 boot token 时不发本地令牌');
    }
  });

  test('api.js：401 在非认证路径上广播一次', async () => {
    const { api, UNAUTHENTICATED } = await import(pathToFileURL(path.join(SRC, 'api.js')).href);
    resetTransport();
    transport.respond = () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'unauthenticated' }),
    });
    let thrown = null;
    try {
      await api.get('/state');
    } catch (error) {
      thrown = error;
    }
    assert(thrown && thrown.code === 'unauthenticated', '401 转成 ApiError(unauthenticated)');
    assert(
      transport.events.length === 1 && transport.events[0].type === UNAUTHENTICATED,
      '要广播一次登录失效',
    );

    // 登录接口本身返回 401 是「密码不对」，不该把用户踢出页面。
    resetTransport();
    transport.respond = () => ({
      ok: false,
      status: 401,
      json: async () => ({ detail: 'invalid_credentials' }),
    });
    let loginError = null;
    try {
      await login('user', 'pass');
    } catch (error) {
      loginError = error;
    }
    assert(loginError && loginError.code === 'invalid_credentials', '登录失败透传错误码');
    assert(transport.events.length === 0, '认证路径不广播登录失效');
    assert(session.authenticated === false, '登录失败不改会话状态');
  });

  test('api.js：网络异常归一化，loadSession 写回状态', async () => {
    const { api } = await import(pathToFileURL(path.join(SRC, 'api.js')).href);
    resetTransport();
    transport.boom = new Error('boom');
    let error = null;
    try {
      await api.get('/health/live');
    } catch (caught) {
      error = caught;
    }
    assert(error && error.code === 'network', '传输失败归一为 network');

    resetTransport();
    transport.respond = () => ({
      ok: true,
      status: 200,
      json: async () => ({
        authenticated: true,
        user: { username: 'demo.user' },
        registrationOpen: false,
      }),
    });
    const value = await loadSession();
    assert(
      value.authenticated === true && value.user.username === 'demo.user',
      'loadSession 写回 session',
    );
    assert(session.registrationOpen === false, '注册开关随服务端');
    assert(transport.calls[0].url === '/api/v1/auth/session', 'session 探测路径固定');
  });

  let passed = 0;
  // 有意串行：与其他测试脚本保持一致的输出顺序。
  for (const { name, fn } of tests) {
    try {
      await fn(); // NOSONAR: 串行是有意为之
      passed += 1;
      console.log(`[PASS] ${name}`);
    } catch (error) {
      console.error(`[FAIL] ${name}`);
      console.error(`       ${error.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} auth checks passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
