/**
 * 解读的两条路径：模型 或 模板。
 *
 * 未配置、超时、CORS、鉴权失败等任何异常都必须落到模板，
 * 页面不能因为模型不可用而没有内容。
 */
import { callLlm, isConfigured } from './client.js';
import { DIMS } from '../data.js';
import { mulberry32, pick } from '../random.js';

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

function rtNote(metrics) {
  if (typeof metrics.meanRtMs !== 'number') return '';
  return `，平均每题反应约 ${(metrics.meanRtMs / 1000).toFixed(1)} 秒`;
}

/** 每个维度准备多种说法，方向一致、措辞轮换。 */
const DIM_LINES = {
  vc: [
    (m) => `言语理解 · 判断词语关系是否相近：${m.total} 题答对 ${m.correct} 题${rtNote(m)}`,
    (m) => `言语理解 · 词义辨析，共 ${m.total} 题，答对 ${m.correct} 题${rtNote(m)}`,
    (m) => `言语理解 · 从四个近义词里选最接近的一个，${m.total} 题里对 ${m.correct} 题`,
  ],
  ps: [
    (m) =>
      `知觉速度 · 在 ${m.seconds} 秒内判断符号组合是否相同：完成 ${m.trials} 题、正确 ${m.correct} 题`,
    (m) => `知觉速度 · ${m.seconds} 秒计时，共作答 ${m.trials} 题，其中正确 ${m.correct} 题`,
    (m) =>
      `知觉速度 · 计时 ${m.seconds} 秒做符号匹配，得到 ${m.trials} 次作答、${m.correct} 次正确`,
  ],
  sv: [
    (m) => `空间视觉化 · 判断图形旋转后是否与目标一致：${m.total} 题答对 ${m.correct} 题`,
    (m) => `空间视觉化 · 图形旋转判断，${m.total} 题中答对 ${m.correct} 题`,
    (m) => `空间视觉化 · 在平面里比对旋转后的图形，${m.total} 题对了 ${m.correct} 题`,
  ],
  am: [
    (m) => `联想记忆 · 先记词对再判断是否出现过：命中 ${m.hits} 个、虚报 ${m.falseAlarms} 个`,
    (m) => `联想记忆 · 再认判断，认对 ${m.hits} 个、把没见过的当成见过 ${m.falseAlarms} 次`,
    (m) => `联想记忆 · 词对回忆后再认，命中 ${m.hits}、虚报 ${m.falseAlarms}`,
  ],
};

const OPENINGS = [
  (n) => `这次标准档完成了 ${n} 项，按维度把原始指标列一下。`,
  (n) => `本次测得 ${n} 个维度的原始数据，逐项如下。`,
  (n) => `四项任务已完成 ${n} 项，先看数据本身。`,
  () => '下面是这次任务的原始数据，逐条对应到维度。',
];

const CLOSINGS = [
  '这些数字只反映本次任务里的表现，受睡眠、情绪、设备与练习效应影响，换一天再测可能不同。',
  '分数由本机按 scoring-v3.1 折算，仅作参考；它不是常模分数，也不与任何人比较。',
  '想细聊某一项，可以去对话页继续追问；练习建议也在那里。',
  '单次结果说明不了能力高低，把它当作一次「今天的快照」更合适。',
];

