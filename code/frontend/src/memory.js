/**
 * L-07 本地记忆：画像 / 摘要 / 建议记录 / 最近 20 条消息。
 *
 * 存储层（storage.js）已经提供读写与 20 条上限，这里只补业务规则：
 *   - 画像必须由用户确认才写入，未确认前 Agent 不得引用；
 *   - 摘要由一次测评生成，只记录最低项与建议数量，不写能力评价；
 *   - 每条记忆可单独删除，删除后不再被引用；
 *   - 提供按类型删除与清空，供记忆页与设置页使用；
 *   - 对话页的「清空对话」只删 messages（逐条单行接口），摘要 / 建议 / 画像不动。
 */

import { api } from './api.js';
import { cache, enqueue, flushWrites } from './cache.js';
import { MAX_MESSAGES, addSummary, clearMemory, readMemory } from './storage.js';
import { DIMS } from './data.js';

const DIM_NAME = new Map(DIMS.map((dim) => [dim.id, dim.name]));

const TIER_NAME = { quick: '快测', standard: '标准', deep: '深度' };

export const PROFILE_KEYS = ['goal', 'preference', 'constraint'];

/** 画像是否可用：三项里至少有一项非空，且已被用户确认。 */
export function isProfileUsable(profile) {
  if (profile?.confirmed !== true) return false;
  return PROFILE_KEYS.some((key) => String(profile[key] || '').trim().length > 0);
}

/**
 * 由一次测评生成摘要。没有可用分数时返回 null（不写空摘要）。
 * @param {{tier?: string, scores?: Record<string, number>, finishedAt?: number}} session
 * @param {string[]} [adviceIds]
 */
export function buildSummary(session, adviceIds = []) {
  const scores = session?.scores || {};
  const entries = Object.entries(scores).filter(([, value]) => typeof value === 'number');
  if (entries.length === 0) return null;

  // 不用 sort：只想拿最低项，reduce 不会改动原数组，也避免原地排序的副作用。
  const [lowestId, lowestValue] = entries.reduce((min, item) => (item[1] < min[1] ? item : min));
  const tier = TIER_NAME[session.tier] || TIER_NAME.standard;
  const name = DIM_NAME.get(lowestId) || lowestId;
  const ids = adviceIds.slice(0, 3);

  return {
    id: `sum_${session.finishedAt || Date.now()}`,
    at: session.finishedAt || Date.now(),
    tier: session.tier || 'standard',
    lowest: { id: lowestId, value: lowestValue },
    adviceIds: ids,
    text: `${tier} · 最低项${name} ${lowestValue} · ${ids.length} 条建议`,
  };
}

/** 生成并保存摘要；没有分数时不写。 */
export function saveSummary(session, adviceIds = []) {
  const summary = buildSummary(session, adviceIds);
  if (!summary) return null;
  addSummary(summary);
  return summary;
}

/**
 * 用户确认画像后才落库；未确认一律不写。
 *
 * 走服务端专门的画像接口（`PUT /memory/profile`）而不是 `PUT /memory` 全量快照：
 * 后者会先删掉本账号的 summaries/advice 再重写，会把对话自动沉淀出来的行抹掉。
 */
export function confirmProfile(profile) {
  const clean = {};
  PROFILE_KEYS.forEach((key) => {
    clean[key] = String(profile?.[key] || '').trim();
  });
  if (!PROFILE_KEYS.some((key) => clean[key])) return null;
  const next = { ...clean, confirmed: true, confirmedAt: Date.now() };
  const memory = readMemory();
  cache.memory = Object.assign(memory, { profile: next });
  enqueue(() => api.put('/memory/profile', clean));
  return next;
}

/** 忽略待确认画像：只清未确认内容，不动摘要与建议。 */
export function dismissProfile() {
  const memory = readMemory();
  cache.memory = Object.assign(memory, { profile: {} });
  enqueue(() => api.del('/memory/profile'));
}

/**
 * 记录一条建议展示；重复的建议 ID 只保留最新一条。
 * 走 `POST /memory/advice`（服务端按 (user_id, id) upsert），不用全量快照。
 */
export function recordAdvice(advice) {
  if (!advice?.id) return null;
  const memory = readMemory();
  const entry = {
    id: advice.id,
    at: advice.at || Date.now(),
    title: String(advice.title || ''),
    shown: true,
    done: Boolean(advice.done),
  };
  cache.memory = Object.assign(memory, {
    advice: [...memory.advice.filter((item) => item.id !== entry.id), entry],
  });
  enqueue(() => api.post('/memory/advice', entry));
  return entry;
}

