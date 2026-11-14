/**
 * L-05 意图分类（纯函数，零依赖）。
 *
 * 输入一句用户问题，输出五类意图之一：
 *   explain   解释/建议 —— 正常进入检索与生成
 *   clarify   指代不明 —— 先反问一句
 *   unrelated 与测评无关 —— 固定话术引导回报告
 *   boundary  涉及疾病/用药/诊断 —— 拒绝并给边界说明
 *   crisis    自伤/绝望表述 —— 不调模型，直接给资源块
 *
 * 设计约束：
 *   - 只用关键词与长度做判断，不依赖模型，保证可复现、可单测；
 *   - 规则按优先级排列：crisis > boundary > unrelated > clarify > explain；
 *   - 返回 matched 便于日志与答辩时解释"为什么判成这一类"。
 */

export const INTENT = Object.freeze({
  EXPLAIN: 'explain',
  CLARIFY: 'clarify',
  UNRELATED: 'unrelated',
  BOUNDARY: 'boundary',
  CRISIS: 'crisis',
});

const CRISIS_WORDS = [
  '自杀',
  '自伤',
  '自残',
  '不想活',
  '活不下去',
  '结束生命',
  '伤害自己',
  '轻生',
  '绝望',
];

const BOUNDARY_WORDS = [
  '抑郁症',
  '抑郁',
  '焦虑症',
  '多动症',
  'ADHD',
  '自闭症',
  '精神病',
  '确诊',
  '诊断',
  '吃药',
  '药物',
  '用药',
  '治疗',
  '有病',
];

const DIMENSION_WORDS = [
  '言语理解',
  '言语流畅',
  '数字运算',
  '知觉速度',
  '归纳推理',
  '空间视觉',
  '联想记忆',
  '自然知识',
];

const DOMAIN_WORDS = [
  ...DIMENSION_WORDS,
  '分数',
  '得分',
  '报告',
  '测评',
  '任务',
  '记忆',
  '建议',
  '练习',
  '总分',
  '档位',
  '未测',
];

const EXPLAIN_WORDS = [
  '为什么',
  '怎么',
  '哪项',
  '哪一项',
  '什么意思',
  '解释',
  '原因',
  '建议',
  '练',
  '提高',
  '低',
  '高',
  '差',
  '提升',
  '怎么看',
];

const UNRELATED_WORDS = [
  '天气',
  '股票',
  '基金',
  '翻译',
  '笑话',
  '写代码',
  '帮我写',
  '作文',
  '做饭',
  '电影',
  '游戏推荐',
  '旅游',
];

export const FIXED_REPLY = Object.freeze({
  [INTENT.CLARIFY]: '你指的是哪一项？可以说出维度名，比如「联想记忆」，我再解释。',
  [INTENT.UNRELATED]: '我只解释本次测评的结果。你可以问某个维度为什么低、或者下一步怎么练。',
  [INTENT.BOUNDARY]:
    '我不能判断疾病、也不能给用药或治疗建议。如果你担心自己的状态，请咨询医生或学校心理中心。',
  [INTENT.CRISIS]:
    // 12356 依据国卫医政函〔2024〕259号；原文要求每日≥18小时服务，不承诺24小时。
    '听到你这么说我很在意。请先联系身边的人，或拨打全国统一心理援助热线 12356。如果你现在有危险，请立即拨打 120。',
});

function hits(text, words) {
  return words.filter((word) => text.includes(word));
}

function hitResult(ctx, words, intent, reason) {
  const matched = hits(ctx.text, words);
  return matched.length > 0 ? { intent, matched, reason } : null;
}

/* 规则按优先级排列，命中即返回；每条规则保持单一判断，控制复杂度。 */
const RULES = [
  (ctx) => hitResult(ctx, CRISIS_WORDS, INTENT.CRISIS, 'crisis-word'),
  (ctx) => hitResult(ctx, BOUNDARY_WORDS, INTENT.BOUNDARY, 'medical-word'),
  (ctx) =>
    ctx.unrelated.length > 0 && ctx.domain.length === 0
      ? { intent: INTENT.UNRELATED, matched: ctx.unrelated, reason: 'off-topic' }
      : null,
  (ctx) =>
    ctx.domain.length === 0 && ctx.explain.length === 0
      ? { intent: INTENT.CLARIFY, matched: [], reason: 'no-domain-no-signal' }
      : null,
  (ctx) =>
    ctx.domain.length === 0 && ctx.text.length <= 8
      ? { intent: INTENT.CLARIFY, matched: ctx.explain, reason: 'too-short' }
      : null,
];

/**
 * 判断一句话的意图。
 * @param {string} question
 * @returns {{intent: string, matched: string[], reason: string}}
 */
export function classify(question) {
  const text = String(question || '').trim();
  if (!text) {
    return { intent: INTENT.CLARIFY, matched: [], reason: 'empty' };
  }

  const ctx = {
    text,
    explain: hits(text, EXPLAIN_WORDS),
    domain: hits(text, DOMAIN_WORDS),
    unrelated: hits(text, UNRELATED_WORDS),
  };

  for (const rule of RULES) {
    const result = rule(ctx);
    if (result) return result;
  }

  return {
    intent: INTENT.EXPLAIN,
    matched: [...ctx.domain, ...ctx.explain],
    reason: 'domain-question',
  };
}

/** 固定话术，供 UI 直接展示；不需要模型。 */
export function fixedReply(intent) {
  return FIXED_REPLY[intent] || FIXED_REPLY[INTENT.UNRELATED];
}