/** 每个维度按本次数字给一句「怎么读」，依据知识库里已核验的解释，不做能力判断。 */
const READINGS = {
  vc: (m) => {
    const ratio = m.total ? m.correct / m.total : 0;
    if (ratio >= 0.85) return '这次对的题比较多，词义判断整体顺利。';
    if (ratio >= 0.6) return '大部分题目判断正确，难点可能落在近义词的细微差别上。';
    return '这次对的题偏少，近义词之间的细微差别可能是主要难点。';
  },
  ps: (m) => {
    const wrong = typeof m.wrong === 'number' ? m.wrong : 0;
    if (wrong === 0) {
      return '全程没有判断错误：限时任务要在快和准之间取舍，这次偏向了准。';
    }
    return `有 ${wrong} 次判断错误：限时任务的结果同时反映速度与策略，要结合作答量一起看。`;
  },
  sv: (m) => {
    const ratio = m.total ? m.correct / m.total : 0;
    if (ratio >= 0.9) return '这次没有出现判断错误，图像操作比较顺。';
    return '旋转判断有几题没对上，可以先在脑内把图转完再选。';
  },
  am: (m) => {
    if (m.falseAlarms >= 3) {
      return '再认有时靠「眼熟」而不是真的记得，虚报多说明有几题被熟悉感带偏了。';
    }
    return '虚报很少，说明这次判断更多靠「确实记得」，而不是靠眼熟。';
  },
};

const SUGGESTIONS = {
  vc: '近义词可以成对整理，比较它们在句子里的用法差别。',
  ps: '限时任务可以先练「确认后再作答」，减少为赶速度产生的错误。',
  sv: '遇到旋转题先在纸上画出转完的图案，再和心里的结果对照。',
  am: '记词对时按场景分组，回想时先想场景再想词（参考：kb-dim-am-01）。',
};

const GENERAL_SUGGESTION = '把练习分散到不同日子，比一次性长时间重复更稳（参考：kb-plan-01）。';

/** 各项任务的「错得相对多」的比例，用来挑一条最贴合的练习建议。 */
const ERROR_RATE = {
  ps: (m) => (m.trials ? (m.wrong || 0) / m.trials : 0),
  am: (m) => {
    const total = (m.hits || 0) + (m.falseAlarms || 0);
    return total ? (m.falseAlarms || 0) / total : 0;
  },
};

function errorRate(id, metrics) {
  const fn = ERROR_RATE[id];
  if (fn) return fn(metrics);
  return metrics.total ? 1 - (metrics.correct || 0) / metrics.total : 0;
}

function weakestOf(entries) {
  let best = entries[0];
  for (const entry of entries) {
    if (errorRate(entry[0], entry[1]) > errorRate(best[0], best[1])) best = entry;
  }
  return best[0];
}

/**
 * 报告用的模板解读：比对话兜底更长、更有变化。
 * 结构＝开头 + 每维（任务/数字/怎么读）+ 可以试试 + 未测说明 + 收尾。
 * 所有解释都来自知识库里已核验的内容，不编造数字、不下结论。
 */
export function templateNarrative(metrics) {
  const random = mulberry32(Date.now() >>> 0);
  const entries = Object.entries(metrics || {}).filter(([id, m]) => m && DIM_LINES[id]);
  if (entries.length === 0) return templateExplanation(metrics);

  const lines = entries.map(([id, m]) => {
    const facts = pick(DIM_LINES[id], random)(m);
    const reading = READINGS[id] ? READINGS[id](m) : '';
    const suffix = reading ? `。${reading}` : '';
    return `· ${facts}${suffix}`;
  });

  const measured = new Set(entries.map(([id]) => id));
  const missing = DIMS.filter((dim) => !measured.has(dim.id));
  const weakest = weakestOf(entries);

  const parts = [pick(OPENINGS, random)(entries.length), ...lines];
  if (weakest && SUGGESTIONS[weakest]) {
    parts.push('', '可以试试：', `· ${SUGGESTIONS[weakest]}`, `· ${GENERAL_SUGGESTION}`);
  }
  if (missing.length) {
    parts.push(
      `另有 ${missing.length} 个维度（${missing.map((dim) => dim.name).join('、')}）本档未测，报告里留空，不按 0 分计算。`,
    );
  }
  parts.push('', pick(CLOSINGS, random));
  return parts.join('\n');
}

/** 对话兜底用的简短模板：只复述原始指标，不做任何推断。 */
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
    text: templateNarrative(metrics),
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
