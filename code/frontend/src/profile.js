/**
 * 测评前要填的信息，按"变化频率"分两类存放（人工测试反馈：不该反复问、也不该每次都问）：
 *
 * - **账号级**：年龄、最高学历、知情同意版本 —— 存在服务端 `app_state.profile`，
 *   换浏览器/换设备登录后不会再问第二次；
 * - **临场级**：昨晚睡眠时长、当前疲劳 —— 只在本次页面会话的内存里，每次测评重新填，
 *   不进账号档案（它们只对"这次结果可不可信"有意义）。
 *
 * 两类都**不参与计分**：只用于同龄段参考与有效性标记（docs/algorithm/algorithm.md）。
 * 年龄与学历是产品明确询问的少量背景项，不收集姓名/邮箱/手机号等身份信息。
 */

import { readState, update } from './store.js';

export const CONSENT_VERSION = '2026-11';

export const EDU_OPTIONS = [
  { value: 'middle', label: '初中及以下' },
  { value: 'high', label: '高中 / 中专' },
  { value: 'college', label: '大专' },
  { value: 'bachelor', label: '本科' },
  { value: 'graduate', label: '研究生及以上' },
];

export const SLEEP_OPTIONS = [
  { value: 'lt5', label: '少于 5 小时' },
  { value: '5to6', label: '5–6 小时' },
  { value: '6to7', label: '6–7 小时' },
  { value: '7to8', label: '7–8 小时' },
  { value: 'gt8', label: '8 小时以上' },
];

/** 临场状态：模块级内存，刷新页面即回到空值（这正是我们要的）。 */
const session = { sleep: '', fatigue: null };

function cleanAge(value) {
  const age = Number(value);
  return Number.isFinite(age) && age >= 10 && age <= 100 ? Math.round(age) : null;
}

function cleanEdu(value) {
  const edu = String(value || '');
  return EDU_OPTIONS.some((item) => item.value === edu) ? edu : '';
}

export function defaultProfile() {
  return {
    age: null,
    edu: '',
    consentVersion: '',
    sleep: '',
    fatigue: null,
    updatedAt: '',
  };
}

/** 账号里存的那一份（服务端 app_state.profile）。 */
export function readAccountProfile() {
  const raw = readState().profile || {};
  return {
    age: cleanAge(raw.age),
    edu: cleanEdu(raw.edu),
    consentVersion: String(raw.consentVersion || ''),
    consentedAt: String(raw.consentedAt || ''),
  };
}

/** 页面统一读的合并视图。 */
export function readProfile() {
  const account = readAccountProfile();
  return {
    ...defaultProfile(),
    ...account,
    sleep: session.sleep,
    fatigue: session.fatigue,
    updatedAt: account.consentedAt,
  };
}

/**
 * 保存。账号级字段写回 state（由 store 串行 PUT /state），临场字段只进内存。
 * 年龄越界或学历不在选项内会被丢掉，不会污染档案。
 */
export function saveProfile(patch = {}) {
  const account = {};
  let touchedAccount = false;

  // 无效值一律忽略，而不是写成 null 覆盖掉已有的好数据。
  if ('age' in patch) {
    const age = cleanAge(patch.age);
    if (age !== null) {
      account.age = age;
      touchedAccount = true;
    }
  }
  if ('edu' in patch) {
    const edu = cleanEdu(patch.edu);
    if (edu) {
      account.edu = edu;
      touchedAccount = true;
    }
  }
  if ('consentVersion' in patch) {
    account.consentVersion = String(patch.consentVersion || '').slice(0, 24);
    account.consentedAt = new Date().toISOString();
    touchedAccount = true;
  }

  if ('sleep' in patch) session.sleep = String(patch.sleep || '');
  if ('fatigue' in patch) {
    const fatigue = Number(patch.fatigue);
    session.fatigue = Number.isFinite(fatigue)
      ? Math.min(5, Math.max(1, Math.round(fatigue)))
      : null;
  }

  if (touchedAccount) {
    // store.update 是就地修改（忽略返回值），这里必须写 draft，不能返回对象。
    update((draft) => {
      draft.profile = Object.assign({}, draft.profile || {}, account);
    });
  }
  return readProfile();
}

/** 稳定信息是否齐全（年龄与教育填过就不再问）。 */
export function hasBaseInfo(profile = readProfile()) {
  return cleanAge(profile.age) !== null && Boolean(profile.edu);
}

/** 第一次用（或同意条款升版）需要走"认识你一次"那页。 */
export function needsIntake(profile = readProfile()) {
  return !hasBaseInfo(profile) || profile.consentVersion !== CONSENT_VERSION;
}

/** 年龄分段，用于报告里给「同龄参考」的提示语。 */
export function ageBand(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return '';
  if (n < 20) return '20 岁以下';
  if (n < 30) return '20–29 岁';
  if (n < 40) return '30–39 岁';
  if (n < 50) return '40–49 岁';
  if (n < 60) return '50–59 岁';
  return '60 岁及以上';
}

/**
 * 状态对结果的潜在影响。
 * 只给提示，不改分数——扣分会让结果无法解释。
 */
export function stateWarning(profile = readProfile()) {
  const sleep = profile.sleep;
  if (sleep === 'lt5') {
    return '昨晚睡眠少于 5 小时，速度类与记忆类分数可能明显偏低，建议休息后重测。';
  }
  if (sleep === '5to6') {
    return '昨晚睡眠偏少，速度类分数可能略受影响，解读时请留意。';
  }
  const fatigue = Number(profile.fatigue);
  if (Number.isFinite(fatigue) && fatigue >= 4) {
    return '你反馈当前疲劳程度较高，后段题目表现可能受影响。';
  }
  return '';
}

/** 该年龄段哪些维度变化最快，用于提示语。 */
export function ageNote(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return '';
  if (n >= 50) {
    return '这一年龄段知觉得分普遍低于年轻时，请以同龄水平作参考，不必与二十岁的人比。';
  }
  if (n >= 30) {
    return '这一年龄段言语理解通常处于高位，速度类开始缓慢下降，属正常现象。';
  }
  return '';
}

/** 供 store 在重置账号数据时清掉临场值。 */
export function resetSessionProfile() {
  session.sleep = '';
  session.fatigue = null;
}
