import { el, button, hint, titled } from '../ui.js';
import { api } from '../api.js';
import { readSessions, readSettings } from '../storage.js';
import { DIMS } from '../data.js';
import { scoreSession, SCORING_VERSION } from '../scoring/index.js';
import { ciHalfWidth, specFor, timedCi } from '../scoring/levels.js';
import { ageBand, ageNote, readProfile, stateWarning } from '../profile.js';
import { buildRadar, radarMarkup, animateRadar } from '../charts/radar.js';
import { compareBlock } from './trend.js';
import { iconSvg } from '../icons.js';

const STATUS = {
  vc: (m) => `正确 ${fmtNum(m.correct)} / ${fmtNum(m.total)}`,
  ps: (m) => `完成 ${fmtNum(m.trials)} 题 · 正确 ${fmtNum(m.correct)} · 错误 ${fmtNum(m.wrong)}`,
  sv: (m) => `正确 ${fmtNum(m.correct)} / ${fmtNum(m.total)}`,
  am: (m) => `一次点对 ${fmtNum(m.hits)}/${fmtNum(m.trials)} 组 · 重试 ${fmtNum(m.falseAlarms)} 次`,
};

const DETAIL = {
  vc: (m) => `正确率 ${fmtPct(m.accuracy)} · 平均反应时 ${fmtMs(m.meanRtMs)}`,
  ps: (m) => `${fmtNum(m.seconds)} 秒内 · 平均反应时 ${fmtMs(m.meanRtMs)}`,
  sv: (m) => `正确率 ${fmtPct(m.accuracy)}`,
  am: (m) => `目标 ${fmtNum(m.trials)} 组 · 重试 ${fmtNum(m.falseAlarms)} 次`,
};

function fmtPct(value) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';
}

function fmtMs(value) {
  return typeof value === 'number' ? `${value} ms` : '—';
}

/** 缺项的原始指标写「—」：界面上不许出现 undefined（旧记录/接口造的数据会缺字段）。 */
function fmtNum(value) {
  return typeof value === 'number' ? String(value) : '—';
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

/**
 * 八维表的行。
 *
 * 人工测试反馈 3 第 3 条（同类问题排查 · 模式 4）：只测了 4 项时，表里一半以上
 * 是「未测 / 本档未包含」的占位行，有效信息被稀释。现在已测行照常列出，
 * 未测维度**合并成一行可展开的折叠**——「未测显示为未测」这条口径仍然成立
 * （LIMITS 与说明页都要求它可见），但不再用 8 行灰字占满首屏。
 */
function untestedRow(dim) {
  return el('tr', { class: 'untested' }, [
    el('th', { scope: 'row', text: dim.name }),
    el('td', { class: 'score-cell' }, [el('span', { class: 'score-num', text: '未测' })]),
    el('td', { class: 'muted', text: '本档未包含' }),
  ]);
}

function untestedFold(rows) {
  const summary = el('summary', {
    class: 'tiny',
    text: `未测 ${rows.length} 项：${rows.map((row) => row.name).join(' · ')}`,
  });
  return el('tr', { class: 'untested-fold' }, [
    el('td', { colspan: '3' }, [
      el('details', {}, [
        summary,
        el(
          'ul',
          { class: 'plain-list' },
          rows.map((row) => el('li', { text: `${row.name}：本档未包含，不按 0 计。` })),
        ),
      ]),
    ]),
  ]);
}

function reportRows(scored, results, level) {
  const measured = [];
  const untested = [];
  for (const dim of DIMS) {
    const score = scored.scores[dim.id];
    if (typeof score !== 'number') {
      untested.push(dim);
      continue;
    }
    const payload = results[dim.id];
    const ci = ciFor(dim.id, score, payload, level);
    const width = Math.max(3, Math.min(100, score));
    measured.push(
      el('tr', {}, [
        el('th', { scope: 'row', text: dim.name }),
        el('td', { class: 'score-cell' }, [
          el('span', { class: 'score-num', text: String(score) }),
          ci === null ? null : el('span', { class: 'ci', text: ` ±${ci}` }),
          el('div', { class: 'gauge' }, [el('i', { style: `width:${width}%` })]),
        ]),
        el('td', { class: 'muted', text: describe(dim.id, payload?.metrics) }),
      ]),
    );
  }
  // 全测或全未测时不折叠：前者没有占位行，后者折叠起来反而更找不到。
  if (untested.length === 0) return measured;
  if (measured.length === 0) return untested.map(untestedRow);
  return [...measured, untestedFold(untested)];
}

function reportScores(ctx, latest, results, level) {
  if (ctx.state.scores && Object.keys(ctx.state.scores).length > 0) {
    return { version: SCORING_VERSION, scores: ctx.state.scores };
  }
  if (latest && latest.scores) {
    return { version: SCORING_VERSION, scores: latest.scores };
  }
  return safeScore(results, ctx, level);
}

function emptyReport(ctx) {
  return [
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '还没有结果' }),
      el('p', { class: 'muted', text: '完成一次测评后，这里会出现八维结果。' }),
      button('开始测评', () => ctx.go('/tier'), { variant: 'primary' }),
    ]),
  ];
}

