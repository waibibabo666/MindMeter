/**
 * L-05 对话页（/chat）。
 *
 * 只做三件事：渲染消息、把问题交给 /api/v1/chat、用返回的消息刷新。
 * 所有安全规则（意图分类、禁用词、数字溯源、引用、回退模板）都在后端
 * LangGraph Agent 里，这里不重复实现。
 *
 * 人工测试反馈 3 第 1 条（「没有清空对话的按钮，每次进入都要往下划」）：
 *   - 加「清空对话」入口（只删 messages，见 memory.js 的 clearConversation 注释）；
 *   - 消息流改成**有高度上限的滚动容器**，进入页面与每次发完都滚到底部；
 *   - 输入框那一块 sticky 在视口底部，历史再多也不用先找输入框。
 */

import { button, el, emptyState, hint } from '../ui.js';
import { api } from '../api.js';
import { cache } from '../cache.js';
import { clearConversation } from '../memory.js';
import { readMemory, readSessions, readSettings } from '../storage.js';
import { buildFacts, takePendingQuestion } from '../chat.js';

/* 反馈 2：口径解释收进浮框；高风险提示、回退原因、发送失败提示一律留在页面上。 */
const TIP_CHAT =
  '回答只依据这个账号最近的结果与知识库，并标注来源；对话只保留最近 20 条，更早的自动清掉。';

