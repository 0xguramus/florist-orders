# შეკვეთების ჟურნალი (florist-orders)

Password-protected order log for the flower shop. Cloudflare Pages + Pages Functions + D1.

- `public/` — static site (output directory)
- `functions/_middleware.js` — protects everything except `/login`, `/fonts/*`, `/api/login`, `/api/logout`
- `functions/api/` — `orders` (GET, POST, PUT/DELETE `/:id`), `flowers` (GET, POST, PUT/DELETE `/:id`), `login`, `logout`
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
