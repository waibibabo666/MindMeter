/**
 * L-05 检索接口（L-06 就绪前的本地桩）。
 *
 * 契约以 P-06 为准（docs/software/knowledge-base.md、kb/chunk.schema.json）：
 *   - chunk id 形如 kb-plan-am-01（^kb-(dim|task|score|factor|limit|plan)-[a-z]{2,5}-\d{2}$）；
 *   - 正式实现是 BM25（k1=1.2, b=0.75）+ 字符 bigram，top3，低分返回空；
 *   - L-06 交付 kb/search.js 后，把本文件换成对它的转发即可，签名不变：
 *       retrieve({ query, limit }) -> Promise<Array<{id, title, text, score}>>
 *
 * 这里的 MOCK 条目字段对齐 schema 的最小集（id/category/dims/title/text/tags），
 * 便于 L-06 到位后 run.js / validate.js 不需要再改。
 */

export const MOCK_KB = [
  {
    id: 'kb-plan-am-01',
    category: 'plan',
    dims: ['am'],
    title: '联想记忆 · 场景分组',
    tags: ['联想记忆', '记忆', '分组', '场景', '练习'],
    text: '把词对按生活场景分成三组，每组四对；先组内复述到稳定，再做整组混合复述。',
  },
  {
    id: 'kb-plan-am-02',
    category: 'plan',
    dims: ['am'],
    title: '联想记忆 · 间隔复述',
    tags: ['联想记忆', '间隔', '复述', '复习'],
    text: '当天、隔天、第四天各复述一次，比一次性连续重复保持得更久。',
  },
  {
    id: 'kb-plan-sv-01',
    category: 'plan',
    dims: ['sv'],
    title: '空间视觉化 · 心理旋转',
    tags: ['空间视觉化', '旋转', '图形', '练习'],
    text: '每天五分钟判断两个图形是否为同一物体的旋转，先从平面图形开始，再过渡到立体。',
  },
  {
    id: 'kb-dim-vc-01',
    category: 'dim',
    dims: ['vc'],
    title: '言语理解测什么',
    tags: ['言语理解', '词义', '近义'],
    text: '言语理解任务考察对词义与语义关系的把握，按语义场整理近义词再辨析差异会更稳。',
  },
  {
    id: 'kb-factor-01',
    category: 'factor',
    dims: [],
    title: '状态对成绩的影响',
    tags: ['睡眠', '状态', '复测', '练习效应'],
    text: '睡眠不足、疲劳和紧张都会压低单次成绩；同一维度复测建议间隔七天以上。',
  },
];

function scoreItem(item, query) {
  let score = 0;
  (item.tags || []).forEach((tag) => {
    if (query.includes(tag)) score += 3;
  });
  if (item.title && query.includes(item.title)) score += 2;
  (item.dims || []).forEach((dim) => {
    if (query.includes(dim)) score += 1;
  });
  return score;
}

/**
 * @param {{query?: string, limit?: number, index?: Array}} options
 * @returns {Promise<Array<{id: string, title: string, text: string, score: number}>>}
 */
export async function retrieve(options = {}) {
  const { query = '', limit = 3, index = MOCK_KB } = options;
  const text = String(query || '');
  if (!text.trim()) return [];

  return index
    .map((item) => ({ ...item, score: scoreItem(item, text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
