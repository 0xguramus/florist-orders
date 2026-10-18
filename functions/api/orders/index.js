import { handler, json, readJson, loadOrders, validateOrder, isUniqueNumberError, duplicateNumber } from '../../_lib/db.js';

// GET /api/orders — all orders with their items
export const onRequestGet = handler(async ({ env }) => json({ orders: await loadOrders(env.DB) }));

// POST /api/orders — create
export const onRequestPost = handler(async ({ request, env }) => {
  const o = await validateOrder(env.DB, await readJson(request));
  const db = env.DB;
  let ins;
  try {
    // One batch = one transaction: if the number is taken, nothing is written.
    [ins] = await db.batch([
      db.prepare('INSERT INTO orders (number, date, price, note) VALUES (?, ?, ?, ?) RETURNING id').bind(o.number, o.date, o.price, o.note),
      ...o.items.map(it => db.prepare('INSERT INTO order_items (order_id, flower_id, flower_name, qty) VALUES ((SELECT id FROM orders WHERE number = ?), ?, ?, ?)')
        .bind(o.number, it.flowerId, it.name, it.qty)),
    ]);
  } catch (e) {
    if (isUniqueNumberError(e)) throw duplicateNumber(o.number);
    throw e;
  }
  // Answer from the validated data: no extra read round trips.
  const { number, date, price, note, items } = o;
  return json({ order: { id: ins.results[0].id, number, date, price, note, items } }, 201);
});
