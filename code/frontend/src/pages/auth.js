/**
 * 登录 / 注册页（Web 部署）。
 *
 * 未登录时整页只有这两张卡：不做测评、不读数据，避免半屏 401。
 * 文案口径：账号只用于跨设备找回自己的数据，不收集邮箱、姓名或手机号。
 */
import { credentialIssues, loadSession, login, messageFor, register, session } from '../auth.js';
import { el } from '../ui.js';

function field(label, control, note) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }),
    control,
    note ? el('span', { class: 'field-hint', text: note }) : null,
  ]);
}

function input(id, type, autocomplete, placeholder) {
  return el('input', {
    class: 'input',
    id,
    type,
    autocomplete,
    placeholder,
    'aria-describedby': `${id}-status`,
  });
}

/** 密码框：右侧带「显示 / 隐藏」开关，减少输错密码的来回。 */
function passwordControl(id, autocomplete, placeholder, fieldName) {
  const box = input(id, 'password', autocomplete, placeholder);
  if (fieldName) box.dataset.field = fieldName;
  const toggle = el('button', {
    class: 'pw-toggle',
    type: 'button',
    'aria-label': '显示密码',
    'aria-pressed': 'false',
    text: '显示',
  });
  toggle.addEventListener('click', () => {
    const show = box.type === 'password';
    box.type = show ? 'text' : 'password';
    toggle.textContent = show ? '隐藏' : '显示';
    toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    toggle.setAttribute('aria-pressed', String(show));
    box.focus();
  });
  return el('span', { class: 'input-wrap' }, [box, toggle]);
}

function statusNode(id) {
  return el('p', { id: `${id}-status`, class: 'auth-status', role: 'status', text: '' });
}

function checkbox(id, labelChildren) {
  const box = el('input', { class: 'auth-check', id, type: 'checkbox' });
  const label = el('label', { class: 'check', for: id }, [box, ...[].concat(labelChildren)]);
  return { box, label };
}

function submitButton(label) {
  return el('button', { class: 'btn primary', type: 'submit', text: label });
}

function busy(form, nodes, on) {
  form.setAttribute('aria-busy', String(on));
  for (const node of nodes) node.disabled = on;
}

function collect(form) {
  const values = {};
  for (const node of form.querySelectorAll('[data-field]')) {
    const key = node.dataset.field;
    values[key] = node.type === 'checkbox' ? node.checked : node.value;
  }
  return values;
}

/** 品牌 + 一句产品定位，登录/注册共用。 */
function header(kicker, title, lead) {
  return [
    el('p', { class: 'kicker', text: 'MindMeter · 心智镜' }),
    el('h1', { class: 'page-title', text: title }),
    el('p', { class: 'lead', text: lead }),
  ];
}

function switchLine(kind, ctx) {
  if (!session.registrationOpen && kind === 'register') {
    return el('p', { class: 'tiny', text: '当前已关闭自助注册，请联系发起人获取账号。' });
  }
  const to = kind === 'login' ? '/register' : '/login';
  const label = kind === 'login' ? '没有账号？注册一个' : '已有账号？去登录';
  return el('p', { class: 'tiny' }, [
    el('a', {
      class: 'link',
      href: `#${to}`,
      text: label,
      onclick: (event) => {
        event.preventDefault();
        ctx.go(to);
      },
    }),
  ]);
}

function disclaimer() {
  // 报名前的边界声明必须主动可见；重复的产品口径只在「说明」页保留一次。
  return el('p', {
    class: 'disclaimer',
    text: 'MindMeter 不是医疗器械，不提供临床诊断、治疗或危机干预。',
  });
}

async function runSubmit(form, status, ctx, action) {
  const values = collect(form);
  const nodes = [...form.querySelectorAll('input, button')];
  status.className = 'auth-status';
  status.textContent = '';
  busy(form, nodes, true);
  try {
    const result = await action(values);
    status.textContent = '正在进入…';
    await ctx.onAuthenticated(result && result.user);
  } catch (error) {
    status.className = 'auth-status bad';
    status.textContent = messageFor(error);
    busy(form, nodes, false);
  }
}

