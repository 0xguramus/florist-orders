import { clearCookie } from '../_lib/auth.js';

// POST /api/logout — clears the session cookie
export const onRequestPost = ({ request }) => {
  const isForm = !(request.headers.get('content-type') || '').includes('application/json');
  return isForm
    ? new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': clearCookie() } })
    : new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json; charset=utf-8', 'Set-Cookie': clearCookie(), 'cache-control': 'no-store' } });
};
