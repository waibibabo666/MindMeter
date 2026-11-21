/**
 * 设置页（Web 部署）。
 *
 * 与桌面版最大的差别有两点：
 * 1. 模型服务由站点统一提供（`MM_LLM_*` 环境变量），浏览器不再接受任何 API Key；
 * 2. 数据归属从「这台电脑」变成「这个账号」，因此这里同时是账号与数据的主控台：
 *    改密码、退出登录、注销账号（级联删除）、导出与导入。
 */
import { el, button, clear, hint, titled } from '../ui.js';
import { readUiPrefs, writeUiPrefs } from '../ui-prefs.js';
import { api } from '../api.js';
import { readSettings } from '../storage.js';
import { clearLogs, exportLogs, getLogs, log } from '../log.js';
import { isSoundOn, setSoundOn, playClick } from '../sound.js';
import { changePassword, deleteAccount, messageFor, passwordIssues, session } from '../auth.js';

/* 反馈 2：每个板块只留名字，解释收进标题旁的浮框；
   风险与限制、注销后果这类会影响决策的话仍然写在页面上。 */
const TIP_RELOGIN = '修改后其他设备上的登录状态会全部失效，本设备保持登录。';
// 反馈 3 · 模式 3：浮框不再复述输入框旁边已经写着的「需要输入当前密码」。
const TIP_ERASE =
  '注销是立即级联删除：测评、分数、记忆、对话与运行记录一起清掉。如需留档，请先在「我的数据」里导出。';
// 「未配置就回退模板」这一条已经写在下面的状态行里，浮框不重复（反馈 3 · 模式 2）。
const TIP_AI = '模型由站点统一提供（服务端环境变量），这里只读：浏览器不接收也不保存任何密钥。';
const TIP_DATA =
  '导出的是本账号的完整数据 JSON（测评、分数、记忆、对话、进度），不含任何密钥；导入会按相同 id 跳过，不覆盖已有记录。';
const TIP_SOUND =
  '按钮和选项点击时播放一声轻微提示音；在当前页面实时合成，不加载音频文件、不联网。';
const TIP_LOG = '前端日志只存在当前页面内存，最多 200 条，刷新即清；导出前会脱敏，不包含密钥。';
const TIP_AI_RUNS = '最近 10 次 AI 调用的延迟与模板回退次数；只显示指标，不含对话内容。';

const RISKS = [
  '模型服务由站点统一配置，Key 只存在于服务端环境变量：不进浏览器、不进数据库、不进日志与导出 JSON。',
  '未配置、超时、限流或鉴权失败时，解读自动回退到内置模板，页面不会空白。',
  '账号只保存用户名与密码散列（PBKDF2-SHA256），不收集邮箱、姓名或手机号，因此无法自助找回密码。',
  '测评、记忆与对话按账号隔离；注销账号会立即级联删除全部数据，站点不做二次确认期。',
];

function field(labelText, control, note = null) {
  const children = [control];
  if (note) children.push(note);
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: labelText }),
    ...children,
  ]);
}

function statusNode(text = '') {
  return el('p', { class: 'status', role: 'status', text });
}

function when(promise, ctx, onOk, onFail) {
  return async () => {
    try {
      onOk(await promise());
    } catch (error) {
      ctx.log('warn', 'settings action failed', error && error.message);
      onFail(error);
    }
  };
}

/* ------------------------------- 账号卡 ------------------------------- */

function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false });
}

function accountRow(label, value) {
  return el('div', { class: 'kv-row' }, [
    el('span', { class: 'kv-key', text: label }),
    el('span', { class: 'kv-value', text: value }),
  ]);
}

