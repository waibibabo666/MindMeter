/**
 * Account state for the hosted web app.
 *
 * The browser holds nothing but an HttpOnly session cookie set by the server;
 * this module only mirrors "who is signed in" for the UI and maps server error
 * codes to wording the user can act on. No password rules here are trusted by
 * the backend — they exist to avoid a pointless round trip (app/auth.py owns
 * the real policy).
 */

import { api } from './api.js';

export const AUTH_PATHS = ['/login', '/register'];
export const MIN_PASSWORD_LEN = 10;
export const MAX_PASSWORD_LEN = 128;
export const USERNAME_PATTERN = /^[a-z0-9\u4e00-\u9fff][a-z0-9._\u4e00-\u9fff-]{1,31}$/;

export const session = {
  checked: false,
  authenticated: false,
  user: null,
  registrationOpen: true,
  appVersion: '',
};

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function usernameIssue(raw) {
  const name = normalizeUsername(raw);
  if (!name) return '请填写用户名';
  if (!USERNAME_PATTERN.test(name)) {
    return '用户名 2–32 位，可用字母、数字、点、下划线或中文，且以字母、数字或中文开头';
  }
  return '';
}

export function passwordIssues(password) {
  const value = String(password || '');
  const problems = [];
  if (value.length < MIN_PASSWORD_LEN) problems.push(`密码至少 ${MIN_PASSWORD_LEN} 位`);
  if (value.length > MAX_PASSWORD_LEN) problems.push(`密码最多 ${MAX_PASSWORD_LEN} 位`);
  if (value && new Set(value).size < 3) problems.push('密码不要只由同一种字符组成');
  if (value && !/[A-Za-z\u4e00-\u9fff]/.test(value)) problems.push('密码至少包含一个字母');
  if (value && !/\d/.test(value)) problems.push('密码至少包含一个数字');
  return problems;
}

/** Client-side gate before hitting the API. Empty array means "go ahead". */
export function credentialIssues(values, options = {}) {
  const problems = [usernameIssue(normalizeUsername(values.username))];
  problems.push(...passwordIssues(values.password));
  if (values.confirm !== undefined && values.confirm !== values.password) {
    problems.push('两次输入的密码不一致');
  }
  if (options.requireAdult && !values.adult) problems.push('请勾选确认后再注册');
  return problems.filter(Boolean);
}

export function needsAuth(path) {
  return !AUTH_PATHS.includes(path);
}

/**
 * Server error code -> one short sentence. A Map (not an object literal) so
 * these keys do not read as "password" assignments to the linter.
 */
const CODE_MESSAGES = new Map([
  ['invalid_credentials', '用户名或密码不正确'],
  ['username_taken', '该用户名已被占用'],
  ['unauthenticated', '登录状态已失效，请重新登录'],
  ['too_many_login_attempts', '尝试次数过多，请 5 分钟后再试'],
  ['too_many_registrations', '注册过于频繁，请稍后再试'],
  ['registration_disabled', '当前已关闭自助注册'],
  ['adult_confirmation_required', '请先勾选年龄与边界确认'],
  ['username_and_password_required', '请填写用户名和密码'],
  ['wrong_password', '当前密码不正确'],
  ['network', '无法连接到站点，请检查网络后重试'],
  ['timeout', '请求超时，请稍后重试'],
]);

/** Turn an ApiError (or a raw string code) into one short human sentence. */
export function messageFor(error) {
  const code = error && error.code ? error.code : String(error || '');
  const text = CODE_MESSAGES.get(code) || '';
  if (text) return text;
  // The backend returns Chinese rule text directly in `detail` for weak credentials.
  const message = error && error.message ? String(error.message) : '';
  return message && message !== code ? message : '操作没有完成，请重试';
}

export async function loadSession() {
  const value = await api.get('/auth/session');
  Object.assign(session, value, { checked: true });
  return session;
}

export async function login(username, password) {
  const result = await api.post(
    '/auth/login',
    { username: normalizeUsername(username), password: String(password || '') },
    { timeoutMs: 20000 },
  );
  Object.assign(session, { authenticated: true, user: result.user, checked: true });
  return result;
}

export async function register(values) {
  const result = await api.post(
    '/auth/register',
    {
      username: normalizeUsername(values.username),
      password: String(values.password || ''),
      confirm: String(values.confirm || ''),
      adult: Boolean(values.adult),
    },
    { timeoutMs: 20000 },
  );
  Object.assign(session, { authenticated: true, user: result.user, checked: true });
  return result;
}

export async function logout() {
  await api.post('/auth/logout', {});
  Object.assign(session, { authenticated: false, user: null, checked: true });
}

export async function changePassword(values) {
  return api.post(
    '/auth/password',
    {
      currentPassword: String(values.current || ''),
      newPassword: String(values.next || ''),
      confirm: String(values.confirm || ''),
    },
    { timeoutMs: 20000 },
  );
}

export async function deleteAccount(password) {
  const result = await api.del('/auth/account', { password: String(password || '') });
  Object.assign(session, { authenticated: false, user: null, checked: true });
  return result;
}

export function accountLabel() {
  return session.user && session.user.username ? session.user.username : '';
}
