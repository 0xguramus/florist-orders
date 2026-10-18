import { handler, json, readJson, loadOrders, validateOrder, isUniqueNumberError, duplicateNumber } from '../../_lib/db.js';

// GET /api/orders — all orders with their items
export const onRequestGet = handler(async ({ env }) => json({ orders: await loadOrders(env.DB) }));

// POST /api/orders — create
export const onRequestPost = handler(async ({ request, env }) => {
  const o = await validateOrder(env.DB, await readJson(request));
  const db = env.DB;
  try {
    // One batch = one transaction: if the number is taken, nothing is written.
    await db.batch([
      db.prepare('INSERT INTO orders (number, date, price, note) VALUES (?, ?, ?, ?)').bind(o.number, o.date, o.price, o.note),
      ...o.items.map(it => db.prepare('INSERT INTO order_items (order_id, flower_id, flower_name, qty) VALUES ((SELECT id FROM orders WHERE number = ?), ?, ?, ?)')
        .bind(o.number, it.flowerId, it.name, it.qty)),
    ]);
  } catch (e) {
    if (isUniqueNumberError(e)) throw duplicateNumber(o.number);
    throw e;
  }
  const [order] = await loadOrders(db, 'WHERE number = ?', [o.number]);
  return json({ order }, 201);
});
