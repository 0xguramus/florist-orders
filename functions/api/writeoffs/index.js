import { handler, json, readJson, loadWriteOffs, validateWriteOff } from '../../_lib/db.js';

// GET /api/writeoffs — all write-offs with their items
export const onRequestGet = handler(async ({ env }) => json({ writeoffs: await loadWriteOffs(env.DB) }));

// POST /api/writeoffs — create
export const onRequestPost = handler(async ({ request, env }) => {
  const w = await validateWriteOff(env.DB, await readJson(request));
  const db = env.DB;
  // One batch = one transaction (D1 has a single writer), so MAX(id) is the row just inserted.
  const [ins] = await db.batch([
    db.prepare('INSERT INTO write_offs (date, reason, note) VALUES (?, ?, ?) RETURNING id').bind(w.date, w.reason, w.note),
    ...w.items.map(it => db.prepare('INSERT INTO write_off_items (write_off_id, flower_id, flower_name, qty) VALUES ((SELECT MAX(id) FROM write_offs), ?, ?, ?)')
      .bind(it.flowerId, it.name, it.qty)),
  ]);
  const { date, reason, note, items } = w;
  return json({ writeoff: { id: ins.results[0].id, date, reason, note, items } }, 201);
});
