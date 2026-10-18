-- florist-orders D1 schema. The app also creates these automatically on the
-- first request (functions/_lib/db.js), so running this file is optional:
--   npx wrangler d1 execute <DB_NAME> --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS flowers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,          -- 0 = removed from the list, kept for old orders
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  number     INTEGER NOT NULL UNIQUE,             -- shop order number, entered by hand
  date       TEXT    NOT NULL,                    -- YYYY-MM-DD
  price      REAL,                                -- GEL, optional
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(date);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  flower_id   INTEGER REFERENCES flowers(id),
  flower_name TEXT    NOT NULL,                   -- name snapshot
  qty         INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_items_order  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_flower ON order_items(flower_id);

CREATE TABLE IF NOT EXISTS write_offs (            -- ჩამოწერა: wasted / damaged flowers
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT    NOT NULL,                    -- YYYY-MM-DD
  reason     TEXT    NOT NULL DEFAULT 'other' CHECK (reason IN ('dried','damaged','other')),
  note       TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_write_offs_date ON write_offs(date);

CREATE TABLE IF NOT EXISTS write_off_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  write_off_id INTEGER NOT NULL REFERENCES write_offs(id) ON DELETE CASCADE,
  flower_id    INTEGER REFERENCES flowers(id),
  flower_name  TEXT    NOT NULL,                  -- name snapshot
  qty          INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_wo_items_wo     ON write_off_items(write_off_id);
CREATE INDEX IF NOT EXISTS idx_wo_items_flower ON write_off_items(flower_id);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL                              -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures(ip, ts);
