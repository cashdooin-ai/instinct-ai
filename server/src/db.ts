import pg from "pg";

/** Minimal query interface shared by the real Postgres pool and the in-process test database. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export function createPgDb(databaseUrl: string, caCert = ""): Db {
  const local = /localhost|127\.0\.0\.1/.test(databaseUrl);
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 5,
    // Supabase requires TLS. Pass DATABASE_CA_CERT to also verify the server certificate.
    ssl: local ? undefined : caCert ? { ca: caCert, rejectUnauthorized: true } : { rejectUnauthorized: false },
  });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pool.query(sql, params);
      return res.rows as T[];
    },
    close: () => pool.end(),
  };
}

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS contacts (
     phone TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT '',
     last_inbound_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS conversations (
     phone TEXT PRIMARY KEY,
     state TEXT NOT NULL DEFAULT 'idle',
     data JSONB NOT NULL DEFAULT '{}'::jsonb,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS shops (
     id SERIAL PRIMARY KEY,
     phone TEXT UNIQUE NOT NULL,
     name TEXT NOT NULL,
     owner_name TEXT NOT NULL DEFAULT '',
     categories TEXT[] NOT NULL DEFAULT '{}',
     area TEXT NOT NULL DEFAULT '',
     address TEXT NOT NULL DEFAULT '',
     lat DOUBLE PRECISION NOT NULL,
     lng DOUBLE PRECISION NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     paused BOOLEAN NOT NULL DEFAULT false,
     is_demo BOOLEAN NOT NULL DEFAULT false,
     rating_sum INTEGER NOT NULL DEFAULT 0,
     rating_count INTEGER NOT NULL DEFAULT 0,
     notified_count INTEGER NOT NULL DEFAULT 0,
     replied_count INTEGER NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS requests (
     id SERIAL PRIMARY KEY,
     buyer_phone TEXT NOT NULL,
     category TEXT NOT NULL,
     item TEXT NOT NULL DEFAULT '',
     brand TEXT NOT NULL DEFAULT '',
     budget_max INTEGER,
     area TEXT NOT NULL DEFAULT '',
     lat DOUBLE PRECISION NOT NULL,
     lng DOUBLE PRECISION NOT NULL,
     timing TEXT NOT NULL DEFAULT '',
     needs_installation BOOLEAN NOT NULL DEFAULT false,
     raw_text TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL DEFAULT 'collecting',
     needs_ops BOOLEAN NOT NULL DEFAULT false,
     closes_at TIMESTAMPTZ NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS request_shops (
     request_id INTEGER NOT NULL REFERENCES requests(id),
     shop_id INTEGER NOT NULL REFERENCES shops(id),
     distance_km DOUBLE PRECISION NOT NULL,
     status TEXT NOT NULL DEFAULT 'notified',
     notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (request_id, shop_id)
   )`,
  `CREATE TABLE IF NOT EXISTS offers (
     id SERIAL PRIMARY KEY,
     request_id INTEGER NOT NULL REFERENCES requests(id),
     shop_id INTEGER NOT NULL REFERENCES shops(id),
     price INTEGER NOT NULL,
     brand_model TEXT NOT NULL DEFAULT '',
     eta TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'shop',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (request_id, shop_id)
   )`,
  `CREATE TABLE IF NOT EXISTS selections (
     request_id INTEGER PRIMARY KEY REFERENCES requests(id),
     offer_id INTEGER NOT NULL REFERENCES offers(id),
     fee INTEGER NOT NULL,
     fee_status TEXT NOT NULL DEFAULT 'pending',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sim_messages (
     id SERIAL PRIMARY KEY,
     phone TEXT NOT NULL,
     direction TEXT NOT NULL,
     payload JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS sim_messages_phone_idx ON sim_messages (phone, id)`,
  `CREATE TABLE IF NOT EXISTS leads (
     id SERIAL PRIMARY KEY,
     kind TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     phone TEXT NOT NULL,
     area TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL DEFAULT '',
     message TEXT NOT NULL DEFAULT '',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS processed_messages (
     id TEXT PRIMARY KEY,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS events (
     id SERIAL PRIMARY KEY,
     kind TEXT NOT NULL,
     phone TEXT NOT NULL DEFAULT '',
     detail JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

export async function migrate(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) await db.query(sql);
}
