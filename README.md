# FLOWTRACKER (florist-orders)

Password-protected order log for the flower shop. Cloudflare Pages + Pages Functions + D1.

- `public/` — static site (output directory)
- `functions/_middleware.js` — protects everything except `/login`, `/fonts/*`, `/api/login`, `/api/logout`
- `functions/api/` — `orders` (GET, POST, PUT/DELETE `/:id`), `flowers` (GET, POST, PUT/DELETE `/:id`), `writeoffs` (ჩამოწერა: GET, POST, GET/PUT/DELETE `/:id`), `bootstrap` (GET: flowers + orders + write-offs in one D1 batch), `login`, `logout`
- `schema.sql` — reference schema; tables are created automatically on the first request

## Cloudflare Pages settings
- Framework preset: None · Build command: *(empty)* · Build output directory: `public` · Root directory: *(empty)*
- Bindings: D1 database → variable name `DB`
- Variables (secret): `APP_PASSWORD`, `SESSION_SECRET` (32+ random bytes)
- Compatibility date: 2025-10-01 or later

## Local dev
```
npx wrangler pages dev public --d1 DB=florist-local --binding APP_PASSWORD=test --binding SESSION_SECRET=x --compatibility-date=2025-10-01
```

## Performance notes
- The app opens from the last data cached in `localStorage` (`ft:data:v1`) and revalidates in the background with one `/api/bootstrap` call (one D1 batch). The cache is cleared on logout and on any 401.
- Saves, edits and deletes update the UI in place (deletes are optimistic and roll back on error). Tab switches render from memory; a background sync runs at most every 30 s (and on returning to the app after 10 s).
- `app.js` / `style.css` are requested with `?v=N` and served `immutable` for a year, like the fonts, so **bump `v` in index.html and login.html on every frontend change**. They contain no data and are public so the login page can prefetch them. All data stays behind `/api` auth.
- Schema migration runs once per isolate and only when `meta.schema_version` differs from `SCHEMA_VERSION` in `functions/_lib/db.js` (bump it when the schema changes).
