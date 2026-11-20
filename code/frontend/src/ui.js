/** 极小 DOM 工具，避免 innerHTML 拼接。 */
import { MIRROR_SMALL } from './icons.js';

function applyAttr(node, key, value) {
  if (key === 'class') node.className = value;
  else if (key === 'text') node.textContent = value;
  else if (key === 'html') node.innerHTML = value;
  else if (key.startsWith('on') && typeof value === 'function') {
    node.addEventListener(key.slice(2).toLowerCase(), value);
  } else if (key === 'dataset') {
    Object.assign(node.dataset, value);
  } else {
    node.setAttribute(key, value);
  }
}

function appendChildren(node, children) {
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    applyAttr(node, key, value);
  }
  appendChildren(node, children);
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** 单调时钟优先，避免系统时间被改动时反应时失真。 */
export function now() {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

export function mount(parent, node) {
  clear(parent);
  parent.appendChild(node);
}

/** 统一按钮：移动端最小 44×44 触控区由 CSS 保证。 */
export function button(label, onClick, options = {}) {
  return el(
    'button',
    {
      class: `btn ${options.variant || ''}`.trim(),
      type: 'button',
      onclick: onClick,
      'aria-label': options.ariaLabel || null,
    },
    label,
  );
}

/**
 * 空状态：品牌小图 + 一句标题 + 一句解释 + 可选主行动 + 可选提示。
 * art 传 false 时不画插画——同一页出现多个空状态时避免插画重复。
 * text 省略时只画标题：板块解释已经在标题旁的浮框里时，空态再复述一遍就是
 * 同一句话出现两次（人工测试反馈 3 · 模式 2）。
 *
 * 注意形参名：这里刻意用 `hintText` 而不是 `hint`。模块级导出的 `hint()`
 * 组件如果同名会被解构遮蔽（实测踩过一次 TypeError），改名把这颗雷拆掉。
 */
export function emptyState({ title, text, actionLabel, onAction, hintText, art = true }) {
  const children = [];
  if (art) children.push(el('div', { class: 'empty-art', html: MIRROR_SMALL }));
  children.push(el('p', { class: 'empty-state-title', text: title }));
  if (text) children.push(el('p', { class: 'muted', text }));
  const node = el('div', { class: 'empty-state' }, children);
  if (actionLabel && onAction) {
    node.appendChild(button(actionLabel, onAction, { variant: 'primary' }));
  }
  if (hintText) node.appendChild(el('p', { class: 'tiny', text: hintText }));
  return node;
}

/**
 * 悬浮解释（反馈：说明性文字不该常驻页面，只留板块名与按钮名）。
 * 用 tabindex + aria-label 保证键盘和读屏也能拿到；文案同时写进 title 作为
 * 原生兜底（浏览器扩展或禁用 CSS 时仍可见）。
 */
export function hint(text, options = {}) {
  return el('span', {
    class: `hint${options.edge ? ' edge-left' : ''}`,
    tabindex: '0',
    role: 'note',
    'data-tip': String(text || ''),
    'aria-label': `解释：${text}`,
    title: String(text || ''),
    text: '?',
  });
}

/** 标题 + 悬浮解释的组合，页面标题行统一用它。 */
export function titled(tag, label, tip, options = {}) {
  return el(tag, Object.assign({ class: 'card-title' }, options.attrs || {}), [
    label,
    tip ? hint(tip, options) : null,
  ]);
}

/** 秒级倒计时；返回值用于清理。 */
export function ticker(seconds, onTick, onEnd) {
  let left = seconds;
  onTick(left);
  const id = setInterval(() => {
    left -= 1;
    onTick(left);
    if (left <= 0) {
      clearInterval(id);
      onEnd();
    }
  }, 1000);
  return () => clearInterval(id);
}
