/**
 * 界面前偏好：侧栏 / 右栏是否收起。
 *
 * 存在 localStorage（纯显示偏好，不进数据库、不参与导出）。
 * 默认都展开；折叠状态只影响 ≥1200px 的桌面布局。
 */

const KEY = 'mindmeter.ui.v1';

const DEFAULTS = { navCollapsed: false, railCollapsed: false };

function store() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readUiPrefs() {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      navCollapsed: Boolean(parsed && parsed.navCollapsed),
      railCollapsed: Boolean(parsed && parsed.railCollapsed),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeUiPrefs(prefs) {
  try {
    store()?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 存不进去只影响下次打开，不阻断当前操作。
  }
}

export function applyUiPrefs(prefs) {
  document.body.classList.toggle('nav-collapsed', prefs.navCollapsed);
  document.body.classList.toggle('rail-collapsed', prefs.railCollapsed);
}
