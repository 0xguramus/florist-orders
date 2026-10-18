import { ensureSchema } from '../_lib/db.js';
import { makeToken, safeEqual, sessionCookie } from '../_lib/auth.js';

const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 10;

// POST /api/login  — body: JSON {password} or form password=...
export async function onRequestPost({ request, env }) {
  const isForm = !(request.headers.get('content-type') || '').includes('application/json');
  const reply = (ok, status, error, headers = {}) => isForm
    ? new Response(null, { status: 303, headers: { Location: ok ? '/' : `/login?e=${status === 429 ? 'many' : 'bad'}`, ...headers } })
    : new Response(JSON.stringify(ok ? { ok: true } : { error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

  let password = '';
  try {
    if (isForm) password = String((await request.formData()).get('password') || '');
    else password = String((await request.json())?.password || '');
  } catch { return reply(false, 400, 'არასწორი მოთხოვნა.'); }

  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const now = Date.now();
  let db = null;
  try { await ensureSchema(env); db = env.DB; } catch { /* login still works without the DB, just without throttling */ }

  if (db) {
    const row = await db.prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND ts > ?').bind(ip, now - WINDOW_MS).first();
    if (row.n >= MAX_FAILS) return reply(false, 429, 'ძალიან ბევრი მცდელობა. სცადეთ 15 წუთში.');
  }

  if (!password || !(await safeEqual(password, env.APP_PASSWORD))) {
    if (db) await db.batch([
      db.prepare('INSERT INTO login_failures (ip, ts) VALUES (?, ?)').bind(ip, now),
      db.prepare('DELETE FROM login_failures WHERE ts < ?').bind(now - 24 * 3600 * 1000),
    ]);
    return reply(false, 401, 'პაროლი არასწორია.');
  }

  if (db) await db.prepare('DELETE FROM login_failures WHERE ip = ?').bind(ip).run();
  return reply(true, 200, null, { 'Set-Cookie': sessionCookie(await makeToken(env.SESSION_SECRET)) });
}
