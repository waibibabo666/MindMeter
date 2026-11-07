/**
 * 统一错误处理（L-01 增强）。
 *
 * 目标：任何一环出错，用户看到的是**一句人话 + 一个可点的出口**，而不是白屏。
 *
 * 三条约定：
 *   1. 错误分类集中在这里，页面不要自己拼文案；
 *   2. 上报只到 console（M1 无服务端），但接口保留，L2 换成本地上报即可；
 *   3. 兜底不吞错：即使渲染失败，也要把错误交给调用方，不能静默。
 */

export const ERROR_CODES = Object.freeze({
  RENDER_FAILED: 'render_failed',
  STORAGE_UNAVAILABLE: 'storage_unavailable',
  STORAGE_QUOTA: 'storage_quota',
  SCORING_FAILED: 'scoring_failed',
  LLM_TIMEOUT: 'llm_timeout',
  LLM_NETWORK: 'llm_network',
  LLM_HTTP: 'llm_http',
  LLM_AUTH: 'llm_auth',
  UNKNOWN: 'unknown',
});

/** 错误码 → 用户可见文案。刻意不暴露技术细节与堆栈。 */
const MESSAGES = Object.freeze({
  [ERROR_CODES.RENDER_FAILED]: {
    title: '页面没能正常显示',
    hint: '可能是本地数据异常。可以先返回首页重试；如果反复出现，请在设置里清除本地数据。',
  },
  [ERROR_CODES.STORAGE_UNAVAILABLE]: {
    title: '浏览器不允许保存数据',
    hint: '可能开着无痕模式，或禁用了本地存储。本次可以继续做，但刷新后进度会丢失。',
  },
  [ERROR_CODES.STORAGE_QUOTA]: {
    title: '本地存储空间不足',
    hint: '可以先导出数据再清除旧记录，然后重试。',
  },
  [ERROR_CODES.SCORING_FAILED]: {
    title: '这次的结果没能算出来',
    hint: '原始作答已保存。刷新后重新进入报告页可再算一次。',
  },
  [ERROR_CODES.LLM_TIMEOUT]: {
    title: '模型响应超时',
    hint: '已自动切回模板解释，报告不受影响。可以稍后重试。',
  },
  [ERROR_CODES.LLM_NETWORK]: {
    title: '连不上你配置的模型接口',
    hint: '检查一下 endpoint 是否可访问、是否需要代理。已自动切回模板解释。',
  },
  [ERROR_CODES.LLM_HTTP]: {
    title: '模型接口返回了错误',
    hint: '检查 model 名称与 Key 是否有效。已自动切回模板解释。',
  },
  [ERROR_CODES.LLM_AUTH]: {
    title: 'Key 或权限不对',
    hint: '确认 Key 没有过期、且允许浏览器直接调用。已自动切回模板解释。',
  },
  [ERROR_CODES.UNKNOWN]: {
    title: '出了点意外',
    hint: '可以返回首页重试；如果反复出现，把当前操作步骤告诉开发同学。',
  },
});

/** 取某错误码的用户文案；未知码回退到通用文案。 */
export function describeError(code) {
  return MESSAGES[code] || MESSAGES[ERROR_CODES.UNKNOWN];
}

/**
 * 把任意异常归类到错误码。
 * 只看 code / name / message 三个字段，保证可复现、可单测。
 */
export function classifyError(error) {
  if (!error) return ERROR_CODES.UNKNOWN;

  const code = typeof error === 'string' ? '' : String(error.code || '');
  const name = typeof error === 'string' ? '' : String(error.name || '');
  const message = String(typeof error === 'string' ? error : error.message || '');

  if (code === 'timeout') return ERROR_CODES.LLM_TIMEOUT;
  if (code === 'network') return ERROR_CODES.LLM_NETWORK;
  if (code === 'auth') return ERROR_CODES.LLM_AUTH;
  if (code.startsWith('http_')) return ERROR_CODES.LLM_HTTP;
  if (code === 'scoring') return ERROR_CODES.SCORING_FAILED;

  if (name === 'QuotaExceededError') return ERROR_CODES.STORAGE_QUOTA;
  if (/quota/i.test(message)) return ERROR_CODES.STORAGE_QUOTA;
  if (/localStorage|storage/i.test(message) && /denied|unavailable|blocked/i.test(message)) {
    return ERROR_CODES.STORAGE_UNAVAILABLE;
  }
  return ERROR_CODES.UNKNOWN;
}

/**
 * 上报错误。M1 只写 console；sink 可注入，便于测试与 L2 替换。
 * @returns {string} 归类后的错误码
 */
export function reportError(error, context = 'unknown', sink = console) {
  const code = classifyError(error);
  const detail = error && typeof error === 'object' ? error.message || '' : String(error || '');
  if (sink && typeof sink.warn === 'function') {
    sink.warn(`[MindMeter][${context}] ${code}`, detail);
  }
  return code;
}

/**
 * 渲染兜底：页面渲染抛错时改用 fallback，不把异常抛给路由。
 *
 * @param {(root, ctx, param) => any} render 页面渲染函数
 * @param {object} options
 * @param {object} options.root   挂载节点
 * @param {object} options.ctx    页面上下文
 * @param {string} [options.param] 路由参数
 * @param {(root, ctx, error) => any} [options.fallback] 出错时的渲染函数
 * @param {(error) => void} [options.onError] 上报回调
 * @returns {any} render 或 fallback 的返回值
 */
export function safeRender(render, options = {}) {
  const { root, ctx, param, fallback, onError } = options;
  try {
    return render(root, ctx, param);
  } catch (error) {
    if (typeof onError === 'function') onError(error);
    if (typeof fallback === 'function') return fallback(root, ctx, error);
    return undefined;
  }
}
