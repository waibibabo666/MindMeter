/**
 * 测评前的基础信息与状态。
 *
 * 与测评结果分开存：
 *   - 年龄 / 教育：稳定信息，填一次记住
 *   - 睡眠 / 疲劳：每次测评前重填
 *
 * 用途只有两个：分段参考、有效性标记。**不参与分数计算**。
 */

const KEY = 'mindmeter.profile.v1';

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

export function defaultProfile() {
  return { age: null, edu: '', sleep: '', fatigue: null, updatedAt: '' };
}

export function readProfile() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultProfile();
    return Object.assign(defaultProfile(), parsed);
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(patch) {
  const next = Object.assign(readProfile(), patch, { updatedAt: new Date().toISOString() });
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 存不下就只用内存，本次仍然生效 */
  }
  return next;
}

/** 稳定信息是否齐全（年龄与教育填过就不再问）。 */
export function hasBaseInfo(profile = readProfile()) {
  const age = Number(profile.age);
  return Number.isFinite(age) && age >= 10 && age <= 100 && Boolean(profile.edu);
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
