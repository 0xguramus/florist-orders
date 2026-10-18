import { handler, json, readJson, parseId, loadWriteOffs, validateWriteOff, HttpError } from '../../_lib/db.js';

const notFound = () => new HttpError(404, 'ჩამოწერა ვერ მოიძებნა. შესაძლოა უკვე წაშლილია.');

export const onRequestGet = handler(async ({ params, env }) => {
  const [writeoff] = await loadWriteOffs(env.DB, 'WHERE id = ?', [parseId(params.id)]);
  if (!writeoff) throw notFound();
  return json({ writeoff });
});

// PUT /api/writeoffs/:id — replace fields and items
export const onRequestPut = handler(async ({ params, request, env }) => {
  const id = parseId(params.id), db = env.DB;
  const w = await validateWriteOff(db, await readJson(request));
  const [upd] = await db.batch([
    db.prepare(`UPDATE write_offs SET date = ?, reason = ?, note = ?, updated_at = datetime('now') WHERE id = ?`).bind(w.date, w.reason, w.note, id),
    db.prepare('DELETE FROM write_off_items WHERE write_off_id = ?').bind(id),
    ...w.items.map(it => db.prepare('INSERT INTO write_off_items (write_off_id, flower_id, flower_name, qty) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM write_offs WHERE id = ?)').bind(id, it.flowerId, it.name, it.qty, id)),
  ]);
  if (!upd.meta.changes) throw notFound();
  const { date, reason, note, items } = w;
  return json({ writeoff: { id, date, reason, note, items } });
});

// DELETE /api/writeoffs/:id
export const onRequestDelete = handler(async ({ params, env }) => {
  const id = parseId(params.id), db = env.DB;
  const [, del] = await db.batch([
    db.prepare('DELETE FROM write_off_items WHERE write_off_id = ?').bind(id),
    db.prepare('DELETE FROM write_offs WHERE id = ?').bind(id),
  ]);
  if (!del.meta.changes) throw notFound();
  return json({ ok: true });
});
