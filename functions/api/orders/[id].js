import { handler, json, readJson, parseId, loadOrders, validateOrder, isUniqueNumberError, duplicateNumber, HttpError } from '../../_lib/db.js';

const notFound = () => new HttpError(404, 'შეკვეთა ვერ მოიძებნა. შესაძლოა უკვე წაშლილია.');

export const onRequestGet = handler(async ({ params, env }) => {
  const [order] = await loadOrders(env.DB, 'WHERE id = ?', [parseId(params.id)]);
  if (!order) throw notFound();
  return json({ order });
});

// PUT /api/orders/:id — replace order fields and items
export const onRequestPut = handler(async ({ params, request, env }) => {
  const id = parseId(params.id), db = env.DB;
  const o = await validateOrder(db, await readJson(request));
  if (!(await db.prepare('SELECT 1 FROM orders WHERE id = ?').bind(id).first())) throw notFound();
  try {
    await db.batch([
      db.prepare(`UPDATE orders SET number = ?, date = ?, price = ?, note = ?, updated_at = datetime('now') WHERE id = ?`).bind(o.number, o.date, o.price, o.note, id),
      db.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id),
      ...o.items.map(it => db.prepare('INSERT INTO order_items (order_id, flower_id, flower_name, qty) VALUES (?, ?, ?, ?)').bind(id, it.flowerId, it.name, it.qty)),
    ]);
  } catch (e) {
    if (isUniqueNumberError(e)) throw duplicateNumber(o.number);
    throw e;
  }
  const [order] = await loadOrders(db, 'WHERE id = ?', [id]);
  return json({ order });
});

// DELETE /api/orders/:id
export const onRequestDelete = handler(async ({ params, env }) => {
  const id = parseId(params.id), db = env.DB;
  const [, del] = await db.batch([
    db.prepare('DELETE FROM order_items WHERE order_id = ?').bind(id),
    db.prepare('DELETE FROM orders WHERE id = ?').bind(id),
  ]);
  if (!del.meta.changes) throw notFound();
  return json({ ok: true });
});
