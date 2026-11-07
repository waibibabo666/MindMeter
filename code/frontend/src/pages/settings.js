import { el, button, clear } from '../ui.js';
import { readSettings, writeSettings } from '../storage.js';
import { callLlm, isConfigured, maskKey } from '../llm/client.js';

const ENDPOINT_HINT = '例如 https://api.deepseek.com/v1 或完整的 /chat/completions 地址';

const RISKS = [
  'Key 只保存在本机浏览器（mindmeter.settings.v1），不上传、不写入日志、导出时会被剥离。',
  '公用电脑或共享浏览器不要保存 Key；用完点「清除 Key」。',
  '浏览器直连需要模型服务允许当前来源的 CORS（含 Authorization 头），否则请求会被拦截。',
  '未配置、超时、限流、鉴权失败都会自动回退模板解读，页面不会空白。',
];

function initialForm(saved) {
  return {
    enabled: Boolean(saved.enabled),
    endpoint: saved.endpoint || '',
    model: saved.model || '',
    apiKey: saved.apiKey || '',
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
    placeholder: form.apiKey ? '已保存，留空则保持不变' : 'sk-...',
    oninput: (event) => {
      form.apiKey = event.target.value || saved.apiKey || '';
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

function saveConfig(form, ctx, status, keyNote) {
  const payload = {
    enabled: form.enabled,
    endpoint: form.endpoint.trim(),
    model: form.model.trim(),
    apiKey: (form.apiKey || '').trim(),
  };
  writeSettings(payload);
  const configured = isConfigured(payload);
  ctx.toast('已保存到本机');
  status.textContent = configured ? '已配置：可以使用 AI 解读' : '已保存，但还缺少必填项';
  status.className = `status ${configured ? 'ok' : 'warn'}`;
  keyNote.textContent = payload.apiKey ? `已保存：${maskKey(payload.apiKey)}` : '尚未保存 Key';
}

function clearKey(form, ctx, draw) {
  writeSettings({
    enabled: false,
    endpoint: form.endpoint.trim(),
    model: form.model.trim(),
    apiKey: '',
  });
  form.apiKey = '';
  form.enabled = false;
  ctx.toast('已清除本机 Key');
  draw();
}

async function testConnection(form, status, test) {
  status.className = 'status';
  status.textContent = '正在请求…';
  test.disabled = true;
  try {
    await callLlm({
      settings: { endpoint: form.endpoint, model: form.model, apiKey: form.apiKey },
      messages: [{ role: 'user', content: '只回复 OK' }],
      maxTokens: 8,
      timeoutMs: 15000,
    });
    status.className = 'status ok';
    status.textContent = '连接成功：服务端允许浏览器直连，鉴权有效';
  } catch (error) {
    status.className = 'status bad';
    status.textContent = `${error.code || 'unknown'}：${error.message}`;
  } finally {
    test.disabled = false;
  }
}

function buildPage(ctx, view) {
  const { fields, actions, status, keyNote } = view;
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
      el('h2', { class: 'card-title', text: '风险与限制' }),
      el(
        'ul',
        { class: 'plain-list' },
        RISKS.map((text) => el('li', { text })),
      ),
      actions.clearKey,
    ]),
    button('返回首页', () => ctx.go('/'), { variant: 'ghost' }),
  ]);
}

export function renderSettings(root, ctx) {
  const saved = readSettings();
  const form = initialForm(saved);
  const status = el('p', { class: 'status', role: 'status', text: '' });
  const keyNote = el('p', {
    class: 'tiny',
    text: form.apiKey ? `已保存：${maskKey(form.apiKey)}` : '尚未保存 Key',
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
      variant: 'ghost',
    });

    root.appendChild(
      buildPage(ctx, {
        fields,
        actions: { test, save, clearKey: clearButton },
        status,
        keyNote,
      }),
    );
  };

  draw();
}