/** 中心「镜」的图形：SVG 手绘镜面 + 扫光/涟漪/星点动画（不依赖图片）。 */
const LENS_SVG = `
<svg class="lens-art" viewBox="0 0 120 150" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="mmGold" x1="0" y1="0" x2="0.8" y2="1">
      <stop offset="0%" stop-color="#fdf3d8"/>
      <stop offset="35%" stop-color="#e7c983"/>
      <stop offset="70%" stop-color="#c39a45"/>
      <stop offset="100%" stop-color="#8f661f"/>
    </linearGradient>
    <radialGradient id="mmGlass" cx="36%" cy="30%" r="78%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="58%" stop-color="#f4f8f6"/>
      <stop offset="100%" stop-color="#dbe9e2"/>
    </radialGradient>
    <linearGradient id="mmSheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="mmClip"><ellipse cx="60" cy="82" rx="33" ry="46"/></clipPath>
  </defs>
  <g fill="url(#mmGold)">
    <path d="M60 20c-4-9-14-11-20-5 4-1 7 0 9 3 1 2 1 4 0 6 3-3 7-4 11-4z"/>
    <path d="M60 20c4-9 14-11 20-5-4-1-7 0-9 3-1 2-1 4 0 6-3-3-7-4-11-4z"/>
    <path d="M38 32c-5 3-8 8-8 13 3-4 6-6 10-6z"/>
    <path d="M82 32c5 3 8 8 8 13-3-4-6-6-10-6z"/>
    <ellipse cx="60" cy="17" rx="4.5" ry="5.5"/>
    <ellipse cx="60" cy="17" rx="2" ry="2.6" fill="#fdf3d8" opacity="0.85"/>
    <path d="M56 140c-3 4-4 7-3 10 2-2 5-3 8-3-1-2-2-4-5-6z"/>
    <path d="M64 140c3 4 4 7 3 10-2-2-5-3-8-3 1-2 2-4 5-6z"/>
  </g>
  <ellipse cx="60" cy="82" rx="46" ry="59" fill="none" stroke="url(#mmGold)" stroke-width="2.4" opacity="0.85"/>
  <ellipse cx="60" cy="82" rx="41.5" ry="54.5" fill="none" stroke="url(#mmGold)" stroke-width="8"/>
  <ellipse cx="60" cy="82" rx="37" ry="50" fill="none" stroke="url(#mmGold)" stroke-width="1.6"/>
  <ellipse cx="60" cy="82" rx="39.5" ry="52.5" fill="none" stroke="#fdf3d8" stroke-width="2.4" stroke-dasharray="0.6 3.4" stroke-linecap="round" opacity="0.9"/>
  <ellipse cx="60" cy="82" rx="33" ry="46" fill="url(#mmGlass)"/>
  <g clip-path="url(#mmClip)">
    <g transform="rotate(24 60 82)">
      <rect class="lens-sweep" x="-20" y="-80" width="26" height="320" fill="url(#mmSheen)"/>
    </g>
  </g>
  <path class="lens-spark" d="M46 62v7M42.5 65.5h7" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity="0.9"/>
  <path class="lens-spark lens-spark-2" d="M76 100v5M73.5 102.5h5" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
</svg>`;

function lensGraphic() {
  const art = el('div', { class: 'auth-lens-art' });
  art.innerHTML = LENS_SVG;
  return art;
}

/** 装饰用的「心智镜」视觉：同心环 + 八个维度轨道，纯 CSS/SVG，不依赖图片。 */
function visualPanel() {
  const nodes = ['言语', '记忆', '空间', '知觉', '运算', '归纳', '自然', '流畅'];
  const orbit = el('div', { class: 'auth-orbit' }, [
    el('span', { class: 'auth-ring auth-ring-1' }),
    el('span', { class: 'auth-ring auth-ring-2' }),
    el('span', { class: 'auth-ring auth-ring-3' }),
    el('div', { class: 'auth-lens', 'aria-hidden': 'true' }, [
      el('span', { class: 'auth-lens-glow' }),
      lensGraphic(),
    ]),
    // 转子：整组节点绕镜子缓慢公转；每个节点的文字再反向旋转，保持正立。
    el(
      'div',
      { class: 'auth-rotor' },
      nodes.map((text) =>
        el('span', { class: 'auth-node' }, [el('span', { class: 'auth-node-text', text })]),
      ),
    ),
  ]);
  return el('div', { class: 'auth-visual', 'aria-hidden': 'true' }, [
    orbit,
    el('p', { class: 'auth-visual-caption', text: '八个方向，一次安静的自我观察' }),
  ]);
}

