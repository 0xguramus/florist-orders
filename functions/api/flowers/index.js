import { handler, json, readJson, cleanName } from '../../_lib/db.js';

// GET /api/flowers — active flower list
export const onRequestGet = handler(async ({ env }) => {
  const { results } = await env.DB.prepare('SELECT id, name FROM flowers WHERE active = 1 ORDER BY id').all();
  return json({ flowers: results });
});

// POST /api/flowers — add (or re-activate a removed one with the same name)
export const onRequestPost = handler(async ({ request, env }) => {
  const name = cleanName((await readJson(request))?.name);
  const db = env.DB;
  const existing = await db.prepare('SELECT id, name, active FROM flowers WHERE lower(name) = lower(?)').bind(name).first();
  if (existing) {
    if (!existing.active) await db.prepare('UPDATE flowers SET active = 1 WHERE id = ?').bind(existing.id).run();
    return json({ flower: { id: existing.id, name: existing.name } });
  }
  const flower = await db.prepare('INSERT INTO flowers (name) VALUES (?) RETURNING id, name').bind(name).first();
  return json({ flower }, 201);
});
