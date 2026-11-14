import { el, button } from '../ui.js';
import { api } from '../api.js';
import { readSessions, readSettings } from '../storage.js';
import { DIMS } from '../data.js';
import { scoreSession, SCORING_VERSION } from '../scoring/index.js';
import { ciHalfWidth, specFor, timedCi } from '../scoring/levels.js';
import { ageBand, ageNote, readProfile, stateWarning } from '../profile.js';
import { buildRadar, radarMarkup, animateRadar } from '../charts/radar.js';

const STATUS = {
  vc: (m) => `正确 ${m.correct} / ${m.total}`,
  ps: (m) => `完成 ${m.trials} 题 · 正确 ${m.correct} · 错误 ${m.wrong}`,
  sv: (m) => `正确 ${m.correct} / ${m.total}`,
  am: (m) => `命中 ${m.hits} · 虚报 ${m.falseAlarms}`,
};

const DETAIL = {
  vc: (m) => `正确率 ${fmtPct(m.accuracy)} · 平均反应时 ${fmtMs(m.meanRtMs)}`,
  ps: (m) => `${m.seconds} 秒内 · 平均反应时 ${fmtMs(m.meanRtMs)}`,
  sv: (m) => `正确率 ${fmtPct(m.accuracy)}`,
  am: (m) => `正确率 ${fmtPct(m.accuracy)} · 漏报 ${m.misses}`,
};

function fmtPct(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

function fmtMs(value) {
  return typeof value === 'number' ? `${value} ms` : '—';
}

function describe(id, metrics) {
  if (!metrics || !STATUS[id] || !DETAIL[id]) return '—';
  return `${STATUS[id](metrics)} · ${DETAIL[id](metrics)}`;
}

/** 该维度的 95% 区间半宽；限时维度用经验表。 */
function ciFor(dimId, score, payload, level) {
  if (dimId === 'ps' || dimId === 'vf') return timedCi(dimId, specFor(level, dimId).seconds);
  const metrics = (payload && payload.metrics) || {};
  const n = Number(metrics.total) || Number(metrics.trials) || 0;
  return ciHalfWidth(score, n, 0.25);
}

function reportRows(scored, results, level) {
  return DIMS.map((dim) => {
    const score = scored.scores[dim.id];
    const has = typeof score === 'number';
    const payload = results[dim.id];
    const ci = has ? ciFor(dim.id, score, payload, level) : null;
    return el('tr', { class: has ? '' : 'untested' }, [
      el('th', { scope: 'row', text: dim.name }),
      el('td', { class: 'score-cell' }, [
        el('span', { text: has ? String(score) : '未测' }),
        ci === null ? null : el('span', { class: 'ci', text: ` ±${ci}` }),
      ]),
      el('td', {
        class: 'muted',
        text: has ? describe(dim.id, payload?.metrics) : '本档未包含',
      }),
    ]);
  });
}

function reportScores(ctx, latest, results) {
  if (ctx.state.scores && Object.keys(ctx.state.scores).length > 0) {
    return { version: SCORING_VERSION, scores: ctx.state.scores };
  }
  if (latest && latest.scores) {
    return { version: SCORING_VERSION, scores: latest.scores };
  }
  return safeScore(results, ctx);
}

function emptyReport(ctx) {
  return [
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '还没有结果' }),
      el('p', {
        class: 'muted',
        text: '完成一次测评后，这里会显示 8 个维度、分数区间与原始指标。',
      }),
      button('开始测评', () => ctx.go('/tier'), { variant: 'primary' }),
    ]),
  ];
}

function radarCard(radar) {
  const holder = el('div', { class: 'radar', html: radarMarkup(radar) });
  animateRadar(holder.querySelector('svg'), radar);
  return el('div', { class: 'card radar-card' }, [
    holder,
    el('p', { class: 'tiny center', text: '雷达只连已测维度；未测维度留空，不按 0 计。' }),
  ]);
}

function scoreTable(rows) {
  return el('table', { class: 'report-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col', text: '维度' }),
        el('th', { scope: 'col', text: '分数' }),
        el('th', { scope: 'col', text: '原始指标' }),
      ]),
    ]),
    el('tbody', {}, rows),
  ]);
}

function scoreNote() {
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '分数怎么来的' }),
    el('p', {
      class: 'muted',
      text: `当前分数由本机服务端按 ${SCORING_VERSION} 折算（0–100），题量按本壳实际题数缩放；分数只代表本次任务表现。`,
    }),
    el('p', {
      class: 'tiny',
      text: '分数只代表本次任务表现，非常模、非百分位，不能读成“超过多少人”。',
    }),
  ]);
}

function reportActions(ctx) {
  return el('div', { class: 'row' }, [
    button('问问 AI', () => ctx.go('/chat'), { variant: 'primary' }),
    button('查看趋势', () => ctx.go('/trend'), { variant: 'ghost' }),
    button('再测一次', () => ctx.go('/tier'), { variant: 'ghost' }),
  ]);
}

