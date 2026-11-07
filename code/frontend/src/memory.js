/**
 * L-07 本地记忆：画像 / 摘要 / 建议记录 / 最近 20 条消息。
 *
 * 存储层（storage.js）已经提供读写与 20 条上限，这里只补业务规则：
 *   - 画像必须由用户确认才写入，未确认前 Agent 不得引用；
 *   - 摘要由一次测评生成，只记录最低项与建议数量，不写能力评价；
 *   - 每条记忆可单独删除，删除后不再被引用；
 *   - 提供按类型删除与清空，供记忆页与设置页使用。
 */

import { MAX_MESSAGES, addSummary, clearMemory, readMemory, writeMemory } from './storage.js';
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

/** 用户确认画像后才落库；未确认一律不写。 */
export function confirmProfile(profile) {
  const clean = {};
  PROFILE_KEYS.forEach((key) => {
    clean[key] = String(profile?.[key] || '').trim();
  });
  if (!PROFILE_KEYS.some((key) => clean[key])) return null;
  const next = { ...clean, confirmed: true, confirmedAt: Date.now() };
  writeMemory({ profile: next });
  return next;
}

/** 忽略待确认画像：清掉未确认内容，避免下一轮又被提起。 */
export function dismissProfile() {
  writeMemory({ profile: {} });
}

/** 记录一条建议展示；重复的建议 ID 只保留最新一条。 */
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
  const rest = memory.advice.filter((item) => item.id !== entry.id);
  writeMemory({ advice: [...rest, entry] });
  return entry;
}

/** 标记建议已完成 / 取消完成。 */
export function setAdviceDone(id, done) {
  const memory = readMemory();
  const next = memory.advice.map((item) =>
    item.id === id ? { ...item, done: Boolean(done) } : item,
  );
  writeMemory({ advice: next });
  return next;
}

/** 按类型删除一条记忆：summary / advice / message。 */
export function removeMemory(kind, id) {
  const memory = readMemory();
  if (kind === 'summary') {
    writeMemory({ summaries: memory.summaries.filter((item) => item.id !== id) });
  } else if (kind === 'advice') {
    writeMemory({ advice: memory.advice.filter((item) => item.id !== id) });
  } else if (kind === 'message') {
    writeMemory({ messages: memory.messages.filter((item) => item.id !== id) });
  }
  return readMemory();
}

/** 清空全部记忆（画像/摘要/建议/消息），设置页的「清除记忆」用它。 */
export function clearAllMemory() {
  clearMemory();
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
