// Signed session cookie: "<expiryMs>.<base64url HMAC-SHA256(SESSION_SECRET, 'session.v1.<expiryMs>')>"
export const COOKIE = '__Host-fo_session';
export const MAX_AGE = 30 * 24 * 3600; // 30 days, seconds

const enc = new TextEncoder();
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = s => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
};
const hmacKey = secret => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function makeToken(secret, now = Date.now()) {
  const exp = now + MAX_AGE * 1000;
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`session.v1.${exp}`));
  return `${exp}.${b64url(sig)}`;
}

export async function verifyToken(secret, token, now = Date.now()) {
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(token || '');
  if (!m || Number(m[1]) <= now) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), fromB64url(m[2]), enc.encode(`session.v1.${m[1]}`)); // constant-time
  } catch { return false; }
}

export function getCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export const sessionCookie = token => `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Constant-time string comparison (hash both sides to equal length first).
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(String(s)))));
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export const isConfigured = env => !!(env.APP_PASSWORD && env.SESSION_SECRET);
