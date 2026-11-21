/**
 * 界面偏好：侧栏 / 右栏是否收起，快捷操作列表是否折叠。
 *
 * 存在 localStorage（纯显示偏好，不进数据库、不参与导出）。
 * 默认都展开；折叠状态只影响 ≥1200px 的桌面布局（快捷操作折叠全宽度生效）。
 */

const KEY = 'mindmeter.ui.v1';

const DEFAULTS = {
  navCollapsed: false,
  railCollapsed: false,
  railMin: false,
  // 是否允许 AI 在回答时参考记忆（画像/摘要/建议）；默认开启，可随时关闭。
  memoryInPrompt: true,
  // 流式输出（实验）：开启后回答逐段出现，失败自动回退普通请求。
  streamReply: false,
};

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
      railMin: Boolean(parsed && parsed.railMin),
      memoryInPrompt: parsed && parsed.memoryInPrompt === false ? false : true,
      streamReply: Boolean(parsed && parsed.streamReply),
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
  document.body.classList.toggle('rail-min', prefs.railMin);
}
