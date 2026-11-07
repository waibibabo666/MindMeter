/**
 * 本地知识库检索（L-06）。
 *
 * 设计取舍：
 *   - 不引入分词库：中文按字符 bigram 切分，零依赖、离线可用；
 *   - BM25（k1 = 1.2, b = 0.75），与算法文档约定一致；
 *   - 只检索 review.status === 'reviewed' 的条目，未审内容不进入索引；
 *   - 检索不到就返回空数组，由调用方决定说"不知道"，不做相似度兜底。
 */

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/** 极短查询里常出现、但对区分度没有帮助的字。 */
const NOISE = new Set([
  '的',
  '了',
  '是',
  '吗',
  '呢',
  '啊',
  '我',
  '你',
  '会',
  '有',
  '在',
  '和',
  '与',
  '就',
  '都',
]);

/**
 * 中文按字符 bigram 切分；ASCII 连续片段整体保留（如 12356、bm25）。
 * 单字查询退化为 unigram，避免无法检索。
 */
export function tokenize(text) {
  const src = String(text || '').toLowerCase();
  const tokens = [];

  // 先抽 ASCII 片段
  const ascii = src.match(/[a-z0-9]+/g) || [];
  for (const word of ascii) tokens.push(word);

  // 中文部分去掉标点空白后做 bigram
  const zh = src.replace(/[^\u4e00-\u9fa5]/g, '');
  if (zh.length === 1) {
    tokens.push(zh);
  } else {
    for (let i = 0; i < zh.length - 1; i += 1) {
      const gram = zh.slice(i, i + 2);
      if (!NOISE.has(gram)) tokens.push(gram);
    }
  }
  return tokens;
}

/** 一条 chunk 参与检索的文本：标题 + 正文 + 标签。 */
function chunkText(chunk) {
  return [chunk.title, chunk.text, (chunk.tags || []).join(' ')].join(' ');
}

/**
 * 建索引。
 * @param {Array} chunks 只应传入已审条目
 * @returns {{docs: Array, df: Map, avgdl: number, N: number}}
 */
export function buildIndex(chunks) {
  const docs = [];
  const df = new Map();
  let totalLen = 0;

  for (const chunk of chunks) {
    const tokens = tokenize(chunkText(chunk));
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1);
    totalLen += tokens.length;
    docs.push({ chunk, tf, len: tokens.length });
  }

  return { docs, df, avgdl: docs.length ? totalLen / docs.length : 0, N: docs.length };
}

function idf(index, token) {
  const n = index.df.get(token) || 0;
  return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
}

/**
 * 检索 top-k。
 * @returns {Array<{id: string, score: number, chunk: object}>}
 */
export function search(index, query, k = 3) {
  if (!index || !index.docs.length) return [];
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];

  const scored = index.docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const tf = doc.tf.get(term);
      if (!tf) continue;
      const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.len) / (index.avgdl || 1));
      score += idf(index, term) * ((tf * (BM25_K1 + 1)) / denom);
    }
    return { id: doc.chunk.id, score, chunk: doc.chunk };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** 从已审条目构建可直接查询的索引。 */
export function createIndex(allChunks) {
  const reviewed = allChunks.filter((c) => c && c.review && c.review.status === 'reviewed');
  return { index: buildIndex(reviewed), reviewedCount: reviewed.length };
}