function fmtTime(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 把消息容器停在最后一条：进入页面、发完消息、等待气泡出现时都调用。 */
function scrollToListBottom(node) {
  if (node) node.scrollTop = node.scrollHeight;
}

function citationItems(citations) {
  if (!Array.isArray(citations)) return [];
  return citations
    .map((item) => (typeof item === 'string' ? { id: item } : item))
    .filter((item) => item && item.id);
}

function citationsLine(citations) {
  const items = citationItems(citations);
  if (items.length === 0) return null;
  const rows = items.map((item) => {
    const source = item.source && typeof item.source === 'object' ? item.source : {};
    const meta = [source.author, source.year, source.locator].filter(Boolean).join(' · ');
    return el('div', { class: 'citation-item' }, [
      el('p', { class: 'tiny', text: `${item.id} · ${item.title || ''}` }),
      meta ? el('p', { class: 'tiny muted', text: meta }) : null,
      item.text ? el('p', { class: 'tiny muted', text: String(item.text).slice(0, 180) }) : null,
      source.url
        ? el('a', {
            class: 'link tiny',
            href: String(source.url),
            target: '_blank',
            rel: 'noreferrer',
            text: '打开来源',
          })
        : null,
    ]);
  });
  return el('details', { class: 'citations' }, [
    el('summary', { class: 'tiny', text: `引用：${items.map((item) => item.id).join(' · ')}` }),
    ...rows,
  ]);
}

/**
 * 回退原因 → 用户能看懂的一句话（用户测试表 A5「拦截可理解」、A6「等待可感知」）。
 * 内部术语（invalid / unsourced_number / kb id）一律不出现在界面上。
 */
const LLM_FALLBACK_REASON = {
  timeout: '模型响应超时',
  auth: '模型服务拒绝了本次请求',
  rate_limit: '模型服务正忙，已限流',
  http: '模型服务返回异常',
  network: '无法连接模型服务',
  bad_response: '模型返回的内容无法解析',
  truncated: '模型回答被截断',
  unknown: '模型服务异常',
  // 校验层（服务端 _validate_node 返回的真实 hard issue code）
  too_long: '模型回答过长，已改用更稳的说法',
  banned_word: '模型用了不该用的措辞',
  unsourced_number: '模型提到了没有依据的数字',
  score_misattributed: '模型把分数说到了别的维度上',
  mechanism_speculation: '模型在编造指标背后的原因',
  empty: '模型没有给出内容',
  // citation_placeholder / citation_missing 是 soft（回答仍来自模型），
  // 不进这张表：fallbackReasonNode 只在 source==='template' 时出文案。
};

function fallbackReasonNode(message) {
  if (message.source !== 'template') return null;
  const code = String(message.code || '');
  if (!code || code === 'not_configured' || code === 'no_knowledge') return null;
  if (code.startsWith('intent:') || code === 'pii_blocked') return null;
  // 兼容旧值 invalid：后端已改为返回真实 code，这里只兜历史数据。
  const reason = LLM_FALLBACK_REASON[code] || (code === 'invalid' ? '模型回答未通过校验' : '');
  return el('p', {
    class: 'tiny fallback-reason',
    text: reason ? `离线回答（已改用模板）：${reason}` : '离线回答（已改用模板）',
  });
}

function sourceLabel(source) {
  if (source === 'llm') return 'AI';
  if (source === 'policy') return '规则';
  return '模板';
}

function riskNode(risk) {
  if (risk === 'high') {
    return el('p', {
      class: 'notice',
      role: 'status',
      text: '高风险提示：请优先参考医生、律师或其他持证专业人士的意见。',
    });
  }
  if (risk === 'medium') {
    return el('p', { class: 'tiny', text: '中风险提示 · 状态可能影响本次结果' });
  }
  return null;
}

function messageNode(message) {
  if (message.role === 'user') {
    return el('div', { class: 'card chat-user' }, [
      el('p', { text: message.content }),
      el('p', { class: 'tiny', text: fmtTime(message.at) }),
    ]);
  }
  const pill = el('span', {
    class: `pill ${message.source === 'llm' ? 'hi' : 'mid'}`,
    text: sourceLabel(message.source),
  });
  const risk = riskNode(message.risk);
  return el('div', { class: 'card chat-ai' }, [
    el('div', { class: 'row' }, [pill, el('span', { class: 'tiny', text: fmtTime(message.at) })]),
    risk,
    el('p', { class: 'ai-text', text: message.content }),
    fallbackReasonNode(message),
    citationsLine(message.citations),
  ]);
}

function configBanner(ctx, settings) {
  if (settings.enabled && settings.hasKey && settings.endpoint && settings.model) return null;
  const text = settings.hasKey
    ? '站点尚未完成模型配置；当前回答来自模板。'
    : '站点未配置模型：对话仍可用，但回答来自模板（只复述原始指标）。';
  return el('div', { class: 'card' }, [
    el('p', { class: 'tiny', text }),
    button('去设置', () => ctx.go('/settings'), { variant: 'ghost' }),
  ]);
}

/**
 * 画像草稿卡（反馈1：对话后记忆面板要能体现画像）。
 *
 * 服务端只回传线索、绝不代写画像（未确认不写是硬规矩），所以这里给一条
 * 明确的确认路径；用户不确认就永远只是草稿，也不会被 PUT 回服务端覆盖。
 */
function profileDraftCard(ctx, host) {
  const draft = cache.memory && cache.memory.profileDraft;
  if (!draft || typeof draft !== 'object') return null;
  const labels = { goal: '目标', preference: '偏好', constraint: '约束' };
  const bits = Object.keys(labels)
    .filter((key) => draft[key])
    .map((key) => `${labels[key]}：${draft[key]}`);
  if (!bits.length) return null;
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '画像草稿（来自这次对话）' }),
    el('p', { class: 'muted', text: bits.join(' · ') }),
    // 「不确认就不写入」决定用户点不点「去确认」，必须留在页面上。
    el('p', { class: 'tiny', text: '不确认就不会写入，AI 也不会引用它。' }),
    el('div', { class: 'row' }, [
      button('去确认', () => ctx.go('/memory'), { variant: 'primary' }),
      button(
        '不用了',
        () => {
          delete cache.memory.profileDraft;
          host.replaceChildren();
          renderChat(host, ctx, { restored: true });
        },
        { variant: 'ghost' },
      ),
    ]),
  ]);
}

function emptyChat() {
  // 「Enter 发送，Shift+Enter 换行」已经写在输入框的 placeholder 里，
  // 空态再复述一遍就是同一句话出现两次（反馈 3 · 模式 2）。
  return emptyState({
    title: '还没有对话',
    text: '可以问「为什么联想记忆低」「知觉速度怎么练」。',
  });
}

