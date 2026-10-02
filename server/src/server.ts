// Builds the HTTP app: WhatsApp webhook, admin, simulator, landing page and lead form.
import Fastify, { type FastifyInstance } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { handleInbound } from "./bot.js";
import type { Deps } from "./engine.js";
import { registerAdmin } from "./routes/admin.js";
import { registerSimulator } from "./routes/simulator.js";
import { normalizePhone } from "./shops.js";
import { parseWebhook, verifySignature } from "./whatsapp.js";

declare module "fastify" {
  interface FastifyRequest { rawBody?: Buffer }
}

const WEB_DIR = new URL("../../web/", import.meta.url);

export function buildServer(deps: Deps, opts: { testerToken?: string; logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1_000_000, trustProxy: true });

  // Keep the raw body: Meta signs the exact bytes it sends.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    req.rawBody = body as Buffer;
    try {
      done(null, body.length ? JSON.parse(body.toString("utf8")) : {});
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.get("/health", async () => ({ ok: true }));

  // --- WhatsApp Cloud API webhook
  app.get("/webhooks/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string>;
    const expected = deps.config.whatsapp.verifyToken;
    if (q["hub.mode"] === "subscribe" && expected && q["hub.verify_token"] === expected) {
      return reply.type("text/plain").send(q["hub.challenge"] ?? "");
    }
    return reply.code(403).send("Forbidden");
  });

  app.post("/webhooks/whatsapp", async (req, reply) => {
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    if (!req.rawBody || !verifySignature(req.rawBody, sig, deps.config.whatsapp.appSecret)) {
      req.log.warn("rejected webhook with bad or missing signature");
      return reply.code(401).send("Bad signature");
    }
    const events = parseWebhook(req.body);
    // Reply to Meta at once; it retries slow webhooks.
    reply.code(200).send("OK");
    for (const event of events) {
      try {
        if (event.messageId) {
          const fresh = await deps.db.query(`INSERT INTO processed_messages (id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`, [event.messageId]);
          if (!fresh.length) continue; // Meta re-delivered a message we already handled
        }
        await handleInbound(deps, event);
      } catch (err) {
        req.log.error({ err }, "failed to handle inbound message");
      }
    }
  });

  // --- Lead form on zyyko.com
  const cors = (origin: string | undefined) => {
    const allowed = deps.config.webOrigin;
    if (allowed === "*") return "*";
    return allowed.split(",").map((s) => s.trim()).includes(origin ?? "") ? origin! : allowed.split(",")[0].trim();
  };
  app.options("/api/leads", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", cors(req.headers.origin)).header("Access-Control-Allow-Methods", "POST")
      .header("Access-Control-Allow-Headers", "Content-Type").code(204).send();
  });
  app.post("/api/leads", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", cors(req.headers.origin));
    const b = (req.body ?? {}) as Record<string, unknown>;
    const s = (k: string, n: number) => String(b[k] ?? "").trim().slice(0, n);
    const phone = normalizePhone(s("phone", 20));
    const kind = s("kind", 10) === "shop" ? "shop" : "buyer";
    if (!phone) return reply.code(400).send({ error: "Please enter a valid 10-digit mobile number." });
    await deps.db.query(
      `INSERT INTO leads (kind, name, phone, area, category, message) VALUES ($1,$2,$3,$4,$5,$6)`,
      [kind, s("name", 80), phone, s("area", 80), s("category", 80), s("message", 500)],
    );
    return { ok: true };
  });

  // --- Landing page (zyyko.com) served from /web
  const page = (file: string, type: string) => async (_req: unknown, reply: import("fastify").FastifyReply) => {
    const url = new URL(file, WEB_DIR);
    if (!existsSync(url)) return reply.code(404).send("Not found");
    return reply.type(type).header("Cache-Control", "public, max-age=300").send(readFileSync(url));
  };
  app.get("/", page("index.html", "text/html; charset=utf-8"));
  app.get("/privacy", page("privacy.html", "text/html; charset=utf-8"));

  registerAdmin(app, deps);
  registerSimulator(app, deps, opts.testerToken ?? process.env.TESTER_TOKEN ?? "");
  return app;
}
