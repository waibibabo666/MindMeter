/**
 * 极简 hash 路由。
 *
 * 为什么用 hash 而不是 History API：静态文件可以直接由 FastAPI 的
 * StaticFiles 托管，不需要服务端把未知路径回退到 index.html；刷新时 hash
 * 天然保留，配合服务端保存的 draft 就能恢复进度。
 *
 * 认证页（/login、/register）由 auth.AUTH_PATHS 单独放行，未登录时其余
 * 路由一律由 app.js 的闸门前置拦截。
 *
 * 旧入口兼容：趋势页已并入报告页（用户测完第一次就去趋势页，看到的是空态，
 * 像功能坏了），但 `/trend` 仍是合法路径 —— 旧链接、书签、收藏、代码里的
 * `ctx.go('/trend')` 都会被重定向到 `/report`，而不是掉进「未知路由 → /」的黑洞。
 */

export const ROUTES = [
  '/',
  '/login',
  '/register',
  '/tier',
  '/intake',
  '/prep',
  '/task',
  '/report',
  '/settings',
  '/trend',
  '/memory',
  '/chat',
  '/games',
  '/about',
  '/game',
];

/**
 * 旧路径 → 现在的落点。兼容期内 `/trend` 仍留在 ROUTES 里（旧链接不该变成
 * 「未知路由」），命中这张表就重定向；app.js 的闸门与 dispatch 共用它。
 */
export const LEGACY_REDIRECTS = {
  '/trend': '/report',
};

/** 命中兼容路径时返回新路由，否则原样返回。 */
export function redirectRoute(route) {
  const target = LEGACY_REDIRECTS[route.path];
  if (!target) return route;
  return { path: target, param: null, full: target };
}

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
  if (route.path === '/task' || route.path === '/game') return Boolean(route.param);
  return true;
}

export function createRouter(onRoute) {
  let current = null;

  const dispatch = () => {
    const parsed = parseHash(globalThis.location.hash);
    const known = isKnown(parsed) ? parsed : { path: '/', param: null, full: '/' };
    const safe = redirectRoute(known);
    current = safe;
    // 地址栏同步改写：停在 #/trend 上刷新、复制链接、后退都不该再走一次旧页。
    // replaceState 不触发 hashchange，所以不会重进 dispatch。
    if (safe.full !== parsed.full) {
      globalThis.history.replaceState(null, '', `#${safe.full}`);
    }
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
