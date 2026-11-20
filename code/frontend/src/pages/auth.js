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

export function renderLogin(root, ctx) {
  const form = el('form', { class: 'card form auth-form', novalidate: 'true' });
  const status = statusNode('login');
  const username = input('login-username', 'text', 'username', '例如 mind.demo');
  username.dataset.field = 'username';
  const password = input('login-password', 'password', 'current-password', '登录密码');
  password.dataset.field = 'password';

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
  const password = input(
    'register-password',
    'password',
    'new-password',
    '至少 8 位，含字母与数字',
  );
  password.dataset.field = 'password';
  const confirm = input('register-confirm', 'password', 'new-password', '再输入一次');
  confirm.dataset.field = 'confirm';
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
  );
  if (!session.checked) loadSession().catch(() => {});
  username.focus();
}
