import { PGlite } from "@electric-sql/pglite";
import { rulesOnly } from "../src/ai.js";
import type { Config } from "../src/config.js";
import { migrate, type Db } from "../src/db.js";
import type { Deps } from "../src/engine.js";
import type { Messenger, OutMessage } from "../src/messenger.js";

export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await pg.query(sql, params);
      return res.rows as T[];
    },
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0, publicBaseUrl: "http://test", databaseUrl: "", databaseCaCert: "", adminToken: "admin-token-123456789", webOrigin: "*",
    whatsapp: { token: "wa-token", phoneNumberId: "123", verifyToken: "verify-me", appSecret: "app-secret", graphVersion: "v23.0", shopAlertTemplate: "zyyko_new_request", templateLanguage: "en" },
    anthropic: { apiKey: "", model: "claude-opus-5-5" }, sarvamApiKey: "",
    offerWindowMinutes: 15, targetOffers: 5, shopsPerRequest: 8, radiusKmAppliances: 12, radiusKmServices: 8, demoAutoQuote: false,
    ...overrides,
  };
}

/** Records every outbound message instead of sending it. */
export class FakeMessenger implements Messenger {
  sent: { to: string; msg: OutMessage }[] = [];
  async send(to: string, msg: OutMessage) { this.sent.push({ to, msg }); }
  to(phone: string) { return this.sent.filter((s) => s.to === phone).map((s) => s.msg); }
  last(phone: string) { const m = this.to(phone); return m[m.length - 1]; }
  clear() { this.sent = []; }
}

export class Clock {
  t = new Date("2026-10-02T10:00:00+05:30").getTime();
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
}

export async function testDeps(overrides: Partial<Deps> = {}) {
  const db = await testDb();
  const messenger = new FakeMessenger();
  const clock = new Clock();
  const deps: Deps = { db, messenger, ai: rulesOnly, config: testConfig(), now: clock.now, ...overrides };
  return { deps, db, messenger, clock };
}

export const textOf = (m: OutMessage | undefined) =>
  !m ? "" : m.type === "template" ? m.previewText : m.text;