function buildPasswordCard(ctx) {
  // placeholder 只补字段标签没有的信息（长度要求），同义反复的删掉（反馈 3 · 模式 3）。
  const current = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'current-password',
  });
  const next = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: `至少 8 位`,
  });
  const confirm = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: '再输入一次',
  });
  const status = statusNode();

  const submit = async () => {
    status.className = 'status';
    if (next.value !== confirm.value) {
      status.className = 'status bad';
      status.textContent = '两次输入的新密码不一致';
      return;
    }
    const problems = passwordIssues(next.value);
    if (problems.length) {
      status.className = 'status bad';
      status.textContent = problems[0];
      return;
    }
    status.textContent = '正在修改…';
    try {
      await changePassword({ current: current.value, next: next.value, confirm: confirm.value });
      [current, next, confirm].forEach((node) => {
        node.value = '';
      });
      status.className = 'status ok';
      status.textContent = '密码已更新，其他设备需要重新登录';
      ctx.toast('密码已更新');
    } catch (error) {
      status.className = 'status bad';
      status.textContent = messageFor(error);
    }
  };

  return el('div', { class: 'card' }, [
    titled('h2', '修改密码', TIP_RELOGIN),
    field('当前密码', current),
    field('新密码', next),
    field('确认新密码', confirm),
    el('div', { class: 'row' }, [button('更新密码', submit, { variant: 'primary' })]),
    status,
  ]);
}

function buildAccountCard(ctx) {
  const dangerStatus = statusNode();
  const eraseInput = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: '输入当前密码',
  });

  const erase = async () => {
    if (
      !window.confirm(
        '注销账号会立即删除本账号的测评、分数、记忆、对话与运行记录，且无法恢复。继续吗？',
      )
    ) {
      return;
    }
    dangerStatus.className = 'status';
    dangerStatus.textContent = '正在删除…';
    try {
      await deleteAccount(eraseInput.value);
      ctx.toast('账号已注销');
      await ctx.signOut();
    } catch (error) {
      dangerStatus.className = 'status bad';
      dangerStatus.textContent = messageFor(error);
    }
  };

  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '账号' }),
    accountRow('用户名', (session.user && session.user.username) || '—'),
    accountRow('注册时间', formatWhen(session.user && session.user.createdAt)),
    accountRow('上次登录', formatWhen(session.user && session.user.lastLoginAt)),
    el('div', { class: 'row' }, [button('退出登录', () => ctx.signOut(), { variant: 'ghost' })]),
    el('h3', { class: 'card-subtitle' }, ['注销账号', hint(TIP_ERASE, { edge: true })]),
    el('p', { class: 'muted', text: '删除后不可恢复。' }),
    field('确认密码', eraseInput),
    el('div', { class: 'row' }, [button('注销并删除全部数据', erase, { variant: 'danger' })]),
    dangerStatus,
  ]);
}

/* ------------------------------ AI 解读卡 ------------------------------ */

function buildAiCard() {
  const saved = readSettings();
  const status = statusNode();
  const test = button('测试连接', () => runTest(), { variant: 'ghost' });

  async function runTest() {
    status.className = 'status';
    status.textContent = '正在请求…';
    test.disabled = true;
    try {
      const result = await api.post('/settings/ai/test');
      status.className = 'status ok';
      status.textContent = `连接成功：${result.model || '模型可用'}`;
    } catch (error) {
      status.className = 'status bad';
      status.textContent = `${error.code || 'unknown'}：站点无法访问模型服务`;
    } finally {
      test.disabled = false;
    }
  }

  const state =
    saved.enabled && saved.hasKey ? '已启用：解读走真实模型' : '未配置：解读自动回退模板';
  const tip =
    saved.enabled && saved.hasKey
      ? TIP_AI
      : `${TIP_AI}部署时在服务端环境变量里填 MM_LLM_API_KEY 即可启用真实模型；不填也能正常测评。`;

  return el('div', { class: 'card' }, [
    titled('h2', 'AI 解读', tip),
    accountRow('状态', state),
    accountRow('模型', saved.model || '—'),
    accountRow('服务地址', saved.endpoint || '—'),
    accountRow('密钥', saved.hasKey ? `服务端已配置（${saved.keyHint || 'masked'}）` : '未配置'),
    el('div', { class: 'row' }, [test]),
    status,
  ]);
}

