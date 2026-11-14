/**
 * L-05 对话页（/chat）。
 *
 * 只做三件事：渲染消息、把问题交给本地 /api/v1/chat、用返回的消息刷新。
 * 所有安全规则（意图分类、禁用词、数字溯源、引用、回退模板）都在后端
 * LangGraph Agent 里，这里不重复实现。
 */

import { button, el, emptyState } from '../ui.js';
import { api } from '../api.js';
import { cache } from '../cache.js';
import { readMemory, readSessions, readSettings } from '../storage.js';
import { buildFacts, takePendingQuestion } from '../chat.js';

function fmtTime(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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

const LLM_FALLBACK_REASON = {
  timeout: '模型响应超时',
  auth: 'Key 无效或没有该模型权限',
  rate_limit: '触发限流',
  http: '模型服务返回错误',
  network: '本机无法连接模型服务',
  bad_response: '模型响应格式异常',
  truncated: '模型输出被截断',
  unknown: '模型服务异常',
};

function fallbackReasonNode(message) {
  if (message.source !== 'template') return null;
  const code = String(message.code || '');
  if (!code || code === 'not_configured' || code === 'no_knowledge') return null;
  if (code.startsWith('intent:') || code === 'pii_blocked') return null;
  if (code.startsWith('invalid')) {
    return el('p', { class: 'tiny', text: '已回退模板：模型输出未通过校验' });
  }
  return el('p', {
    class: 'tiny',
    text: `已回退模板：${LLM_FALLBACK_REASON[code] || code}`,
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
    ? '已保存 Key，但 AI 解读未启用或缺少 endpoint / 模型名；当前回答来自本地模板。'
    : '未配置模型密钥：对话仍可用，但回答来自本地模板（只复述原始指标）。';
  return el('div', { class: 'card' }, [
    el('p', { class: 'tiny', text }),
    button('去设置', () => ctx.go('/settings'), { variant: 'ghost' }),
  ]);
}

function emptyChat() {
  return emptyState({
    title: '还没有对话',
    text: '可以问「为什么联想记忆低」「知觉速度怎么练」。回答只依据本次结果和本地知识库，并标注来源。',
    hint: 'Enter 发送，Shift+Enter 换行；对话只保留最近 20 条。',
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
  const list = el('div', { class: 'chat-list' }, messages.map(messageNode));

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
  let slowTimer = null;

  async function onSend() {
    const question = String(input.value || '').trim();
    if (!question) return;

    input.value = '';
    autoGrow();
    send.disabled = true;
    send.textContent = '…';
    status.textContent = '正在检索本地知识库并组织回答…';
    slowTimer = setTimeout(() => {
      status.textContent = '仍在处理中：本地检索或模型响应较慢，请稍等…';
    }, 5000);

    let failed = false;
    try {
      const result = await api.post('/chat', { question }, { timeoutMs: 60000 });
      cache.memory.messages = Array.isArray(result.messages) ? result.messages : [];
      // eslint-disable-next-line sonarjs/no-ignored-exceptions
    } catch (error) {
      failed = true;
      // 失败时把问题放回输入框，用户可以直接重发，不用重新打字。
      ctx.toast('本地服务不可用，消息没有发送，可以直接重发');
    } finally {
      if (slowTimer) clearTimeout(slowTimer);
      send.disabled = false;
      send.textContent = '发送';
      status.textContent = '';
      root.replaceChildren();
      // 重新渲染会重建 textarea，草稿要一起带回去。
      renderChat(root, ctx, { restored: true, draft: failed ? question : '' });
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

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'chat-title' }, [
      el('p', { class: 'kicker', text: '问问 AI' }),
      el('h1', { id: 'chat-title', class: 'page-title', text: '对话' }),
      configBanner(ctx, settings),
      messages.length === 0 ? emptyChat() : list,
      el('div', { class: 'row' }, [input, send]),
      status,
      el('div', { class: 'row' }, [
        button('返回报告', () => ctx.go('/report'), { variant: 'ghost' }),
        button('我的记忆', () => ctx.go('/memory'), { variant: 'ghost' }),
      ]),
      el('p', {
        class: 'disclaimer',
        text: 'AI 生成 · 仅解释本次结果 · 非诊断 · 对话只保留最近 20 条（本机数据库）· 不要把手机号/身份证号等敏感信息发进来；配置模型后问题会发送给你选择的模型服务',
      }),
    ]),
  );

  // 发送失败后把原问题放回输入框（重新渲染会重建 textarea）。
  if (opts.draft) {
    input.value = opts.draft;
    autoGrow();
  }

  // 发完消息后回到输入框、并把最新一条滚进视野；首次进入有记录时也滚到底部。
  if (restored || messages.length > 0) {
    autoGrow();
    if (restored && hasFacts) input.focus();
    const lastMessage = root.querySelector('.chat-list > :last-child');
    if (lastMessage) lastMessage.scrollIntoView({ block: 'nearest' });
  }

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
