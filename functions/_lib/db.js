// Shared helpers: schema bootstrap, JSON responses, order loading.
export const DEFAULT_FLOWERS = ['ვარდი წითელი', 'ვარდი თეთრი', 'ტულიფანი', 'ქრიზანთემა', 'ევკალიფტი', 'გიპსოფილა', 'ლისიანთუსი'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS flowers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, number INTEGER NOT NULL UNIQUE, date TEXT NOT NULL, price REAL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date)`,
  `CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, flower_id INTEGER REFERENCES flowers(id), flower_name TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0))`,
  `CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_items_flower ON order_items(flower_id)`,
  `CREATE TABLE IF NOT EXISTS write_offs (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT 'other' CHECK (reason IN ('dried','damaged','other')), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE INDEX IF NOT EXISTS idx_write_offs_date ON write_offs(date)`,
  `CREATE TABLE IF NOT EXISTS write_off_items (id INTEGER PRIMARY KEY AUTOINCREMENT, write_off_id INTEGER NOT NULL REFERENCES write_offs(id) ON DELETE CASCADE, flower_id INTEGER REFERENCES flowers(id), flower_name TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0))`,
  `CREATE INDEX IF NOT EXISTS idx_wo_items_wo ON write_off_items(write_off_id)`,
  `CREATE INDEX IF NOT EXISTS idx_wo_items_flower ON write_off_items(flower_id)`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, ts INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures(ip, ts)`,
];

// Bump when SCHEMA changes: a fresh isolate then does one cheap read instead of ~17 DDL writes.
export const SCHEMA_VERSION = '3';

let ready = null; // per-isolate memo
export function ensureSchema(env) {
  if (!env.DB) throw new HttpError(500, 'ბაზა არ არის მიერთებული (D1 binding „DB“).');
  if (!ready) {
    ready = (async () => {
      const db = env.DB;
      const cur = await db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).first('value').catch(() => null); // meta may not exist yet
      if (cur === SCHEMA_VERSION) return;
      // Idempotent: CREATE ... IF NOT EXISTS never drops data.
      await db.batch(SCHEMA.map(s => db.prepare(s)));
      // Seed the default flower list exactly once (an emptied list stays empty).
      const r = await db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('flowers_seeded', datetime('now'))`).run();
      if (r.meta.changes) {
        await db.batch(DEFAULT_FLOWERS.map(n => db.prepare('INSERT OR IGNORE INTO flowers (name) VALUES (?)').bind(n)));
      }
      await db.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(SCHEMA_VERSION).run();
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
  const date = validDate(body?.date);
  let price = body?.price;
  if (price === '' || price === undefined) price = null;
  if (price !== null) {
    price = Math.round(Number(price) * 100) / 100;
    if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'ფასი არასწორია.');
  }
  const note = String(body?.note ?? '').trim().slice(0, 500);
  const items = await validItems(db, body?.items, 'ძალიან ბევრი ყვავილია ერთ შეკვეთაში.');
  return { number, date, price, note, items };
}

export function validDate(v) {
  const date = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) throw new HttpError(400, 'მიუთითეთ სწორი თარიღი.');
  return date;
}

// Validates [{flowerId, qty}], merges duplicates, resolves names from the DB.
export async function validItems(db, rawItems, tooMany = 'ძალიან ბევრი ყვავილია ერთ ჩანაწერში.') {
  const raw = Array.isArray(rawItems) ? rawItems : [];
  const merged = new Map();
  for (const it of raw) {
    const fid = Number(it?.flowerId), qty = Number(it?.qty);
    if (!Number.isInteger(fid) || fid < 1 || !Number.isInteger(qty) || qty < 1 || qty > 100000) throw new HttpError(400, 'ყვავილი ან რაოდენობა არასწორია.');
    merged.set(fid, (merged.get(fid) || 0) + qty);
  }
  if (!merged.size) throw new HttpError(400, 'დაამატეთ ერთი ყვავილი მაინც.');
  if (merged.size > 90) throw new HttpError(400, tooMany);
  const fids = [...merged.keys()];
  const { results } = await db.prepare(`SELECT id, name FROM flowers WHERE id IN (${fids.map(() => '?').join(',')})`).bind(...fids).all();
  const names = new Map(results.map(r => [r.id, r.name]));
  const missing = fids.filter(id => !names.has(id));
  if (missing.length) throw new HttpError(400, 'ერთ-ერთი ყვავილი სიაში აღარ არსებობს. განაახლეთ გვერდი.');
  const items = fids.map(id => ({ flowerId: id, name: names.get(id), qty: merged.get(id) }));
  return items;
}

export const WRITE_OFF_REASONS = ['dried', 'damaged', 'other'];

export async function validateWriteOff(db, body) {
  const date = validDate(body?.date);
  const reason = String(body?.reason || '');
  if (!WRITE_OFF_REASONS.includes(reason)) throw new HttpError(400, 'მიუთითეთ ჩამოწერის მიზეზი.');
  const note = String(body?.note ?? '').trim().slice(0, 500);
  const items = await validItems(db, body?.items);
  return { date, reason, note, items };
}

export async function loadWriteOffs(db, where = '', binds = []) {
  const { results: rows } = await db.prepare(`SELECT id, date, reason, note FROM write_offs ${where} ORDER BY date DESC, id DESC`).bind(...binds).all();
  if (!rows.length) return [];
  const ids = rows.map(o => o.id);
  const items = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT write_off_id, flower_id, flower_name, qty FROM write_off_items WHERE write_off_id IN (${chunk.map(() => '?').join(',')}) ORDER BY id`).bind(...chunk).all();
    items.push(...results);
  }
  const byId = new Map(rows.map(o => [o.id, (o.items = [], o)]));
  for (const it of items) byId.get(it.write_off_id)?.items.push({ flowerId: it.flower_id, name: it.flower_name, qty: it.qty });
  return rows;
}

export const isUniqueNumberError = e => /UNIQUE constraint failed: orders\.number/i.test(String(e?.message || e?.cause?.message || e));
export const duplicateNumber = n => new HttpError(409, `№${n} უკვე არსებობს. ჩაწერეთ სხვა ნომერი.`);

export function cleanName(v) {
  const name = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) throw new HttpError(400, 'ჩაწერეთ ყვავილის სახელი.');
  return name;
}

// Everything the app needs, in ONE D1 round trip (a batch of 5 reads).
export async function loadAll(db) {
  const [fl, or, oi, wo, wi] = await db.batch([
    db.prepare('SELECT id, name FROM flowers WHERE active = 1 ORDER BY id'),
    db.prepare('SELECT id, number, date, price, note FROM orders ORDER BY date DESC, number DESC'),
    db.prepare('SELECT order_id, flower_id, flower_name, qty FROM order_items ORDER BY id'),
    db.prepare('SELECT id, date, reason, note FROM write_offs ORDER BY date DESC, id DESC'),
    db.prepare('SELECT write_off_id, flower_id, flower_name, qty FROM write_off_items ORDER BY id'),
  ]);
  const attach = (rows, items, key) => {
    const by = new Map(rows.map(r => [r.id, (r.items = [], r)]));
    for (const it of items) by.get(it[key])?.items.push({ flowerId: it.flower_id, name: it.flower_name, qty: it.qty });
    return rows;
  };
  return {
    flowers: fl.results,
    orders: attach(or.results, oi.results, 'order_id'),
    writeoffs: attach(wo.results, wi.results, 'write_off_id'),
  };
}
