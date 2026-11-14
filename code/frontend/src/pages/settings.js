import { el, button, clear } from '../ui.js';
import { api } from '../api.js';
import { readSettings, writeSettings, clearSettings } from '../storage.js';
import { clearLogs, exportLogs, getLogs, log } from '../log.js';
import { isSoundOn, setSoundOn, playClick } from '../sound.js';

const ENDPOINT_HINT = '例如 https://api.deepseek.com/v1 或完整的 /chat/completions 地址';

const RISKS = [
  'Key 只保存在 Windows 凭据管理器（Credential Manager），不进入前端存储、数据库、日志或导出 JSON。',
  '公用电脑不要保存 Key；用完点「清除 Key」。',
  '模型请求由本机 FastAPI 转发，不再需要模型服务放行浏览器 CORS。',
  '未配置、超时、限流、鉴权失败都会自动回退模板解读，页面不会空白。',
];

function initialForm(saved) {
  return {
    enabled: Boolean(saved.enabled),
    endpoint: saved.endpoint || '',
    model: saved.model || '',
    apiKey: '',
  };
}

function field(labelText, id, input, note = null) {
  const children = [el('label', { class: 'field-label', for: id, text: labelText }), input];
  if (note) children.push(note);
  return el('div', { class: 'field' }, children);
}

function buildInputs(form, saved) {
  const endpoint = el('input', {
    id: 'set-endpoint',
    class: 'input',
    type: 'url',
    inputmode: 'url',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: ENDPOINT_HINT,
    value: form.endpoint,
    oninput: (event) => {
      form.endpoint = event.target.value;
    },
  });

  const model = el('input', {
    id: 'set-model',
    class: 'input',
    type: 'text',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '例如 deepseek-chat',
    value: form.model,
    oninput: (event) => {
      form.model = event.target.value;
    },
  });

  const key = el('input', {
    id: 'set-key',
    class: 'input',
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: saved.hasKey ? '已保存，留空则保持不变' : 'sk-...',
    oninput: (event) => {
      form.apiKey = event.target.value;
    },
  });

  const enabled = el('input', {
    id: 'set-enabled',
    type: 'checkbox',
    checked: form.enabled ? 'checked' : null,
    onchange: (event) => {
      form.enabled = event.target.checked;
    },
  });

  return { endpoint, model, key, enabled };
}

function configPayload(form) {
  const payload = {
    enabled: form.enabled,
    endpoint: form.endpoint.trim(),
    model: form.model.trim(),
  };
  if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
  return payload;
}

async function saveConfig(form, ctx, status, keyNote, silent = false) {
  status.className = 'status';
  status.textContent = '正在保存…';
  try {
    const saved = await writeSettings(configPayload(form));
    form.apiKey = '';
    const configured = Boolean(saved.enabled && saved.endpoint && saved.model && saved.hasKey);
    if (!silent) ctx.toast('已保存到本机');
    status.textContent = configured ? '已配置：可以使用 AI 解读' : '已保存，但还缺少必填项';
    status.className = `status ${configured ? 'ok' : 'warn'}`;
    keyNote.textContent = saved.hasKey ? `已保存：${saved.keyHint}` : '尚未保存 Key';
    return { saved, configured };
  } catch (error) {
    ctx.log('warn', 'settings save failed', error && error.message);
    status.className = 'status bad';
    status.textContent = '保存失败：本地服务或 Windows 凭据管理器不可用';
    return { saved: null, configured: false };
  }
}

async function clearKey(form, ctx, draw) {
  try {
    await clearSettings();
    form.apiKey = '';
    form.enabled = false;
    ctx.toast('已清除本机 Key');
    draw();
  } catch (error) {
    ctx.log('warn', 'settings clear failed', error && error.message);
    ctx.toast('清除失败：本地服务或 Windows 凭据管理器不可用');
  }
}

