/**
 * 极简 hash 路由。
 *
 * 为什么用 hash 而不是 History API：静态文件可以直接双击打开，也能被
 * FastAPI 静态目录托管，不需要服务端把未知路径回退到 index.html。
 * 刷新时 hash 天然保留，配合 store 里的 draft 就能恢复进度。
 */

export const ROUTES = [
  '/',
  '/tier',
  '/consent',
  '/task',
  '/report',
  '/settings',
  '/trend',
  '/memory',
];

export function parseHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  const clean = raw.split('?')[0];
  const parts = clean.split('/').filter(Boolean);
  if (parts.length === 0) return { path: '/', param: null, full: '/' };
  const path = `/${parts[0]}`;
  const param = parts[1] || null;
  return { path, param, full: param ? `${path}/${param}` : path };
}

export function isKnown(route) {
  if (!ROUTES.includes(route.path)) return false;
  if (route.path === '/task') return Boolean(route.param);
  return true;
}

export function createRouter(onRoute) {
  let current = null;

  const dispatch = () => {
    const route = parseHash(globalThis.location.hash);
    const safe = isKnown(route) ? route : { path: '/', param: null, full: '/' };
    current = safe;
    onRoute(safe);
  };

  const go = (path, options = {}) => {
    const target = path.startsWith('#') ? path.slice(1) : path;
    if (options.replace) {
      globalThis.history.replaceState(null, '', `#${target}`);
      dispatch();
      return;
    }
    if (parseHash(globalThis.location.hash).full === target) {
      dispatch();
      return;
    }
    globalThis.location.hash = target;
  };

  return {
    start() {
      globalThis.addEventListener('hashchange', dispatch);
      dispatch();
    },
    stop() {
      globalThis.removeEventListener('hashchange', dispatch);
    },
    go,
    current: () => current,
  };
}