function radarCard(radar) {
  const holder = el('div', { class: 'radar', html: radarMarkup(radar) });
  animateRadar(holder.querySelector('svg'), radar);
  return el('div', { class: 'card radar-card' }, [
    titled('h2', '能力雷达', '雷达只连已测维度；未测维度留空，不按 0 计，也不参与任何平均或排名。'),
    holder,
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
    titled(
      'h2',
      '分数怎么来的',
      `分数由服务端按 ${SCORING_VERSION} 把原始指标折算成 0–100，题量按本档实际题数缩放；只代表这次任务表现，非常模、非百分位，不能读成“超过多少人”。完整口径见「说明」。`,
    ),
  ]);
}

function reportActions(ctx) {
  return el('div', { class: 'row' }, [
    button('问问 AI', () => ctx.go('/chat'), { variant: 'primary' }),
    button('再测一次', () => ctx.go('/tier'), { variant: 'ghost' }),
  ]);
}

/** 记录读不出来时按「没有记录」处理，不把整页拖垮。 */
function readSessionList(ctx) {
  try {
    return readSessions().sessions || [];
  } catch (error) {
    if (typeof ctx.log === 'function')
      ctx.log('error', 'report history read failed', error && error.message);
    return [];
  }
}

/** 读取随测评保存的临场状态（旧记录可能没有）。 */
function prepContext() {
  const profile = readProfile();
  const latest = (readSessions().sessions || [])[0] || {};
  const prep = latest.prep && typeof latest.prep === 'object' ? latest.prep : {};
  return { profile, sleep: Number(prep.sleep), fatigue: Number(prep.fatigue) };
}

function prepBits(profile, sleep, fatigue) {
  const bits = [];
  if (profile.age) bits.push(`${profile.age} 岁（${ageBand(profile.age)}）`);
  if (Number.isFinite(sleep) && sleep > 0) bits.push(`睡眠 ${sleep} 小时`);
  else if (profile.sleep) bits.push('睡眠已记录');
  if (Number.isFinite(fatigue)) bits.push(`疲劳 ${fatigue}/5`);
  return bits;
}

function prepWarning(profile, sleep, fatigue) {
  const local = stateWarning(profile);
  if (local) return local;
  if (sleep > 0 && sleep <= 5) return '本次睡眠偏少，速度类与记忆类分数可能受影响，解读时请留意。';
  if (Number.isFinite(fatigue) && fatigue >= 4)
    return '你反馈当前疲劳程度较高，后段题目表现可能受影响。';
  return '';
}

/** 状态与年龄提示：只解释结果，不改分数。 */
function contextCard() {
  const { profile, sleep, fatigue } = prepContext();
  const note = ageNote(profile.age);
  const warn = prepWarning(profile, sleep, fatigue);
  const bits = prepBits(profile, sleep, fatigue);
  if (!warn && !note && !bits.length) return null;

  return el('div', { class: `card${warn ? ' card-warn' : ''}` }, [
    titled(
      'h2',
      '解读提示',
      '这些信息只用于解释这份结果有多可信，不参与计分，也不会改动任何分数。',
    ),
    bits.length ? el('p', { class: 'tiny', text: bits.join(' · ') }) : null,
    warn ? el('p', { class: 'muted', text: warn }) : null,
    note ? el('p', { class: 'muted', text: note }) : null,
  ]);
}

/** 未测行折不折叠，页首那句口径就得跟着变：别写「见最后一行」而最后一行其实没折叠。 */
function leadCountText(radar) {
  const rest = radar.total - radar.measuredCount;
  if (rest === 0) return `8 个维度这次全部测到了。`;
  if (radar.measuredCount === 0) {
    return `8 个维度这次都没有可计分的作答，全部显示「未测」（不按 0 计）。`;
  }
  return `8 个维度中测了 ${radar.measuredCount} 个，其余 ${rest} 个未测，收在表格最后一行（不按 0 计）。`;
}

