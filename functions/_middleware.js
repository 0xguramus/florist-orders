import { COOKIE, getCookie, verifyToken, isConfigured } from './_lib/auth.js';

// Reachable without a session: the login page, its fonts, and the login/logout endpoints.
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/api/login', '/api/logout']);
const PUBLIC_PREFIXES = ['/fonts/'];
const isPublic = p => PUBLIC_PATHS.has(p) || PUBLIC_PREFIXES.some(x => p.startsWith(x));

const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Strict-Transport-Security': 'max-age=31536000',
};

function withHeaders(res, extra = {}) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) r.headers.set(k, v);
  return r;
}

const jsonErr = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const path = url.pathname;
  const isApi = path.startsWith('/api/');

  // Fail closed if the secrets are missing.
  if (!isConfigured(env)) {
    const msg = 'საიტი ჯერ არ არის კონფიგურირებული (APP_PASSWORD / SESSION_SECRET).';
    return withHeaders(isApi ? jsonErr(503, msg) : new Response(msg, { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  }

  // Basic CSRF guard for state-changing API calls (SameSite=Lax already blocks most).
  if (isApi && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return withHeaders(jsonErr(403, 'მოთხოვნა უარყოფილია.'));
  }

  const authed = await verifyToken(env.SESSION_SECRET, getCookie(request, COOKIE));

  if (isPublic(path)) {
    if (authed && (path === '/login' || path === '/login.html') && request.method === 'GET') {
      return withHeaders(Response.redirect(new URL('/', url), 302));
    }
    return withHeaders(await next(), path.startsWith('/login') ? { 'Cache-Control': 'no-store' } : {});
  }

  if (!authed) {
    if (isApi) return withHeaders(jsonErr(401, 'სესია ამოიწურა. შედით თავიდან.'));
    return withHeaders(new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } }));
  }

  const res = await next();
  const type = res.headers.get('content-type') || '';
  // Don't let shared caches keep protected pages.
  return withHeaders(res, type.includes('text/html') ? { 'Cache-Control': 'private, no-store' } : { 'Cache-Control': res.headers.get('Cache-Control') || 'private, max-age=0, must-revalidate' });
}
