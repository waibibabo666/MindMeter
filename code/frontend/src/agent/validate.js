/**
 * L-05 输出校验器（纯函数，零依赖）。
 *
 * 模型说完话之后、渲染之前，必须过这里。五项检查：
 *   1) 非空
 *   2) 长度 ≤ 200 字（避免变成长篇）
 *   3) 禁用词 = 0（诊断/治疗/正常/异常/提升智商…）
 *   4) 数字必须来自 facts（数字溯源，防幻觉）
 *   5) 需要时必须有引用（引用：… / kb-xxx / facts）
 *
 * 设计约束：
 *   - 不抛异常，永远返回 { ok, issues }；
 *   - issues 里带 code 与 detail，便于降级时记录原因；
 *   - 引用段落里的编号（如 kb-plan-am-01）不当作数字参与溯源。
 */

export const MAX_CHARS = 200;

/** 禁用词：出现即判失败。想表达"在这个范围里"请用「波动范围内」。 */
export const BANNED_WORDS = [
  '诊断',
  '确诊',
  '治疗',
  '症状',
  '疾病',
  '障碍',
  '药物',
  '用药',
  '服用',
  '就医',
  '抑郁',
  '焦虑症',
  '正常',
  '异常',
  '缺陷',
  '康复',
  '提升智商',
  '提高智力',
  '脑龄',
  '延缓衰老',
];

// kb-plan-am-01（P-06 契约的小写 ID）与旧式 KB-XX-000 都要认。
export const CITATION_PATTERN = /引用\s*[:\uFF1A]|[Kk][Bb]-[A-Za-z0-9-]+|\bfacts\b/;

/** 数字 + 可选单位；用于把回答里的数字逐个拎出来。 */
const NUMBER_RE = /(\d+(?:\.\d+)?)\s*(分|次|题|个|秒|毫秒|ms|%|岁|项)?/g;

function stripCitations(text) {
  return text.replace(/引用\s*[:\uFF1A][^\n]*/g, '').replace(/[Kk][Bb]-[A-Za-z0-9-]+/g, '');
}

/**
 * 提取文本中的数字。
 * @param {string} text
 * @returns {Array<{value: number, raw: string, unit: string}>}
 */
export function extractNumbers(text) {
  const body = stripCitations(String(text || ''));
  const found = [];
  NUMBER_RE.lastIndex = 0;
  let match = NUMBER_RE.exec(body);
  while (match !== null) {
    found.push({ value: Number(match[1]), raw: match[0].trim(), unit: match[2] || '' });
    match = NUMBER_RE.exec(body);
  }
  return found;
}

/** 按 Unicode 字符数计长，避免中文被算成两倍。 */
export function charLength(text) {
  return Array.from(String(text || '')).length;
}

/* 每项检查返回 null（通过）或一条 issue；主函数只做汇总，控制复杂度。 */

function checkLength(value, maxChars) {
  const chars = charLength(value);
  if (chars <= maxChars) return null;
  return { code: 'too_long', detail: `${chars} 字，上限 ${maxChars} 字` };
}

function checkBanned(value) {
  const banned = BANNED_WORDS.filter((word) => value.includes(word));
  if (banned.length === 0) return null;
  return { code: 'banned_word', detail: `命中禁用词：${banned.join('、')}` };
}

function checkCitation(value, requireCitation) {
  if (!requireCitation || CITATION_PATTERN.test(value)) return null;
  return { code: 'missing_citation', detail: '缺少来源标注' };
}

function checkNumbers(value, allowedNumbers) {
  const allowed = new Set(allowedNumbers.map(Number));
  const unsourced = extractNumbers(value).filter((n) => !allowed.has(n.value));
  if (unsourced.length === 0) return null;
  return {
    code: 'unsourced_number',
    detail: `数字不在 facts 中：${unsourced.map((n) => n.raw).join('、')}`,
  };
}

/**
 * 校验一段模型输出。
 * @param {object} options
 * @param {string} options.text
 * @param {number[]} [options.allowedNumbers] 来自 facts 的数字，允许出现
 * @param {boolean} [options.requireCitation] 是否要求带来源
 * @param {number} [options.maxChars]
 * @returns {{ok: boolean, issues: Array<{code: string, detail: string}>, chars: number}}
 */
export function validateText(options = {}) {
  const { text, allowedNumbers = [], requireCitation = false, maxChars = MAX_CHARS } = options;
  const value = String(text || '').trim();

  if (!value) {
    return { ok: false, issues: [{ code: 'empty', detail: '回答为空' }], chars: 0 };
  }

  const issues = [
    checkLength(value, maxChars),
    checkBanned(value),
    checkCitation(value, requireCitation),
    checkNumbers(value, allowedNumbers),
  ].filter(Boolean);

  return { ok: issues.length === 0, issues, chars: charLength(value) };
}

/** 把 issues 压成一句可展示的原因，用于降级提示与日志。 */
export function describeIssues(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return '';
  return issues.map((issue) => issue.detail).join('；');
}