function fullReport(ctx, results, scored, radar, assessmentId, level, cleanup) {
  return [
    el('p', { class: 'lead' }, [
      leadCountText(radar),
      hint('分数旁边的 ± 是这一次分数的区间：题量越少、限时越短，区间越宽。', { edge: true }),
    ]),
    contextCard(),
    radarCard(radar),
    scoreTable(reportRows(scored, results, level)),
    ...compareBlock(ctx, scored, assessmentId),
    renderAiCard(ctx, assessmentId, cleanup),
    scoreNote(),
    reportActions(ctx),
  ];
}

/** 计分或雷达失败时退回「全部未测」的报告，而不是整页报错。 */
function safeScore(results, ctx, level = 'standard') {
  try {
    return scoreSession(results, level);
  } catch (error) {
    if (ctx && typeof ctx.log === 'function')
      ctx.log('error', 'score failed', error && error.message);
    const scores = {};
    for (const dim of DIMS) scores[dim.id] = null;
    return { version: SCORING_VERSION, scores, measured: [], missing: DIMS.map((d) => d.id) };
  }
}

export function renderReport(root, ctx) {
  const latest = readSessionList(ctx)[0] || null;
  const results =
    Object.keys(ctx.state.results || {}).length > 0
      ? ctx.state.results
      : (latest && latest.results) || {};
  const measured = Object.keys(results);
  const level = ctx.state.level || (latest && latest.level) || 'standard';
  const scored = reportScores(ctx, latest, results, level);
  const radar = buildRadar(DIMS, scored.scores || {});
  const assessmentId = ctx.state.assessmentId || (latest && latest.id) || null;
  const cleanup = [];
  const body =
    measured.length === 0
      ? emptyReport(ctx)
      : fullReport(ctx, results, scored, radar, assessmentId, level, cleanup);

  root.appendChild(
    el('section', { class: 'page page-report', 'aria-labelledby': 'report-title' }, [
      el('p', { class: 'kicker', text: '你的结果' }),
      el('h1', { id: 'report-title', class: 'page-title', text: '报告与趋势' }),
      ...body,
      el('div', { class: 'card' }, [
        titled(
          'h2',
          '局限与说明',
          '样本少、没有临床常模，成绩会受睡眠、情绪、设备与练习效应影响；未测维度显示「未测」，不按 0 计。',
        ),
        el('p', {
          class: 'muted',
          text: '不设总分、不做百分位、不与人群比较；本产品不是医疗器械，不提供诊断或医疗建议。',
        }),
        el('p', { class: 'tiny' }, [
          '完整口径、计分依据与 AI 边界见 ',
          el('a', { class: 'link', href: '#/about', text: '说明' }),
          '。',
        ]),
      ]),
    ]),
  );
  // 离开报告页时收掉解读等待的阶段计时器，别让文案在别的页面上继续跳。
  return () => cleanup.forEach((stop) => stop());
}

/**
 * 等待可感知（用户测试表 A6）：一次解读请求分三个阶段说清楚，
 * 复用 styles/app.css 的 .explain-pending + .pending-dots 动画（与对话页同一套语言），
 * 不再只把一行小字换来换去。
 */
const EXPLAIN_STAGES = [
  { at: 0, text: '正在检索知识库…' },
  { at: 3000, text: '正在组织回答（模型思考中）…' },
  { at: 10000, text: '模型响应较慢；再等一会儿会自动改用离线模板回答…' },
];

/**
 * 回退原因 → 用户能看懂的一句话。与 pages/chat.js 的 LLM_FALLBACK_REASON 同口径
 * （那个文件不在本次改动范围内，这里放报告页需要的副本）：后端 code 只用来查表，
 * 原始 code 一律不上界面。
 */
const EXPLAIN_FALLBACK = {
  timeout: '模型响应超时',
  auth: '模型服务拒绝了本次请求',
  rate_limit: '模型服务正忙，已限流',
  http: '模型服务返回异常',
  network: '无法连接模型服务',
  bad_response: '模型返回的内容无法解析',
  truncated: '模型回答被截断',
  unknown: '模型服务异常',
  too_long: '模型回答过长，已改用更稳的说法',
  banned_word: '模型用了不该用的措辞',
  unsourced_number: '模型提到了没有依据的数字',
  score_misattributed: '模型把分数说到了别的维度上',
  mechanism_speculation: '模型在编造指标背后的原因',
  empty: '模型没有给出内容',
};

