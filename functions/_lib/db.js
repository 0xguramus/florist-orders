// Shared helpers: schema bootstrap, JSON responses, order loading.
export const DEFAULT_FLOWERS = ['ვარდი წითელი', 'ვარდი თეთრი', 'ტულიფანი', 'ქრიზანთემა', 'ევკალიფტი', 'გიპსოფილა', 'ლისიანთუსი'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS flowers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER NOT NULL UNIQUE, date TEXT NOT NULL, price REAL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)`,
  `CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, flower_id INTEGER REFERENCES flowers(id), flower_name TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0))`,
  `CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_items_flower ON order_items(flower_id)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures(ip, ts)`,
];

let ready = null; // per-isolate memo
export function ensureSchema(env) {
  if (!env.DB) throw new HttpError(500, 'ბაზა არ არის მიერთებული (D1 binding „DB“).');
  if (!ready) {
    ready = (async () => {
      await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
      // Seed the default flower list exactly once (an emptied list stays empty).
      const r = await env.DB.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('flowers_seeded', datetime('now'))`).run();
      if (r.meta.changes) {
        await env.DB.batch(DEFAULT_FLOWERS.map(n => env.DB.prepare('INSERT OR IGNORE INTO flowers (name) VALUES (?)').bind(n)));
      }
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

// Wraps a handler: ensures schema, converts errors to Georgian JSON errors.
export const handler = fn => async ctx => {
  try {
    await ensureSchema(ctx.env);
    return await fn(ctx);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'სერვერის შეცდომა. სცადეთ თავიდან.' }, 500);
  }
};

export async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'არასწორი მოთხოვნა.'); }
}

export function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'ჩანაწერი ვერ მოიძებნა.');
  return n;
}

export async function loadOrders(db, where = '', binds = []) {
  const { results: orders } = await db.prepare(`SELECT id, number, date, price, note FROM orders ${where} ORDER BY date DESC, number DESC`).bind(...binds).all();
  if (!orders.length) return [];
  const ids = orders.map(o => o.id);
  const items = [];
  for (let i = 0; i < ids.length; i += 90) { // stay under D1's bound-parameter limit
    const chunk = ids.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT order_id, flower_id, flower_name, qty FROM order_items WHERE order_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id`).bind(...chunk).all();
    items.push(...results);
  }
  const byOrder = new Map(orders.map(o => [o.id, (o.items = [], o)]));
  for (const it of items) byOrder.get(it.order_id)?.items.push({ flowerId: it.flower_id, name: it.flower_name, qty: it.qty });
  return orders;
}

// Validates an order payload; resolves flower names from the DB.
export async function validateOrder(db, body) {
  const number = Number(body?.number);
  if (!Number.isInteger(number) || number < 1 || number > 1e12) throw new HttpError(400, 'მიუთითეთ შეკვეთის სწორი ნომერი.');
  const date = String(body?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) throw new HttpError(400, 'მიუთითეთ სწორი თარიღი.');
  let price = body?.price;
  if (price === '' || price === undefined) price = null;
  if (price !== null) {
    price = Math.round(Number(price) * 100) / 100;
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'ფასი არასწორია.');
  }
  const note = String(body?.note ?? '').trim().slice(0, 500);
  const raw = Array.isArray(body?.items) ? body.items : [];
  const merged = new Map();
  for (const it of raw) {
    const fid = Number(it?.flowerId), qty = Number(it?.qty);
    if (!Number.isInteger(fid) || fid < 1 || !Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'ყვავილი ან რაოდენობა არასწორია.');
    merged.set(fid, (merged.get(fid) || 0) + qty);
  }
  if (!merged.size) throw new HttpError(400, 'დაამატეთ ერთი ყვავილი მაინც.');
  if (merged.size > 90) throw new HttpError(400, 'ძალიან ბევრი ყვავილია ერთ შეკვეთაში.');
  const fids = [...merged.keys()];
  const { results } = await db.prepare(`SELECT id, name FROM flowers WHERE id IN (${fids.map(() => '?').join(',')})`).bind(...fids).all();
  const names = new Map(results.map(r => [r.id, r.name]));
  const missing = fids.filter(id => !names.has(id));
  if (missing.length) throw new HttpError(400, 'ერთ-ერთი ყვავილი სიაში აღარ არსებობს. განაახლეთ გვერდი.');
  const items = fids.map(id => ({ flowerId: id, name: names.get(id), qty: merged.get(id) }));
  return { number, date, price, note, items };
}

export const isUniqueNumberError = e => /UNIQUE constraint failed: orders\.number/i.test(String(e?.message || e?.cause?.message || e));
export const duplicateNumber = n => new HttpError(409, `№${n} უკვე არსებობს. ჩაწერეთ სხვა ნომერი.`);

export function cleanName(v) {
  const name = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new HttpError(400, 'ჩაწერეთ ყვავილის სახელი.');
  return name;
}