async function testConnection(form, status, test) {
  status.className = 'status';
  status.textContent = '正在请求…';
  test.disabled = true;
  try {
    if (form.apiKey.trim() || form.endpoint.trim() || form.model.trim()) {
      await writeSettings(configPayload(form));
      form.apiKey = '';
    }
    const result = await api.post('/settings/ai/test');
    status.className = 'status ok';
    status.textContent = `连接成功：${result.model || '模型可用'}`;
  } catch (error) {
    status.className = 'status bad';
    status.textContent = `${error.code || 'unknown'}：本地服务或模型不可用`;
  } finally {
    test.disabled = false;
  }
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

function importLegacy(ctx, rerender) {
  const picker = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: 'display:none',
  });
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    if (!file) return;
    if (!window.confirm('导入旧版导出的 JSON？导入前会自动备份当前本机数据库。')) return;
    try {
      const data = JSON.parse(await file.text());
      const result = await api.post('/import', data);
      const counts = result.imported || {};
      ctx.toast(
        `导入完成：${counts.sessions || 0} 次测评、${counts.messages || 0} 条消息；Key 未导入`,
      );
      setTimeout(() => globalThis.location.reload(), 900);
    } catch (error) {
      ctx.toast(`导入失败：${error.code || 'unknown'}`);
      rerender();
    }
  });
  picker.click();
}

function buildLogCard(ctx, rerender) {
  const logs = getLogs();
  const latest = logs[logs.length - 1];
  return el('div', { class: 'card' }, [
    el('h2', { class: 'card-title', text: '诊断日志' }),
    el('p', {
      class: 'muted',
      text: `前端日志只存在本机内存，最多 200 条；导出前会脱敏，不包含 LLM Key。当前 ${logs.length} 条。`,
    }),
    latest
      ? el('p', { class: 'tiny', text: `最近：${latest.level} · ${latest.event}` })
      : el('p', { class: 'tiny', text: '还没有日志。' }),
    el('div', { class: 'row' }, [
      button('导出诊断日志', () => downloadLogs(ctx), { variant: 'ghost' }),
      button(
        '清除日志',
        () => {
          if (!window.confirm('清除本机诊断日志？')) return;
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

function buildPage(ctx, view) {
  const { fields, actions, status, keyNote, diagnostics, migration } = view;
  return el('section', { class: 'page', 'aria-labelledby': 'settings-title' }, [
    el('h1', { id: 'settings-title', class: 'page-title', text: '设置' }),
    el('p', {
      class: 'lead',
      text: '用自己的模型服务（BYOK）。不配置也可以正常测评，解读会走模板。',
    }),
    el('div', { class: 'card' }, [
      el('label', { class: 'check' }, [fields.enabled, el('span', { text: '启用 AI 解读' })]),
      field('Endpoint', 'set-endpoint', fields.endpoint),
      field('模型名', 'set-model', fields.model),
      field('API Key', 'set-key', fields.key, keyNote),
      el('div', { class: 'row' }, [actions.test, actions.save]),
      status,
    ]),
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '体验' }),
      el('label', { class: 'check' }, [buildSoundToggle(), el('span', { text: '点击音效' })]),
      el('p', {
        class: 'muted',
        text: '按钮和选项点击时播放一声轻微提示音；只在本机实时合成，不加载音频文件、不联网。',
      }),
    ]),
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '风险与限制' }),
      el(
        'ul',
        { class: 'plain-list' },
        RISKS.map((text) => el('li', { text })),
      ),
      actions.clearKey,
    ]),
    el('div', { class: 'card' }, [
      el('h2', { class: 'card-title', text: '旧数据迁移' }),
      el('p', {
        class: 'muted',
        text: '从旧版静态应用导出的 JSON 可导入本机数据库；导入前自动 pg_dump 备份。LLM Key 不会导入，需要重新填写。',
      }),
      migration,
    ]),
    diagnostics,
    button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
  ]);
}

export function renderSettings(root, ctx) {
  const saved = readSettings();
  const form = initialForm(saved);
  const status = el('p', { class: 'status', role: 'status', text: '' });
  const keyNote = el('p', {
    class: 'tiny',
    text: saved.hasKey ? `已保存：${saved.keyHint}` : '尚未保存 Key',
  });

  const draw = () => {
    clear(root);
    const fields = buildInputs(form, saved);
    const test = button('测试连接', () => testConnection(form, status, test), {
      variant: 'ghost',
    });
    const save = button('保存', () => saveConfig(form, ctx, status, keyNote), {
      variant: 'primary',
    });
    const clearButton = button('清除 Key', () => clearKey(form, ctx, draw), {
      variant: 'danger',
    });
    const importButton = button('导入旧数据', () => importLegacy(ctx, draw), {
      variant: 'ghost',
    });

    root.appendChild(
      buildPage(ctx, {
        fields,
        actions: { test, save, clearKey: clearButton },
        status,
        keyNote,
        migration: importButton,
        diagnostics: buildLogCard(ctx, draw),
      }),
    );
  };

  draw();
}
