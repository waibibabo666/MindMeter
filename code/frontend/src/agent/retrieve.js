/**
 * L-05 检索适配层：转发到 L-06 的正式实现（kb/search.js，BM25 + bigram）。
 *
 * 历史：L-06 交付前这里曾是 5 条 MOCK 数据的桩；2026-11-07 L-06 合并后
 * 已整体替换，MOCK_KB 删除。对外签名保持不变，run.js 无需感知。
 *
 * 门槛（P-06 §7 / search.js）：只有 review.status === 'reviewed' 的 chunk
 * 会进入索引。30 条已于 2026-11-07 全部核验通过（reviewed, by xlr268，
 * 证据见 docs/software/kb-source-review.md）；未审条目会被自动挡在索引外。
 */

import { CHUNKS } from '../kb/chunks.js';
import { createIndex, search } from '../kb/search.js';

let cached = null;

function getIndex() {
  if (!cached) cached = createIndex(CHUNKS);
  return cached;
}

/** chunk 审核状态变化（draft → reviewed）后调用，重建索引。 */
export function resetIndexCache() {
  cached = null;
}

/** 当前已审条目数；0 表示知识库尚未对 Agent 开放。 */
export function reviewedCount() {
  return getIndex().reviewedCount;
}

/**
 * 检索知识块。
 * @param {{query?: string, limit?: number, chunks?: Array}} options
 *   chunks 仅供测试注入；生产路径使用 kb/chunks.js 的 CHUNKS。
 * @returns {Promise<Array<{id: string, title: string, text: string, score: number}>>}
 */
export async function retrieve(options = {}) {
  const { query = '', limit = 3, chunks = null } = options;
  const text = String(query || '');
  if (!text.trim()) return [];

  const { index } = chunks ? createIndex(chunks) : getIndex();
  return search(index, text, limit).map((hit) => ({
    id: hit.id,
    title: hit.chunk.title,
    text: hit.chunk.text,
    score: hit.score,
  }));
}
