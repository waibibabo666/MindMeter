/**
 * L-05 对话页（/chat）。
 *
 * 只做三件事：渲染消息、把问题交给 agent/run.js、把双方消息落到
 * storage 的 20 条队列。所有安全规则（意图分类、禁用词、数字溯源、
 * 引用、回退模板）都在 agent 层，这里不重复实现。
 */

import { button, el } from '../ui.js';
import { addMessage, readMemory, readSessions, readSettings } from '../storage.js';
import { isConfigured } from '../llm/client.js';
import { answer } from '../agent/run.js';
import { adviceFromReply, buildFacts, makeMessage, memoryContext, toHistory } from '../chat.js';
import { isProfileUsable, recordAdvice } from '../memory.js';

/** 模型真正引用了 plan 类知识块时，落一条建议记录（L-07 建议记录闭环）。 */
function recordAdviceFromReply(reply) {
  adviceFromReply(reply).forEach((item) => recordAdvice(item));
}

function fmtTime(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function citationsLine(citations) {
  if (!Array.isArray(citations) || citations.length === 0) return null;
  return el('p', { class: 'tiny', text: `引用：${citations.join(' · ')}` });
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
    text: message.source === 'llm' ? 'AI' : '模板',
  });
  return el('div', { class: 'card chat-ai' }, [
    el('div', { class: 'row' }, [pill, el('span', { class: 'tiny', text: fmtTime(message.at) })]),
    el('p', { class: 'ai-text', text: message.content }),
    citationsLine(message.citations),
  ]);
}

function configBanner(ctx, settings) {
  if (isConfigured(settings) && settings.enabled) return null;
  return el('div', { class: 'card' }, [
    el('p', {
      class: 'tiny',
      text: '未配置模型密钥：对话仍可用，但回答来自本地模板（只复述原始指标）。',
    }),
    button('去设置', () => ctx.go('/settings'), { variant: 'ghost' }),
  ]);
}

function emptyCard() {
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '还没有对话' }),
    el('p', {
      class: 'muted',
      text: '可以问「为什么联想记忆低」「知觉速度怎么练」。回答只依据本次结果和本地知识库，并标注来源。',
    }),
  ]);
}

export function renderChat(root, ctx) {
  const settings = readSettings();
  const sessions = readSessions().sessions || [];
  const facts = buildFacts(sessions[0]);
  const hasFacts = Object.keys(facts).length > 0;

  const messages = readMemory().messages || [];
  const list = el('div', { class: 'chat-list' }, messages.map(messageNode));

  const input = el('input', {
    class: 'input',
    type: 'text',
    placeholder: hasFacts ? '问问这次的结果…' : '完成一次测评后才能针对结果提问',
    'aria-label': '输入问题',
    maxlength: '200',
  });

  const send = button('发送', null, { variant: 'primary' });

  async function onSend() {
    const question = String(input.value || '').trim();
    if (!question) return;

    const memory = readMemory();
    const history = toHistory(memory.messages || []);
    addMessage(makeMessage('user', question));
    input.value = '';
    send.disabled = true;
    send.textContent = '…';

    const reply = await answer({
      question,
      facts,
      history,
      settings,
      memory: memoryContext(memory, isProfileUsable),
    });
    recordAdviceFromReply(reply);
    addMessage(
      makeMessage('assistant', reply.text, {
        source: reply.source,
        citations: reply.citations,
        code: reply.code,
      }),
    );

    send.disabled = false;
    send.textContent = '发送';
    root.replaceChildren();
    renderChat(root, ctx);
  }

  send.addEventListener('click', onSend);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onSend();
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
      messages.length === 0 ? emptyCard() : list,
      el('div', { class: 'row' }, [input, send]),
      el('div', { class: 'row' }, [
        button('返回报告', () => ctx.go('/report'), { variant: 'ghost' }),
        button('我的记忆', () => ctx.go('/memory'), { variant: 'ghost' }),
      ]),
      el('p', {
        class: 'disclaimer',
        text: 'AI 生成 · 仅解释本次结果 · 非诊断 · 对话只保留最近 20 条（本机）',
      }),
    ]),
  );
}
