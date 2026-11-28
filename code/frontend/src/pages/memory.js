/**
 * L-07 记忆页：画像 / 摘要 / 建议记录 / 对话条数。
 *
 * 读写本账号的服务端数据（同源 API）；删除后不再被引用。
 */

import { button, el, emptyState, hint, titled } from '../ui.js';
import { api } from '../api.js';
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

/* 悬浮解释（反馈 2）：板块名留在页面上，长句收进浮框。
   反馈 3 · 模式 1/2：浮框与空态文案不再互相复述——同一条信息只说一遍，
   空态只留"这里还没有 X"，解释归浮框；影响决策的规则句仍然常驻页面。 */
const TIP_PROFILE =
  '画像来自对话里提到的备考、作息与时间安排，只是线索；必须由你确认后 AI 才会引用，用来决定建议的详略，不确认则一直不写入。';
const TIP_SUMMARY = '每次测评可生成一条，只记录最低项和建议数量，不写能力评价。';
const TIP_ADVICE = 'AI 引用练习类知识块给出建议后，会在这里留下一条，方便你打勾完成或删除。';
const TIP_MESSAGES =
  '想整份清空对话，去「对话」页用「清空对话」按钮：那里只删对话记录，本页的摘要与建议记录都会保留。';

/* 条目操作按钮：样式在 app.css 的 .mem-action（字号一律走全站刻度，不在页面里硬编码）。 */

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')}`;
}

function actionButton(label, onClick) {
  return el('button', { type: 'button', class: 'mem-action', text: label, onclick: onClick });
}

/**
 * 一条记忆：文字行（正文用正常正文色，日期留在次要色）+ 独立的操作行。
 * 人工测试反馈：条目正文曾是浅灰看不清，且按钮跟在长句尾端像句子的一部分。
 */
function memoryEntry(dateText, bodyText, actions) {
  return el('div', { class: 'mem-entry' }, [
    el('div', { class: 'kv-row' }, [
      el('span', { class: 'kv-key', text: dateText }),
      el('span', { class: 'kv-value', text: bodyText }),
    ]),
    actions.length ? el('div', { class: 'row' }, actions) : null,
  ]);
}

const TIP_MIND =
  '由你最近一次测评（和与上一次的变化）按规则得出，AI 回答时以它为主线；只描述这次任务里呈现的倾向，不是能力定级，也不与人群比较。';

/** agent 对你心智状态的理解：先放空壳，数据回来后再填，不阻塞页面。 */
function mindCard(ctx) {
  const body = el('div', {}, [el('p', { class: 'muted', text: '正在读取…' })]);
  const card = el('div', { class: 'card' }, [titled('h2', 'AI 眼中的你', TIP_MIND), body]);
  api
    .get('/memory/mind-profile')
    .then((data) => {
      body.replaceChildren();
      if (!data || !data.lines || data.lines.length === 0) {
        body.appendChild(
          emptyState({
            title: '还不了解你的心智状态',
            text: '完成一次测评后，这里会写出 AI 对你这次心智形态的理解。',
            actionLabel: '去测评',
            onAction: () => ctx.go('/tier'),
            art: false,
          }),
        );
        return;
      }
      body.appendChild(el('h3', { text: data.headline }));
      data.lines.forEach((line) => body.appendChild(el('p', { text: line })));
    })
    .catch(() => {
      body.replaceChildren(el('p', { class: 'muted', text: '暂时读不到，稍后刷新再试。' }));
    });
  return card;
}

function profileCard(view, ctx, rerender) {
  const profile = view.profile || {};
  const hasDraft = PROFILE_KEYS.some((key) => String(profile[key] || '').trim());
  const card = el('div', { class: 'card' }, [titled('h2', '画像', TIP_PROFILE)]);

  if (!hasDraft) {
    card.appendChild(
      emptyState({
        title: '还没有画像',
        text: '在对话里说出你的目标、偏好或时间安排，系统会先生成草稿；你确认后才写入，AI 也才会引用。',
        actionLabel: '去对话里聊聊',
        onAction: () => ctx.go('/chat'),
      }),
    );
    card.appendChild(
      el('p', {
        class: 'tiny',
        text: '例如：「我想在两周内提升言语理解，每天只有30分钟」。发出去之后，回答下面会出现「画像草稿」。',
      }),
    );
    return card;
  }

  // 「待确认」会左右用户点不点确认保存，必须留在页面上，不能收进浮框。
  card.appendChild(
    el('p', {
      class: 'muted',
      text: view.profileUsable ? '已确认，可被引用' : '画像需要确认：AI 暂不引用',
    }),
  );

  PROFILE_KEYS.forEach((key) => {
    const value = String(profile[key] || '').trim();
    if (!value) return;
    card.appendChild(
      el('div', { class: 'kv-row' }, [
        el('span', { class: 'kv-key', text: FIELD_LABEL[key] }),
        el('span', { class: 'kv-value', text: value }),
      ]),
    );
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
  const card = el('div', { class: 'card' }, [titled('h2', '摘要', TIP_SUMMARY)]);

  if (view.summaries.length === 0) {
    card.appendChild(
      emptyState({
        title: '还没有摘要',
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
        memoryEntry(fmtDate(item.at), item.text, [
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
  const card = el('div', { class: 'card' }, [titled('h2', '建议记录', TIP_ADVICE)]);

  if (view.advice.length === 0) {
    card.appendChild(
      emptyState({
        title: '还没有建议记录',
        actionLabel: '去对话',
        onAction: () => ctx.go('/chat'),
        art: false,
      }),
    );
    return card;
  }

  view.advice.forEach((item) => {
    card.appendChild(
      memoryEntry(fmtDate(item.at), item.title || item.id, [
        actionButton(item.done ? '已完成' : '标记完成', () => {
          setAdviceDone(item.id, !item.done);
          rerender();
        }),
        actionButton('删除', () => {
          removeMemory('advice', item.id);
          rerender();
        }),
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
    mindCard(ctx),
    profileCard(view, ctx, rerender),
    summaryCard(view, ctx, rerender),
    adviceCard(view, ctx, rerender),
    el('div', { class: 'card' }, [
      titled('h2', '对话记录', TIP_MESSAGES),
      el('p', {
        class: 'tiny',
        text: `保留最近 ${view.usage.maxMessages} 条，当前 ${view.usage.messages} 条。`,
      }),
    ]),
    el('div', { class: 'row' }, [
      button(
        '清除全部记忆',
        () => {
          if (!window.confirm('清除本账号全部记忆？删除后 AI 不会再引用。')) return;
          clearAllMemory();
          ctx.toast('已清除本账号记忆');
          rerender();
        },
        { variant: 'danger' },
      ),
      button('返回', () => ctx.go('/report'), { variant: 'ghost' }),
    ]),
    el('p', { class: 'disclaimer' }, [
      '这些信息只属于当前账号，删除后 AI 不会再引用。',
      hint(
        '「清除本账号数据」（设置页）会一并删除记忆；注销账号则立即级联删除全部数据，不可恢复。',
        {
          edge: true,
        },
      ),
    ]),
  ]);

  root.appendChild(page);
}