/** 状态与年龄提示：只解释结果，不改分数。 */
function contextCard() {
  const profile = readProfile();
  const warn = stateWarning(profile);
  const note = ageNote(profile.age);
  if (!warn && !note && !profile.age) return null;

  const bits = [];
  if (profile.age) bits.push(`${profile.age} 岁（${ageBand(profile.age)}）`);
  if (profile.sleep) bits.push('睡眠已记录');

  return el('div', { class: `card${warn ? ' card-warn' : ''}` }, [
    el('h2', { class: 'card-title', text: '解读提示' }),
    bits.length ? el('p', { class: 'tiny', text: bits.join(' · ') }) : null,
    warn ? el('p', { class: 'muted', text: warn }) : null,
    note ? el('p', { class: 'muted', text: note }) : null,
    el('p', { class: 'tiny', text: '这些信息只用于解释结果，不参与计分。' }),
  ]);
}

function fullReport(ctx, results, scored, radar, assessmentId, level) {
  return [
    el('p', {
      class: 'lead',
      text: `8 个维度中测了 ${radar.measuredCount} 个，其余 ${radar.total - radar.measuredCount} 个显示「未测」。不设总分，也不做百分位。`,
    }),
    contextCard(),
    radarCard(radar),
    scoreTable(reportRows(scored, results, level)),
    renderAiCard(ctx, assessmentId),
    scoreNote(),
    reportActions(ctx),
  ];
}

/** 计分或雷达失败时退回「全部未测」的报告，而不是整页报错。 */
function safeScore(results, ctx) {
  try {
    return scoreSession(results);
  } catch (error) {
    if (ctx && typeof ctx.log === 'function')
      ctx.log('error', 'score failed', error && error.message);
    const scores = {};
    for (const dim of DIMS) scores[dim.id] = null;
    return { version: SCORING_VERSION, scores, measured: [], missing: DIMS.map((d) => d.id) };
  }
}

export function renderReport(root, ctx) {
  const latest = (readSessions().sessions || [])[0];
  const results =
    Object.keys(ctx.state.results || {}).length > 0
      ? ctx.state.results
      : (latest && latest.results) || {};
  const measured = Object.keys(results);
  const level = ctx.state.level || (latest && latest.level) || 'standard';
  const scored = reportScores(ctx, latest, results);
  const radar = buildRadar(DIMS, scored.scores || {});
  const assessmentId = ctx.state.assessmentId || (latest && latest.id) || null;
  const body =
    measured.length === 0
      ? emptyReport(ctx)
      : fullReport(ctx, results, scored, radar, assessmentId, level);

  root.appendChild(
    el('section', { class: 'page page-report', 'aria-labelledby': 'report-title' }, [
      el('p', { class: 'kicker', text: '你的结果' }),
      el('h1', { id: 'report-title', class: 'page-title', text: '本次测评' }),
      ...body,
      el('div', { class: 'card' }, [
        el('h2', { class: 'card-title', text: '局限与说明' }),
        el('p', {
          class: 'muted',
          text: '分数只描述本次任务中的表现：无总分、无百分位、不与人群比较；本产品不是医疗器械，不提供诊断、治疗或医疗建议。',
        }),
        el('p', { class: 'tiny' }, [
          '完整口径、计分依据与 AI 边界见 ',
          el('a', { class: 'link', href: '#/about', text: '说明' }),
          '。',
        ]),
      ]),
    ]),
  );
}

/** AI 解读卡片：后端调用模型；任何异常都显示模板结果。 */
function renderAiCard(ctx, assessmentId) {
  const badge = el('span', { class: 'pill', text: '未生成' });
  const reason = el('p', {
    class: 'tiny',
    text: '默认用模板解读；在设置里配置自己的模型服务后可切换。',
  });
  const output = el('p', { class: 'ai-text', text: '' });

  const runExplain = async () => {
    if (!assessmentId) {
      reason.textContent = '请先完成并保存一次测评。';
      return;
    }
    run.disabled = true;
    badge.textContent = '生成中';
    reason.textContent = '';
    try {
      const result = await api.post(`/reports/${encodeURIComponent(assessmentId)}/explain`);
      output.textContent = result.text;
      badge.textContent = result.source === 'llm' ? 'LLM' : '模板';
      badge.className = `pill ${result.source === 'llm' ? 'hi' : 'mid'}`;
      reason.textContent =
        result.source === 'llm'
          ? '由你配置的模型生成，内容仅供参考。'
          : '未配置 AI 或模型不可用，已用模板解读';
    } catch {
      // 本地服务不可用也保留卡片，重试是用户的下一步动作。
      reason.textContent = '本地服务不可用，暂时无法生成解读。';
    } finally {
      run.disabled = false;
    }
  };

  const run = button('生成解读', () => runExplain(), { variant: 'ghost' });

  // 没配 Key 时模板解读是本机即时返回的，直接显示，别让用户面对空白卡片。
  if (!readSettings().hasKey) runExplain();

  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title' }, ['AI 解读 ', badge]),
    reason,
    output,
    el('div', { class: 'row' }, [
      run,
      button('去设置', () => ctx.go('/settings'), { variant: 'ghost' }),
    ]),
  ]);
}
