import { handler, json, readJson, parseId, cleanName, HttpError } from '../../_lib/db.js';

const notFound = () => new HttpError(404, 'ყვავილი ვერ მოიძებნა.');

// PUT /api/flowers/:id — rename (also updates the name in existing orders and write-offs)
export const onRequestPut = handler(async ({ params, request, env }) => {
  const id = parseId(params.id), db = env.DB;
  const name = cleanName((await readJson(request))?.name);
  const clash = await db.prepare('SELECT id FROM flowers WHERE lower(name) = lower(?) AND id != ?').bind(name, id).first();
  if (clash) throw new HttpError(409, `„${name}“ უკვე არის სიაში.`);
  const [upd] = await db.batch([
    db.prepare('UPDATE flowers SET name = ? WHERE id = ?').bind(name, id),
    db.prepare('UPDATE order_items SET flower_name = ? WHERE flower_id = ?').bind(name, id),
    db.prepare('UPDATE write_off_items SET flower_name = ? WHERE flower_id = ?').bind(name, id),
  ]);
  if (!upd.meta.changes) throw notFound();
  return json({ flower: { id, name } });
});

// DELETE /api/flowers/:id — remove from the list; old orders keep it
export const onRequestDelete = handler(async ({ params, env }) => {
  const r = await env.DB.prepare('UPDATE flowers SET active = 0 WHERE id = ? AND active = 1').bind(parseId(params.id)).run();
  if (!r.meta.changes) throw notFound();
  return json({ ok: true });
});
