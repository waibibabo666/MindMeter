/** 渲染失败时的兜底页：一句人话 + 两个出口，不显示堆栈。 */
import { el, button } from '../ui.js';
import { classifyError, describeError } from '../errors.js';

export function renderErrorPage(root, ctx, error) {
  const code = classifyError(error);
  const { title, hint } = describeError(code);

  root.appendChild(
    el('section', { class: 'page', 'aria-labelledby': 'error-title' }, [
      el('p', { class: 'kicker', text: '出了点问题' }),
      el('h1', { id: 'error-title', class: 'page-title', text: title }),
      el('p', { class: 'lead', text: hint }),
      el('div', { class: 'row' }, [
        button('返回首页', () => ctx.go('/'), { variant: 'primary' }),
        button('重试', () => globalThis.location.reload()),
      ]),
      el('p', {
        class: 'tiny',
        text: `错误码：${code}。若反复出现，请在设置里清除本地数据后重试。`,
      }),
    ]),
  );
}
