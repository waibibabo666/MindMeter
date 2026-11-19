/**
 * 设置页（Web 部署）。
 *
 * 与桌面版最大的差别有两点：
 * 1. 模型服务由站点统一提供（`MM_LLM_*` 环境变量），浏览器不再接受任何 API Key；
 * 2. 数据归属从「这台电脑」变成「这个账号」，因此这里同时是账号与数据的主控台：
 *    改密码、退出登录、注销账号（级联删除）、导出与导入。
 */
import { el, button, clear } from '../ui.js';
import { api } from '../api.js';
import { readSettings } from '../storage.js';
import { clearLogs, exportLogs, getLogs, log } from '../log.js';
import { isSoundOn, setSoundOn, playClick } from '../sound.js';
import { changePassword, deleteAccount, messageFor, passwordIssues, session } from '../auth.js';

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
  const current = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: '当前密码',
  });
  const next = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: `新密码，至少 10 位`,
  });
  const confirm = el('input', {
    class: 'input',
    type: 'password',
    autocomplete: 'new-password',
    placeholder: '再输入一次新密码',
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
    el('h2', { class: 'card-title', text: '修改密码' }),
    el('p', { class: 'muted', text: '修改后其他设备上的登录状态会全部失效，本设备保持登录。' }),
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
    placeholder: '输入当前密码以确认',
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
    el('h3', { class: 'card-subtitle', text: '注销账号' }),
    el('p', {
      class: 'muted',
      text: '需要输入当前密码。删除是不可恢复的；如需留档，请先在「我的数据」里导出。',
    }),
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

  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: 'AI 解读' }),
    el('p', {
      class: 'muted',
      text: '模型由站点统一提供（服务端环境变量），这里只读：浏览器不接收也不保存任何密钥。',
    }),
    accountRow('状态', state),
    accountRow('模型', saved.model || '—'),
    accountRow('服务地址', saved.endpoint || '—'),
    accountRow('密钥', saved.hasKey ? `服务端已配置（${saved.keyHint || 'masked'}）` : '未配置'),
    el('div', { class: 'row' }, [test]),
    status,
    saved.enabled && saved.hasKey
      ? null
      : el('p', {
          class: 'tiny',
          text: '部署时在 Render 环境变量里填 MM_LLM_API_KEY 即可启用真实模型；不填也能正常测评。',
        }),
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
    el('h2', { class: 'card-title', text: '我的数据' }),
    el('p', {
      class: 'muted',
      text: '导出的是本账号的完整数据 JSON（测评、分数、记忆、对话、进度），不含任何密钥。',
    }),
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

function buildExperienceCard() {
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '体验' }),
    el('label', { class: 'check' }, [buildSoundToggle(), el('span', { text: '点击音效' })]),
    el('p', {
      class: 'muted',
      text: '按钮和选项点击时播放一声轻微提示音；在当前页面实时合成，不加载音频文件、不联网。',
    }),
  ]);
}

function buildLogCard(ctx, rerender) {
  const logs = getLogs();
  const latest = logs[logs.length - 1];
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '诊断日志' }),
    el('p', {
      class: 'muted',
      text: `前端日志只存在当前页面内存，最多 200 条；导出前会脱敏，不包含密钥。当前 ${logs.length} 条。`,
    }),
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
    el('h2', { class: 'card-title', text: '风险与限制' }),
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
        el('p', {
          class: 'lead',
          text: '账号、模型服务与数据都在这里。不配置模型也能正常测评，解读会走模板。',
        }),
        buildAccountCard(ctx),
        buildPasswordCard(ctx),
        buildAiCard(),
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
