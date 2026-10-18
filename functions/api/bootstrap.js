import { handler, json, loadAll } from '../_lib/db.js';

// GET /api/bootstrap — flowers + orders + write-offs in one request / one D1 batch
export const onRequestGet = handler(async ({ env }) => json(await loadAll(env.DB)));