export function renderChat(root, ctx, options = {}) {
  // 路由没有 param 时会传 null，这里兜一下再读 options。
  const opts = options || {};
  const restored = Boolean(opts.restored);
  const settings = readSettings();
  const sessions = readSessions().sessions || [];
  const facts = buildFacts(sessions[0]);
  const hasFacts = Object.keys(facts).length > 0;

  const messages = readMemory().messages || [];
  // 空态也放进 .chat-list 里：这样"第一次提问"时等待气泡有地方落，
  // 不会出现"最需要反馈的时候反而没有反馈"。
  const list = el(
    'div',
    { class: 'chat-list' },
    messages.length ? messages.map(messageNode) : [emptyChat()],
  );
  // 反馈 3：消息流是一个有上限的滚动容器，整页不再被历史拉长。
  // 输入框那一块也放在容器里、sticky 在容器底边：滚到底时它是正文的最后一段
  // （不会有任何东西被它永久盖住），没滚到底时它钉在视口里始终看得见。
  const scroller = el('div', { class: 'chat-scroll' }, [list]);

  const input = el('textarea', {
    class: 'input chat-input',
    rows: '1',
    maxlength: '300',
    placeholder: hasFacts
      ? '问问这次的结果…（Enter 发送，Shift+Enter 换行）'
      : '完成一次测评后才能针对结果提问',
    'aria-label': '输入问题',
  });

  const autoGrow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(132, input.scrollHeight)}px`;
  };
  input.addEventListener('input', autoGrow);

  const send = button('发送', null, { variant: 'primary' });
  const status = el('p', {
    class: 'tiny',
    role: 'status',
    'aria-live': 'polite',
    text: '',
  });

  /* 反馈 3 第 1 条：清空对话的入口。
     走的是"逐条 DELETE /memory/messages/{id}"，只删 messages；为什么不用
     DELETE /memory / PUT /memory，理由与代价写在 memory.js 的 clearConversation 上。 */
  const clearButton = button(
    messages.length ? `清空对话（${messages.length}）` : '清空对话',
    onClearConversation,
    {
      variant: 'ghost',
      ariaLabel: '清空本账号的对话记录：只删对话，摘要、建议记录与画像都不删',
    },
  );
  clearButton.id = 'chat-clear';

  async function onClearConversation() {
    const count = (readMemory().messages || []).length;
    if (count === 0) {
      ctx.toast('对话已经是空的');
      return;
    }
    // 二次确认：复用记忆页/设置页的 window.confirm 模式，并把"删什么、留什么"当面说清。
    if (
      !window.confirm(`清空这 ${count} 条对话？只删对话记录，摘要、建议记录与画像都不会被删除。`)
    ) {
      return;
    }
    clearButton.disabled = true;
    send.disabled = true;
    status.textContent = '正在清空对话…';
    const result = await clearConversation();
    status.textContent = '';
    if (result.failed > 0) {
      ctx.toast(`有 ${result.failed} 条没能删除，刷新后可能还会出现`);
    } else if (!result.refreshed) {
      ctx.toast('对话已清空，但没能确认服务端状态；刷新后如仍在请再试一次');
    } else {
      ctx.toast(`已清空 ${result.attempted} 条对话，摘要与建议保留`);
    }
    // 删除后必须重渲染：cache.memory 已由 clearConversation 刷新，不留脏数据。
    root.replaceChildren();
    renderChat(root, ctx, { restored: true });
  }

  /* 等待可感知（用户测试表 A6）：一次请求分三个阶段说清楚，
     并在消息流里放一个真的在动的等待气泡，而不是只改一行小字。 */
  const STAGES = [
    { at: 0, text: '正在检索知识库…' },
    { at: 3000, text: '正在组织回答（模型思考中）…' },
    { at: 10000, text: '模型响应较慢；再等一会儿会自动改用离线模板回答…' },
  ];
  let stageTimers = [];

  function clearPending() {
    stageTimers.forEach((timer) => clearTimeout(timer));
    stageTimers = [];
    const stale = root.querySelector('.chat-pending');
    if (stale) stale.remove();
  }

  function showPending(question) {
    const listNode = root.querySelector('.chat-list');
    if (!listNode) return;
    clearPending();
    // 空态卡片在第一次提问时让位给真实消息
    const empty = listNode.querySelector('.empty-state');
    if (empty) empty.remove();
    // 先把用户这一句画出来，避免出现"发出去了但屏幕没反应"的空窗。
    listNode.appendChild(
      messageNode({ role: 'user', content: question, at: Date.now(), id: 'pending_user' }),
    );
    const bubble = el('div', { class: 'chat-pending', role: 'status', 'aria-live': 'polite' }, [
      el('span', { class: 'pending-dots', 'aria-hidden': 'true' }, [
        el('i', {}),
        el('i', {}),
        el('i', {}),
      ]),
      el('span', { class: 'pending-text', text: STAGES[0].text }),
    ]);
    listNode.appendChild(bubble);
    scrollToListBottom(scroller);
    stageTimers = STAGES.slice(1).map((stage) =>
      setTimeout(() => {
        const node = bubble.querySelector('.pending-text');
        if (node) node.textContent = stage.text;
      }, stage.at),
    );
  }

  async function onSend() {
    const question = String(input.value || '').trim();
    if (!question) return;

    input.value = '';
    autoGrow();
    send.disabled = true;
    // 发送与清空互斥：否则一次清空会把刚发出去的那条一起删掉。
    clearButton.disabled = true;
    send.textContent = '…';
    status.textContent = '';
    showPending(question);

    try {
      const result = await api.post('/chat', { question }, { timeoutMs: 60000 });
      cache.memory.messages = Array.isArray(result.messages) ? result.messages : [];
      // 对话会沉淀摘要与建议（服务端写库），这里直接采用服务端返回的那份，
      // 不再用整份快照 PUT 回去覆盖。
      if (result.memory) cache.memory = Object.assign(cache.memory, result.memory);
      if (result.profileSuggested) cache.memory.profileDraft = result.profileSuggested;
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (error) {
      // The page stays usable; the toast is the only recovery action here.
      ctx.toast('站点服务不可用，消息没有发送');
    } finally {
      clearPending();
      send.disabled = false;
      send.textContent = '发送';
      root.replaceChildren();
      renderChat(root, ctx, { restored: true });
    }
  }

  send.addEventListener('click', onSend);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    onSend();
  });

  if (!hasFacts) {
    input.disabled = true;
    send.disabled = true;
  }

  const composer = el('div', { class: 'chat-composer' }, [
    el('div', { class: 'row' }, [input, send]),
    status,
  ]);

  root.appendChild(
    el('section', { class: 'page page-chat', 'aria-labelledby': 'chat-title' }, [
      el('p', { class: 'kicker', text: '问问 AI' }),
      el('h1', { id: 'chat-title', class: 'page-title', text: '对话' }),
      configBanner(ctx, settings),
      el('div', { class: 'chat-toolbar' }, [
        clearButton,
        el('p', { class: 'tiny', text: '只删对话记录；摘要、建议记录与画像保留。' }),
      ]),
      scroller,
      profileDraftCard(ctx, root),
      el('div', { class: 'row' }, [
        button('返回报告', () => ctx.go('/report'), { variant: 'ghost' }),
        button('我的记忆', () => ctx.go('/memory'), { variant: 'ghost' }),
      ]),
      el('p', { class: 'disclaimer' }, [
        'AI 生成 · 仅解释本次结果 · 非诊断。提问会发送给站点配置的模型服务，不要把手机号、身份证号等敏感信息发进来。',
        hint(TIP_CHAT, { edge: true }),
      ]),
      composer,
    ]),
  );

  root.appendChild(
    el('section', { class: 'page page-chat', 'aria-labelledby': 'chat-title' }, [
      el('p', { class: 'kicker', text: '问问 AI' }),
      el('h1', { id: 'chat-title', class: 'page-title', text: '对话' }),
      configBanner(ctx, settings),
      el('div', { class: 'chat-toolbar' }, [
        clearButton,
        el('p', { class: 'tiny', text: '只删对话记录；摘要、建议记录与画像保留。' }),
      ]),
      scroller,
    ]),
  );

  // 反馈 3：进入页面就停在最后一条；发完消息（restored）同样回到底部并把光标放回输入框。
  autoGrow();
  scrollToListBottom(scroller);
  if (restored && hasFacts) input.focus({ preventScroll: true });

  // 趋势页等入口带过来的预置问题：进入页面自动发送一次（一次性消费）。
  const pending = takePendingQuestion();
  if (pending) {
    if (!input.disabled) {
      input.value = pending;
      autoGrow();
      onSend();
    } else {
      ctx.toast('完成一次测评后，Agent 才能针对结果回答');
    }
  }

  const onEscape = (event) => {
    if (event.key !== 'Escape') return;
    const open = root.querySelector('details[open]');
    if (!open) return;
    open.open = false;
    event.preventDefault();
  };
  root.onkeydown = onEscape;
  return () => {
    if (root.onkeydown === onEscape) root.onkeydown = null;
  };
}
