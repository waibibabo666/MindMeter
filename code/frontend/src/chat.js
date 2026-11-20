/**
 * L-05 对话逻辑（纯函数，零 DOM，可单测）。
 *
 * 页面 pages/chat.js 只负责渲染；这里负责三件事：
 *   - buildFacts：把最近一次 session（L-02 计分结果 + 原始指标）压成
 *     Agent 需要的 facts，数字全部进白名单（分数 + 指标都能被引用）；
 *   - toHistory：把存储里的消息规整成 Agent 历史（role/content）；
 *   - makeMessage：生成带 id/时间戳的消息记录，落 storage 的 20 条环形队列。
 */

/**
 * 由最近一次 session 构造 facts。
 * @param {{scores?: Record<string, number>, results?: Record<string, {metrics?: object}>}} session
 * @returns {Record<string, object>} 形如 { vc: { correct, total, ..., score } }
 */
export function buildFacts(session) {
  const scores = session?.scores || {};
  const results = session?.results || {};
  const facts = {};

  for (const [id, payload] of Object.entries(results)) {
    const metrics = payload?.metrics;
    if (!metrics || typeof metrics !== 'object') continue;
    facts[id] = { ...metrics };
    if (typeof scores[id] === 'number') {
      facts[id].score = scores[id];
    }
  }
  return facts;
}

/**
 * 存储消息 → Agent 历史。只保留 role/content，最近 limit 条。
 * @param {Array<{role: string, content: string}>} messages
 * @param {number} [limit]
 */
export function toHistory(messages = [], limit = 6) {
  if (!Array.isArray(messages)) return [];
  return messages.slice(-limit).map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: String(item?.content || ''),
  }));
}

let seq = 0;

/**
 * 生成一条待存储的消息。
 * @param {'user'|'assistant'} role
 * @param {string} content
 * @param {object} [meta] 附加字段（source / citations / code）
 */
export function makeMessage(role, content, meta = {}) {
  seq += 1;
  return {
    id: `msg_${Date.now().toString(36)}_${seq}`,
    role: role === 'assistant' ? 'assistant' : 'user',
    content: String(content || ''),
    at: Date.now(),
    ...meta,
  };
}

/**
 * L-07 记忆 → L-05 prompt 上下文。
 * 只带已确认画像；未确认的偏好绝不进入 prompt。
 * @param {object} memory readMemory() 的返回值
 * @param {(profile: object) => boolean} usable 画像可用性判断（默认 isProfileUsable）
 */
export function memoryContext(memory, usable) {
  const isUsable = usable || ((profile) => Boolean(profile?.confirmed));
  const summaries = memory?.summaries || [];
  const latest = summaries[summaries.length - 1];
  return {
    profile: isUsable(memory?.profile) ? memory.profile : null,
    summaryText: latest?.text || null,
    advice: (memory?.advice || []).slice(-5),
  };
}

/**
 * 从 Agent 回复里挑出需要落「建议记录」的知识块。
 * 只有模型真正生成（source=llm）且引用了 plan 类知识块才算展示过建议。
 * @returns {Array<{id: string, title: string}>}
 */
export function adviceFromReply(reply) {
  if (reply?.source !== 'llm') return [];
  return (reply.sources || [])
    .filter((item) => String(item?.id || '').startsWith('kb-plan'))
    .map((item) => ({ id: item.id, title: item.title }));
}

/**
 * 预置提问中继：趋势页等入口跳转 /chat 时带一个一次性问题，对话页渲染时
 * 取走并自动发送一次。SPA 内存级、一次性消费，重启后自然消失，不入存储。
 */
let pendingQuestion = '';

export function setPendingQuestion(text) {
  pendingQuestion = String(text || '');
}

export function takePendingQuestion() {
  const question = pendingQuestion;
  pendingQuestion = '';
  return question;
}
