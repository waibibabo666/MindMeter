/**
 * L-07 记忆页：画像 / 摘要 / 建议记录 / 对话条数。
 *
 * 只读写本机数据库（通过 API），不联网；删除后不再被引用。
 */

import { button, el, emptyState } from '../ui.js';
import { readSessions } from '../storage.js';
import {
  PROFILE_KEYS,
  clearAllMemory,
  confirmProfile,
  dismissProfile,
  memoryOverview,
  removeMemory,
  saveSummary,
  setAdviceDone,
} from '../memory.js';

const FIELD_LABEL = { goal: '目标', preference: '偏好', constraint: '约束' };

const ACTION_STYLE =
  'background:none;border:0;padding:0 2px;color:#374151;text-decoration:underline;' +
  'font-size:11px;cursor:pointer';

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`;
}

function actionButton(label, onClick) {
  return el('button', { type: 'button', style: ACTION_STYLE, text: label, onclick: onClick });
}

function profileCard(view, ctx, rerender) {
  const profile = view.profile || {};
  const hasDraft = PROFILE_KEYS.some((key) => String(profile[key] || '').trim());
  const card = el('div', { class: 'card' }, [el('h2', { class: 'card-title', text: '画像' })]);

  if (!hasDraft) {
    card.appendChild(
      emptyState({
        title: '还没有画像',
        text: '画像只在你确认后才会被 AI 引用，用来决定建议的详略。',
        actionLabel: '去对话里聊聊',
        onAction: () => ctx.go('/chat'),
        hint: '在对话里提到备考、作息或时间安排，会生成一份待确认的画像草稿。',
      }),
    );
    return card;
  }

  card.appendChild(
    el('p', {
      class: 'tiny',
      text: view.profileUsable ? '已确认，可被引用' : '待确认，AI 暂不引用',
    }),
  );

  PROFILE_KEYS.forEach((key) => {
    const value = String(profile[key] || '').trim();
    if (!value) return;
    card.appendChild(el('p', { class: 'tiny', text: `${FIELD_LABEL[key]}：${value}` }));
  });

  if (!view.profileUsable) {
    card.appendChild(
      el('div', { class: 'row' }, [
        button(
          '确认保存',
          () => {
            confirmProfile(profile);
            rerender();
          },
          { variant: 'primary' },
        ),
        button(
          '忽略',
          () => {
            dismissProfile();
            rerender();
          },
          { variant: 'ghost' },
        ),
      ]),
    );
  }

  return card;
}

function summaryCard(view, ctx, rerender) {
  const card = el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '摘要' }),
    el('p', { class: 'muted', text: '每次测评可生成一条，只记录最低项和建议数量，不写能力评价。' }),
  ]);

  if (view.summaries.length === 0) {
    card.appendChild(
      emptyState({
        title: '还没有摘要',
        text: '每次测评可以生成一条摘要，只记录最低项和建议数量，不写能力评价。',
        art: false,
      }),
    );
    const sessions = readSessions().sessions || [];
    if (sessions.length > 0) {
      card.appendChild(
        button(
          '用最近一次测评生成',
          () => {
            const saved = saveSummary(sessions[0]);
            ctx.toast(saved ? '已生成摘要' : '这次测评没有可用分数');
            rerender();
          },
          { variant: 'ghost' },
        ),
      );
    }
    return card;
  }

  view.summaries
    .slice()
    .reverse()
    .forEach((item) => {
      card.appendChild(
        el('div', { class: 'row' }, [
          el('p', { class: 'tiny', text: `${fmtDate(item.at)} · ${item.text}` }),
          actionButton('删除', () => {
            removeMemory('summary', item.id);
            rerender();
          }),
        ]),
      );
    });

  return card;
}

function adviceCard(view, ctx, rerender) {
  const card = el('div', { class: 'card' }, [el('h2', { class: 'card-title', text: '建议记录' })]);

  if (view.advice.length === 0) {
    card.appendChild(
      emptyState({
        title: '还没有建议记录',
        text: 'AI 引用练习类知识块并给出建议后，会在这里留下一条记录，方便你打勾完成。',
        actionLabel: '去对话',
        onAction: () => ctx.go('/chat'),
        art: false,
      }),
    );
    return card;
  }

  view.advice.forEach((item) => {
    card.appendChild(
      el('div', { class: 'row' }, [
        el('p', { class: 'tiny', text: `${fmtDate(item.at)} · ${item.title || item.id}` }),
        el('div', { class: 'row' }, [
          actionButton(item.done ? '已完成' : '标记完成', () => {
            setAdviceDone(item.id, !item.done);
            rerender();
          }),
          actionButton('删除', () => {
            removeMemory('advice', item.id);
            rerender();
          }),
        ]),
      ]),
    );
  });

  return card;
}

export function renderMemory(root, ctx) {
  const rerender = () => {
    root.replaceChildren();
    renderMemory(root, ctx);
  };
  const view = memoryOverview();

  const page = el('section', { class: 'page', 'aria-labelledby': 'memory-title' }, [
    el('h1', { id: 'memory-title', class: 'page-title', text: '我的记忆' }),
    el('p', { class: 'muted', text: '这些信息只存在本机数据库；删除后 AI 不会再引用。' }),
    profileCard(view, ctx, rerender),
    summaryCard(view, ctx, rerender),
    adviceCard(view, ctx, rerender),
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '对话记录' }),
      el('p', {
        class: 'tiny',
        text: `保留最近 ${view.usage.maxMessages} 条，当前 ${view.usage.messages} 条。`,
      }),
    ]),
    el('div', { class: 'row' }, [
      button(
        '清除全部记忆',
        () => {
          if (!window.confirm('清除本机全部记忆？删除后 AI 不会再引用。')) return;
          clearAllMemory();
          ctx.toast('已清除本机记忆');
          rerender();
        },
        { variant: 'danger' },
      ),
      button('返回', () => ctx.go('/report'), { variant: 'ghost' }),
    ]),
    el('p', { class: 'disclaimer', text: '记忆只用于本机对话；清除本机数据会一并删除。' }),
  ]);

  root.appendChild(page);
}
