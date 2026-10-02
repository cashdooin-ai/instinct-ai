import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Deps } from "../src/engine.js";
import { RoutingMessenger, toWhatsAppBody } from "../src/messenger.js";
import { buildServer } from "../src/server.js";
import { importShopsCsv } from "../src/shops.js";
import { parseWebhook, verifySignature } from "../src/whatsapp.js";
import { testDeps } from "./helpers.js";

const webhookBody = (from: string, text: string, id = "wamid.1") => ({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: "Priya" } }], messages: [{ from, id, type: "text", text: { body: text } }] } }] }],
});
const sign = (raw: string, secret = "app-secret") => "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

describe("whatsapp helpers", () => {
  it("verifies Meta signatures", () => {
    const raw = Buffer.from('{"a":1}');
    expect(verifySignature(raw, sign('{"a":1}'), "app-secret")).toBe(true);
    expect(verifySignature(raw, sign('{"a":2}'), "app-secret")).toBe(false);
    expect(verifySignature(raw, undefined, "app-secret")).toBe(false);
    expect(verifySignature(raw, sign('{"a":1}'), "")).toBe(false);
  });

  it("parses text, buttons, list replies, template buttons and locations", () => {
    const events = parseWebhook({ entry: [{ changes: [{ value: { messages: [
      { from: "91999", id: "a", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "find", title: "Get offers" } } },
      { from: "91999", id: "b", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "pick:4", title: "₹1" } } },
      { from: "91999", id: "c", type: "button", button: { payload: "quote:9", text: "Send price" } },
      { from: "91999", id: "d", type: "location", location: { latitude: 30.7, longitude: 76.7, name: "Home" } },
      { from: "91999", id: "e", type: "image", image: {} },
    ] } }] }] });
    expect(events.map((e) => e.kind)).toEqual(["button", "button", "button", "location", "unsupported"]);
    expect(events[2]).toMatchObject({ id: "quote:9" });
  });

  it("builds valid Cloud API bodies and respects WhatsApp limits", () => {
    const body = toWhatsAppBody("91999", { type: "buttons", text: "x", buttons: [{ id: "a", title: "A very long button title here" }] }, "en") as any;
    expect(body.interactive.action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    const tpl = toWhatsAppBody("91999", { type: "template", name: "zyyko_new_request", bodyParams: ["AC"], buttonPayloads: ["quote:1", "pass:1"], previewText: "", previewButtons: [] }, "en") as any;
    expect(tpl.template.components[1]).toEqual({ type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "quote:1" }] });
  });
});

describe("http server", () => {
  let deps: Deps;
  let sentToGraph: { url: string; body: any }[];

  beforeEach(async () => {
    ({ deps } = await testDeps());
    sentToGraph = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sentToGraph.push({ url, body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    deps.messenger = new RoutingMessenger(deps.db, deps.config, fakeFetch);
  });

  it("handles the webhook handshake", async () => {
    const app = buildServer(deps);
    const ok = await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42" });
    expect(ok.body).toBe("42");
    const bad = await app.inject({ method: "GET", url: "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42" });
    expect(bad.statusCode).toBe(403);
  });

  it("rejects unsigned webhooks and answers signed ones over WhatsApp, once per message id", async () => {
    const app = buildServer(deps);
    const raw = JSON.stringify(webhookBody("919876543210", "hi"));
    const unsigned = await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload: raw, headers: { "content-type": "application/json" } });
    expect(unsigned.statusCode).toBe(401);

    const res = await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload: raw, headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) } });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(sentToGraph).toHaveLength(1);
    expect(sentToGraph[0].url).toContain("/123/messages");
    expect(sentToGraph[0].body.to).toBe("919876543210");
    expect(sentToGraph[0].body.text.body).toContain("Welcome to *Zyyko*");

    // Meta re-delivers the same message id: ignored.
    await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload: raw, headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) } });
    await new Promise((r) => setTimeout(r, 50));
    expect(sentToGraph).toHaveLength(1);
  });

  it("protects admin and simulator pages", async () => {
    const app = buildServer(deps, { testerToken: "tester-token-123" });
    expect((await app.inject({ url: "/admin" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/admin?token=wrong" })).statusCode).toBe(401);
    const ok = await app.inject({ url: "/admin?token=admin-token-123456789" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain("Dashboard");
    const cookie = String(ok.headers["set-cookie"]).split(";")[0];
    expect((await app.inject({ url: "/admin/shops", headers: { cookie } })).statusCode).toBe(200);

    // Tester token opens the simulator but not the admin panel.
    expect((await app.inject({ url: "/simulator?token=tester-token-123" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/admin?token=tester-token-123" })).statusCode).toBe(401);
  });

  it("runs a simulator conversation over HTTP", async () => {
    const app = buildServer(deps, { testerToken: "tester-token-123" });
    const headers = { "content-type": "application/json" };
    const q = "?token=tester-token-123";
    await app.inject({ method: "POST", url: "/simulator/api/send" + q, headers, payload: { phone: "sim-buyer-1", text: "AC service tomorrow VIP road zirakpur" } });
    const res = await app.inject({ url: "/simulator/api/messages" + q + "&phone=sim-buyer-1&after=0" });
    const msgs = res.json().messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].payload.type).toBe("buttons");
    expect((await app.inject({ method: "POST", url: "/simulator/api/send" + q, headers, payload: { phone: "919876543210", text: "x" } })).statusCode).toBe(400);
    expect(sentToGraph).toHaveLength(0);
  });

  it("stores leads from the website and validates phone numbers", async () => {
    const app = buildServer(deps);
    const bad = await app.inject({ method: "POST", url: "/api/leads", payload: { kind: "shop", phone: "123" } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/leads", payload: { kind: "shop", name: "Gill Electronics", phone: "98765 43210", area: "Kharar" } });
    expect(ok.json()).toEqual({ ok: true });
    const [lead] = await deps.db.query<{ phone: string }>(`SELECT phone FROM leads`);
    expect(lead.phone).toBe("919876543210");
  });

  it("serves the landing page", async () => {
    const app = buildServer(deps);
    const res = await app.inject({ url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Zyyko");
  });
});

describe("shop import", () => {
  it("imports a CSV, updates on re-import, and reports bad rows", async () => {
    const { db } = await testDeps();
    const csv = [
      "name,phone,categories,area,address,owner_name",
      'Sharma Electronics,98765 43210,ac|refrigerator,Sector 70 Mohali,"SCO 12, Sector 70",Rakesh',
      "Gill Plumbing,+91 98140-00000,Plumber,Kharar,,",
      "No Phone Shop,,ac,Mohali,,",
      "Mystery,9999999999,teleportation,Mohali,,",
      "Far Away,9888888888,ac,Ludhiana,,",
    ].join("\n");
    const r = await importShopsCsv(db, csv);
    expect(r.imported).toBe(2);
    expect(r.errors).toHaveLength(3);
    const again = await importShopsCsv(db, csv.split("\n").slice(0, 2).join("\n"));
    expect(again.updated).toBe(1);
    const shops = await db.query<{ phone: string; categories: string[]; address: string; status: string }>(`SELECT phone, categories, address, status FROM shops ORDER BY id`);
    expect(shops[0]).toMatchObject({ phone: "919876543210", categories: ["ac", "refrigerator"], address: "SCO 12, Sector 70", status: "active" });
    expect(shops[1].categories).toEqual(["plumber"]);
  });
});