/** 标记建议已完成 / 取消完成（PATCH 单行，用户勾过的状态不会被对话沉淀覆写）。 */
export function setAdviceDone(id, done) {
  const memory = readMemory();
  const next = memory.advice.map((item) =>
    item.id === id ? { ...item, done: Boolean(done) } : item,
  );
  cache.memory = Object.assign(memory, { advice: next });
  enqueue(() => api.patch(`/memory/advice/${encodeURIComponent(id)}`, { done: Boolean(done) }));
  return next;
}

const MEMORY_BUCKETS = {
  summary: { key: 'summaries', segment: 'summaries' },
  advice: { key: 'advice', segment: 'advice' },
  message: { key: 'messages', segment: 'messages' },
};

/**
 * 按类型删除一条记忆：summary / advice / message。
 * 三条都走单行删除接口；`PUT /memory` 的全量替换会抹掉服务端对话沉淀的行，
 * 所以这里一律不再用它。
 */
export function removeMemory(kind, id) {
  const bucket = MEMORY_BUCKETS[kind];
  if (!bucket) return readMemory();
  const memory = readMemory();
  cache.memory = Object.assign(memory, {
    [bucket.key]: memory[bucket.key].filter((item) => String(item.id) !== String(id)),
  });
  enqueue(() => api.del(`/memory/${bucket.segment}/${encodeURIComponent(id)}`));
  return readMemory();
}

/** 清空全部记忆（画像/摘要/建议/消息），设置页的「清除记忆」用它。 */
export function clearAllMemory() {
  clearMemory();
}

/**
 * 清空对话记录：**只删 messages**，摘要、建议记录与画像一律不动。
 *
 * 「清空对话」的语义与通路（人工测试反馈 3 第 1 条）：
 * 必须是**窄语义** —— 只删对话，画像/摘要/建议记录都保留。
 *   - `DELETE /memory/messages`（批量，只删对话）是首选通路，一次往返；
 *     它是为这条反馈补的端点，第 3 轮之前服务端只有单行删除；
 *   - 打不开批量端点时（旧部署）退回逐条 `DELETE /memory/messages/{id}`；
 *   - **不能**用 `DELETE /memory`：那是"清除全部记忆"（含摘要、建议、画像），
 *     语义完全不同；也不能用 `PUT /memory` 全量快照，那会把服务端在对话里
 *     自动沉淀的摘要与建议抹掉。
 * 删完一律回读 `GET /memory` 以服务端为准刷新，不留乐观脏数据。
 *
 * @returns {Promise<{attempted: number, failed: number, refreshed: boolean}>}
 */
export async function clearConversation() {
  const ids = readMemory()
    .messages.map((item) => String((item && item.id) || ''))
    .filter(Boolean);
  // 先排空既有写队列：否则队列里的整份快照会把这些行又写回来。
  await flushWrites();
  cache.memory = Object.assign(readMemory(), { messages: [] });

  let failed = 0;
  try {
    await api.del('/memory/messages');
  } catch (error) {
    // 旧部署没有批量端点：退回逐条删除，行为与代价和以前一致。
    for (const id of ids) {
      try {
        await api.del(`/memory/messages/${encodeURIComponent(id)}`);
      } catch (rowError) {
        failed += 1;
      }
    }
  }

  let refreshed = false;
  try {
    const fresh = await api.get('/memory');
    if (fresh && typeof fresh === 'object') {
      cache.memory = Object.assign(readMemory(), fresh);
      refreshed = true;
    }
  } catch (error) {
    // 回读失败：保留乐观空态，由调用方按 failed 提示用户"可能还在"。
  }
  return { attempted: ids.length, failed, refreshed };
}

/** 给记忆页用的汇总视角。 */
export function memoryOverview() {
  const memory = readMemory();
  return {
    profile: memory.profile || {},
    profileUsable: isProfileUsable(memory.profile),
    summaries: memory.summaries,
    advice: memory.advice,
    messages: memory.messages,
    usage: {
      used: memory.summaries.length + memory.advice.length,
      messages: memory.messages.length,
      maxMessages: MAX_MESSAGES,
    },
  };
}