/* ------------------------------- 数据卡 ------------------------------- */

function buildDataCard(ctx, rerender) {
  const importButton = button(
    '导入 JSON',
    when(
      async () => {
        const file = await pickJsonFile();
        if (!file) throw new Error('cancelled');
        if (
          !window.confirm(
            '导入会与本账号现有数据合并（相同 id 跳过）。建议先导出当前数据留档。继续吗？',
          )
        ) {
          throw new Error('cancelled');
        }
        const data = JSON.parse(await file.text());
        return api.post('/import', { data });
      },
      ctx,
      (result) => {
        const counts = result.imported || {};
        ctx.toast(
          `导入完成：${counts.sessions || 0} 次测评、${counts.messages || 0} 条消息；密钥未导入`,
        );
        setTimeout(() => globalThis.location.reload(), 700);
      },
      (error) => {
        if (error && error.message !== 'cancelled')
          ctx.toast(`导入失败：${error.code || 'unknown'}`);
        rerender();
      },
    ),
    { variant: 'ghost' },
  );

  return el('div', { class: 'card' }, [
    titled('h2', '我的数据', TIP_DATA),
    el('div', { class: 'row' }, [
      button('导出数据', () => ctx.exportData(), { variant: 'ghost' }),
      importButton,
      button('清除本账号数据', () => ctx.clearAll(), { variant: 'danger' }),
    ]),
    el('p', {
      class: 'tiny',
      text: '「清除本账号数据」保留账号本身；要彻底删除账号，用上方「注销账号」。',
    }),
  ]);
}

function pickJsonFile() {
  return new Promise((resolve) => {
    const picker = el('input', { type: 'file', accept: 'application/json,.json', hidden: '' });
    picker.addEventListener('change', () => {
      const file = picker.files && picker.files[0];
      picker.remove();
      resolve(file || null);
    });
    document.body.appendChild(picker);
    picker.click();
  });
}

/* --------------------------- 体验 / 日志 / 风险 --------------------------- */

function buildSoundToggle() {
  return el('input', {
    id: 'set-sound',
    type: 'checkbox',
    checked: isSoundOn() ? 'checked' : null,
    onchange: (event) => {
      setSoundOn(event.target.checked);
      if (event.target.checked) playClick();
    },
  });
}

function buildMemoryToggle() {
  return el('input', {
    id: 'set-memory',
    type: 'checkbox',
    checked: readUiPrefs().memoryInPrompt ? 'checked' : null,
    onchange: (event) => {
      const prefs = readUiPrefs();
      prefs.memoryInPrompt = Boolean(event.target.checked);
      writeUiPrefs(prefs);
    },
  });
}

function buildStreamToggle() {
  return el('input', {
    id: 'set-stream',
    type: 'checkbox',
    checked: readUiPrefs().streamReply ? 'checked' : null,
    onchange: (event) => {
      const prefs = readUiPrefs();
      prefs.streamReply = Boolean(event.target.checked);
      writeUiPrefs(prefs);
    },
  });
}

function buildExperienceCard() {
  return el('div', { class: 'card' }, [
    titled('h2', '体验', TIP_SOUND),
    el('label', { class: 'check' }, [buildSoundToggle(), el('span', { text: '点击音效' })]),
    el('label', { class: 'check' }, [
      buildMemoryToggle(),
      el('span', { text: '允许 AI 参考我的记忆（画像/摘要）' }),
    ]),
    el('p', {
      class: 'tiny',
      text: '关闭后，AI 只依据本次测评回答；记忆数据仍保留，只是不再参与生成。',
    }),
    el('label', { class: 'check' }, [
      buildStreamToggle(),
      el('span', { text: '流式输出（实验，回答逐段出现）' }),
    ]),
  ]);
}