function explainFallbackText(code) {
  const key = String(code || '');
  if (!key || key === 'not_configured' || key === 'no_knowledge') {
    return '本次用离线模板：站点还没有配置可用的模型服务，内容只复述原始指标。';
  }
  if (key.startsWith('intent:') || key === 'pii_blocked') {
    return '本次按规则用离线模板回答，没有调用模型。';
  }
  return `已改用离线模板：${EXPLAIN_FALLBACK[key] || '模型这次没有可用回答'}`;
}

/** AI 解读卡片：后端调用模型；任何异常都显示模板结果。 */
function renderAiCard(ctx, assessmentId, cleanup) {
  const badge = el('span', { class: 'pill', text: '未生成' });
  // 默认口径收进标题旁的浮框；回退原因与报错照常写回 reason（必须始终可见）。
  const reason = el('p', { class: 'tiny', text: '' });
  const output = el('p', { class: 'ai-text', text: '' });
  const citations = el('p', { class: 'tiny', text: '' });
  const pendingText = el('span', { class: 'pending-text', text: EXPLAIN_STAGES[0].text });
  const pending = el('div', { class: 'explain-pending', role: 'status', 'aria-live': 'polite' }, [
    el('span', { class: 'pending-dots', 'aria-hidden': 'true' }, [el('i'), el('i'), el('i')]),
    pendingText,
  ]);
  const run = button('生成解读', () => runExplain({ staged: true }), { variant: 'ghost' });
  const card = el('div', { class: 'card ai-card' }, [
    el('h2', { class: 'card-title' }, [
      el('span', { class: 'ai-icon', html: iconSvg('sparkle') }),
      'AI 解读 ',
      badge,
      hint(
        '默认用离线模板解读，站点配置模型后自动改用模型生成；解读只解释这次结果与原始指标，不参与出题与计分。',
      ),
    ]),
    reason,
    output,
    citations,
    el('div', { class: 'row' }, [
      run,
      button('去设置', () => ctx.go('/settings'), { variant: 'ghost' }),
    ]),
  ]);

  let stageTimers = [];

  function showStages() {
    if (!pending.parentNode) card.insertBefore(pending, reason);
    pendingText.textContent = EXPLAIN_STAGES[0].text;
    stageTimers = EXPLAIN_STAGES.slice(1).map((stage) =>
      setTimeout(() => {
        pendingText.textContent = stage.text;
      }, stage.at),
    );
  }

  function hideStages() {
    stageTimers.forEach((timer) => clearTimeout(timer));
    stageTimers = [];
    if (pending.parentNode) pending.remove();
  }

  if (Array.isArray(cleanup)) cleanup.push(hideStages);

  async function runExplain(options = {}) {
    if (!assessmentId) {
      reason.textContent = '这次测评还没有保存成记录：先完成并保存一次测评，再生成解读。';
      return;
    }
    run.disabled = true;
    badge.textContent = '生成中';
    badge.className = 'pill';
    reason.textContent = '';
    if (options.staged) showStages();
    try {
      const result = await api.post(
        `/reports/${encodeURIComponent(assessmentId)}/explain`,
        undefined,
        { timeoutMs: 60000 },
      );
      const fromModel = result.source === 'llm';
      output.textContent = result.text;
      citations.textContent =
        Array.isArray(result.citations) && result.citations.length > 0
          ? `引用：${result.citations.join(' · ')}`
          : '';
      badge.textContent = fromModel ? 'AI' : '离线模板';
      badge.className = `pill ${fromModel ? 'hi' : 'mid'}`;
      reason.textContent = fromModel
        ? '由站点配置的模型生成，内容仅供参考，不构成诊断或医疗建议。'
        : explainFallbackText(result.code);
    } catch {
      // 站点服务不可用也保留卡片与已有结果，重试是用户的下一步动作。
      badge.textContent = '未生成';
      badge.className = 'pill';
      reason.textContent =
        '解读这次没有生成成功：站点服务或模型没有响应。分数、雷达图与对比结果不受影响，可以稍后再点一次。';
    } finally {
      hideStages();
      run.disabled = false;
    }
  }

  // 未配置模型时模板解读即时返回，直接显示，别让用户面对空白卡片。
  if (!readSettings().hasKey) runExplain();

  return card;
}
