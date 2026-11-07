/**
 * 解读的两条路径：模型 或 模板。
 *
 * 未配置、超时、CORS、鉴权失败等任何异常都必须落到模板，
 * 页面不能因为模型不可用而没有内容。
 */
import { callLlm, isConfigured } from './client.js';

export const FALLBACK_REASON = {
  not_configured: '未配置 AI，用模板解读',
  unsupported: '当前环境不支持 fetch，用模板解读',
  timeout: 'AI 超时，已回退模板',
  network_cors: '网络或 CORS 未放行，已回退模板',
  auth: 'Key 无效或无权限，已回退模板',
  rate_limit: '触发限流，已回退模板',
  http: '模型服务异常，已回退模板',
  bad_response: '响应格式异常，已回退模板',
  unknown: 'AI 不可用，已回退模板',
};

const METRIC_LABEL = {
  vc: (m) => `言语理解正确 ${m.correct}/${m.total}`,
  ps: (m) => `知觉速度 ${m.seconds} 秒内完成 ${m.trials} 题、正确 ${m.correct}`,
  sv: (m) => `空间视觉化正确 ${m.correct}/${m.total}`,
  am: (m) => `联想记忆命中 ${m.hits}、虚报 ${m.falseAlarms}`,
};

/** 模板解读：只复述原始指标，不做任何推断。 */
export function templateExplanation(metrics) {
  const entries = Object.entries(metrics || {}).filter(([id, m]) => m && METRIC_LABEL[id]);
  if (entries.length === 0) {
    return '本次还没有可解读的原始指标。完成测评后会在这里给出说明。';
  }
  const lines = entries.map(([id, m]) => `· ${METRIC_LABEL[id] ? METRIC_LABEL[id](m) : id}`);
  return [
    '本次完成的原始指标：',
    ...lines,
    '',
    '这些只是本次测得的原始数据，不是分数，也不与人群比较。',
    '分数由本机按 scoring-v3.1 折算；正式分数以服务端 scoring-v3 为准。',
  ].join('\n');
}

export function buildMessages(metrics) {
  const facts = Object.entries(metrics || {})
    .map(([id, m]) => `${id}: ${JSON.stringify(m)}`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        '你是 MindMeter 的解读助手。只解释给出的原始指标，不推断能力高低，不下诊断，' +
        '不与人群比较，不提"总分""百分位"。语气平实，不超过 120 字。',
    },
    { role: 'user', content: `原始指标：\n${facts || '（无）'}\n请用两句话解释这些指标的含义。` },
  ];
}

function canUseLlm(settings, forceTemplate) {
  return Boolean(!forceTemplate && settings && settings.enabled && isConfigured(settings));
}

function fallback(metrics, code) {
  return {
    text: templateExplanation(metrics),
    source: 'template',
    code,
    reason: FALLBACK_REASON[code] || FALLBACK_REASON.unknown,
  };
}

async function askLlm(call, settings, metrics) {
  const result = await call({ settings, messages: buildMessages(metrics) });
  const text = String(result && result.text ? result.text : '').trim();
  if (!text) throw new Error('empty');
  return text;
}

/**
 * 生成解读。
 * @returns {Promise<{text:string, source:'llm'|'template', code:string|null, reason:string}>}
 */
export async function explain(options = {}) {
  const { metrics, settings, call = callLlm, forceTemplate = false } = options;

  if (!canUseLlm(settings, forceTemplate)) return fallback(metrics, 'not_configured');

  try {
    const text = await askLlm(call, settings, metrics);
    return { text, source: 'llm', code: null, reason: '' };
  } catch (error) {
    const code = error && error.code ? error.code : 'unknown';
    return fallback(metrics, code);
  }
}