function buildAiRunsCard() {
  const stats = el('p', { class: 'tiny', text: '读取中…' });
  const recent = el('div', { class: 'tiny' });

  async function load() {
    try {
      const data = await api.get('/ai/runs?limit=10');
      const rate = Math.round((data.degradedRate || 0) * 100);
      const avg = data.avgLatencyMs === null ? '—' : data.avgLatencyMs;
      const p95 = data.p95LatencyMs === null ? '—' : data.p95LatencyMs;
      stats.textContent = `共 ${data.total} 次 · 模板回退 ${rate}% · 平均 ${avg} ms · p95 ${p95} ms`;
      recent.replaceChildren(
        ...(data.recent || []).slice(0, 6).map((run) => {
          const time = run.at ? run.at.slice(11, 16) : '—';
          const tag = run.degraded ? ' · 模板' : '';
          const model = run.model ? ` · ${run.model}` : '';
          return el('p', {
            class: 'tiny',
            text: `${time} · ${run.intent || '—'} · ${run.latencyMs ?? '—'} ms${model}${tag}`,
          });
        }),
      );
      if (!data.recent || data.recent.length === 0) {
        recent.replaceChildren(el('p', { class: 'tiny', text: '还没有运行记录。' }));
      }
    } catch {
      stats.textContent = '暂时读不到运行记录（可能未登录或服务未就绪）。';
    }
  }

  load();
  return el('div', { class: 'card' }, [
    titled('h2', 'AI 运行', TIP_AI_RUNS),
    stats,
    recent,
    el('div', { class: 'row' }, [button('刷新', load, { variant: 'ghost' })]),
  ]);
}

function buildLogCard(ctx, rerender) {
  const logs = getLogs();
  const latest = logs[logs.length - 1];
  return el('div', { class: 'card' }, [
    titled('h2', '诊断日志', TIP_LOG),
    el('p', { class: 'tiny', text: `当前 ${logs.length} 条。` }),
    latest ? el('p', { class: 'tiny', text: `最近：${latest.level} · ${latest.event}` }) : null,
    el('div', { class: 'row' }, [
      button('导出诊断日志', () => downloadLogs(ctx), { variant: 'ghost' }),
      button(
        '清除日志',
        () => {
          if (!window.confirm('清除本页面诊断日志？')) return;
          clearLogs();
          log('info', '日志已清除');
          ctx.toast('已清除诊断日志');
          rerender();
        },
        { variant: 'ghost' },
      ),
    ]),
  ]);
}

function downloadLogs(ctx) {
  log('info', '导出诊断日志', `count=${getLogs().length}`);
  try {
    const data = exportLogs();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mindmeter-logs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    ctx.toast('已导出诊断日志（已脱敏，仅前端内存日志）');
  } catch (error) {
    log('error', '导出诊断日志失败', error && error.message);
    ctx.toast('导出失败：浏览器可能禁止了下载');
  }
}

function buildRiskCard() {
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title' }, [
      '风险与限制',
      hint('这一节是必须常驻的边界声明；更完整的口径、依据与 AI 边界写在「说明」页。'),
    ]),
    el(
      'ul',
      { class: 'plain-list' },
      RISKS.map((text) => el('li', { text })),
    ),
  ]);
}

/* -------------------------------- 页面 -------------------------------- */

export function renderSettings(root, ctx) {
  const draw = () => {
    clear(root);
    root.appendChild(
      el('section', { class: 'page', 'aria-labelledby': 'settings-title' }, [
        el('h1', { id: 'settings-title', class: 'page-title', text: '设置' }),
        buildAccountCard(ctx),
        buildPasswordCard(ctx),
        buildAiCard(),
        buildAiRunsCard(),
        buildDataCard(ctx, draw),
        buildExperienceCard(),
        buildRiskCard(),
        buildLogCard(ctx, draw),
        button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
      ]),
    );
  };

  draw();
}