export function renderLogin(root, ctx) {
  const form = el('form', { class: 'card form auth-form', novalidate: 'true' });
  const status = statusNode('login');
  const username = input('login-username', 'text', 'username', '例如 mind.demo');
  username.dataset.field = 'username';
  const password = passwordControl('login-password', 'current-password', '登录密码', 'password');

  form.appendChild(field('用户名', username));
  form.appendChild(field('密码', password));
  form.appendChild(status);
  form.appendChild(submitButton('登录'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const problems = credentialIssues(collect(form));
    if (problems.length) {
      status.className = 'auth-status bad';
      status.textContent = problems[0];
      return;
    }
    runSubmit(form, status, ctx, (values) => login(values.username, values.password));
  });

  root.appendChild(
    el('section', { class: 'page auth-page' }, [
      visualPanel(),
      el('div', { class: 'auth-panel' }, [
        ...header(
          '登录后继续',
          '回到你的那台心智镜',
          '账号只用于在任意设备上找回你自己的测评、记忆与对话。',
        ),
        form,
        switchLine('login', ctx),
        el('p', {
          class: 'tiny',
          text: '本站不收集邮箱：忘记密码无法自助找回，需要重置请联系发起人。',
        }),
        disclaimer(),
      ]),
    ]),
  );
  if (!session.checked) loadSession().catch(() => {});
  username.focus();
}

export function renderRegister(root, ctx) {
  const form = el('form', { class: 'card form auth-form', novalidate: 'true' });
  const status = statusNode('register');
  const username = input(
    'register-username',
    'text',
    'username',
    '2–32 位，字母/数字/点/下划线/中文',
  );
  username.dataset.field = 'username';
  const password = passwordControl(
    'register-password',
    'new-password',
    '至少 8 位，含字母与数字',
    'password',
  );
  const confirm = passwordControl('register-confirm', 'new-password', '再输入一次', 'confirm');
  const { box: adult, label: adultLabel } = checkbox('register-adult', [
    el('span', {
      text: '我已满 18 岁，并理解这只是自我观察工具，不是诊断。',
    }),
  ]);
  adult.dataset.field = 'adult';

  form.appendChild(field('用户名', username));
  form.appendChild(field('密码', password, '至少 8 位，包含字母与数字'));
  form.appendChild(field('确认密码', confirm));
  form.appendChild(adultLabel);
  form.appendChild(status);
  form.appendChild(submitButton('注册并进入'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!session.registrationOpen) {
      status.className = 'auth-status bad';
      status.textContent = '当前已关闭自助注册';
      return;
    }
    const problems = credentialIssues(collect(form), { requireAdult: true });
    if (problems.length) {
      status.className = 'auth-status bad';
      status.textContent = problems[0];
      return;
    }
    runSubmit(form, status, ctx, (values) => register(values));
  });

  root.appendChild(
    el('section', { class: 'page auth-page' }, [
      visualPanel(),
      el('div', { class: 'auth-panel' }, [
        ...header(
          '新建账号',
          '注册一个只属于你的心智镜',
          '只需用户名和密码：不收集邮箱、手机号、姓名，也不做任何身份识别。',
        ),
        form,
        switchLine('register', ctx),
        el('p', {
          class: 'tiny',
          text: '你的测评、记忆与对话只与这个账号绑定；随时可在设置里导出，或注销账号并立即删除全部数据。',
        }),
        disclaimer(),
      ]),
    ]),
  );
  if (!session.checked) loadSession().catch(() => {});
  username.focus();
}
