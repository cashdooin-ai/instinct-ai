// Web simulator: testers play buyer and shop in a browser, before WhatsApp is approved.
// Phones here start with "sim-" and never touch WhatsApp.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { handleInbound } from "../bot.js";
import type { Deps } from "../engine.js";
import { PLACES } from "../geo.js";
import type { Inbound } from "../whatsapp.js";
import { readCookie, safeEqual } from "./auth.js";
import { SIMULATOR_HTML } from "./simulatorPage.js";

interface SendBody { phone?: string; name?: string; text?: string; buttonId?: string; buttonTitle?: string; lat?: number; lng?: number; label?: string }

export function registerSimulator(app: FastifyInstance, deps: Deps, testerToken: string) {
  const { db } = deps;

  const allowed = (token: string | null | undefined) =>
    !!token && ((testerToken && safeEqual(token, testerToken)) || (deps.config.adminToken && safeEqual(token, deps.config.adminToken)));

  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    const q = (req.query as Record<string, string> | undefined)?.token;
    if (allowed(q)) {
      reply.header("Set-Cookie", `zyyko_sim=${encodeURIComponent(q!)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`);
      return;
    }
    if (allowed(readCookie(req.headers.cookie, "zyyko_sim")) || allowed(readCookie(req.headers.cookie, "zyyko_admin"))) return;
    reply.code(401).type("text/plain").send("Open /simulator?token=YOUR_TESTER_TOKEN once on this device.");
  };

  const validPhone = (p: unknown): p is string => typeof p === "string" && /^sim-[a-z0-9-]{1,40}$/.test(p);

  app.register(async (sim) => {
    sim.addHook("preHandler", guard);

    sim.get("/simulator", async (_req, reply) => reply.type("text/html").send(SIMULATOR_HTML));

    sim.get("/simulator/api/identities", async () => {
      const shops = await db.query<{ phone: string; name: string; area: string; status: string }>(
        `SELECT phone, name, area, status FROM shops WHERE phone LIKE 'sim-%' ORDER BY id`);
      return { shops, places: PLACES.map((p) => ({ key: p.key, name: p.name, lat: p.lat, lng: p.lng })) };
    });

    sim.get("/simulator/api/messages", async (req, reply) => {
      const { phone, after } = req.query as { phone?: string; after?: string };
      if (!validPhone(phone)) return reply.code(400).send({ error: "phone must start with sim-" });
      const rows = await db.query(`SELECT id, direction, payload, created_at FROM sim_messages WHERE phone = $1 AND id > $2 ORDER BY id LIMIT 200`, [phone, Number(after) || 0]);
      return { messages: rows };
    });

    sim.post("/simulator/api/send", async (req, reply) => {
      const b = (req.body ?? {}) as SendBody;
      if (!validPhone(b.phone)) return reply.code(400).send({ error: "phone must start with sim-" });
      const base = { phone: b.phone, name: (b.name ?? "").slice(0, 40) };
      let event: Inbound;
      let shown: Record<string, unknown>;
      if (b.buttonId) {
        event = { ...base, kind: "button", id: String(b.buttonId).slice(0, 200), title: String(b.buttonTitle ?? "") };
        shown = { type: "text", text: `[${b.buttonTitle ?? b.buttonId}]` };
      } else if (typeof b.lat === "number" && typeof b.lng === "number") {
        event = { ...base, kind: "location", lat: b.lat, lng: b.lng, label: String(b.label ?? "") };
        shown = { type: "text", text: `📍 ${b.label ?? "Location"}` };
      } else if (b.text && b.text.trim()) {
        event = { ...base, kind: "text", text: b.text.slice(0, 2000) };
        shown = { type: "text", text: b.text.slice(0, 2000) };
      } else {
        return reply.code(400).send({ error: "send text, a button or a location" });
      }
      await db.query(`INSERT INTO sim_messages (phone, direction, payload) VALUES ($1, 'in', $2)`, [b.phone, JSON.stringify(shown)]);
      await handleInbound(deps, event);
      return { ok: true };
    });

    sim.post("/simulator/api/reset", async (req, reply) => {
      const { phone } = (req.body ?? {}) as { phone?: string };
      if (!validPhone(phone)) return reply.code(400).send({ error: "phone must start with sim-" });
      await db.query(`DELETE FROM sim_messages WHERE phone = $1`, [phone]);
      await db.query(`DELETE FROM conversations WHERE phone = $1`, [phone]);
      return { ok: true };
    });
  });
}
