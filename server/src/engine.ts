// The marketplace engine: match nearby shops, send them the request, collect offers,
// rank them, and connect the buyer with the shop they choose.
import type { Understanding } from "./ai.js";
import { getCategory, offerFee } from "./catalog.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { distanceKm } from "./geo.js";
import { isSimPhone, type Messenger } from "./messenger.js";

export interface Deps {
  db: Db;
  messenger: Messenger;
  ai: Understanding;
  config: Config;
  now: () => Date;
  transcribeVoice?: (mediaId: string, mimeType: string) => Promise<string>;
}

export interface Shop {
  id: number; phone: string; name: string; owner_name: string; categories: string[];
  area: string; address: string; lat: number; lng: number; status: string; paused: boolean;
  is_demo: boolean; rating_sum: number; rating_count: number; notified_count: number; replied_count: number;
}

export interface RequestRow {
  id: number; buyer_phone: string; category: string; item: string; brand: string; budget_max: number | null;
  area: string; lat: number; lng: number; timing: string; needs_installation: boolean; raw_text: string;
  status: string; needs_ops: boolean; closes_at: Date; created_at: Date;
}

export interface Draft {
  category: string; item: string; brand: string; budgetMax: number | null;
  area: string; lat: number; lng: number; timing: string; needsInstallation: boolean; rawText: string;
}

export interface RankedOffer {
  offer_id: number; price: number; brand_model: string; eta: string; notes: string;
  shop_id: number; shop_name: string; shop_phone: string; shop_area: string; shop_address: string;
  shop_lat: number; shop_lng: number; rating_sum: number; rating_count: number; distance_km: number;
}

export const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const ratingText = (sum: number, count: number) => (count ? `★${(sum / count).toFixed(1)}` : "New");

export function describeDraft(d: Pick<Draft, "item" | "brand" | "budgetMax" | "area" | "timing" | "needsInstallation">): string {
  const parts = [d.brand ? `${d.brand} ${d.item}` : d.item];
  if (d.budgetMax) parts.push(`budget up to ${inr(d.budgetMax)}`);
  if (d.needsInstallation) parts.push("with installation");
  if (d.timing) parts.push(`needed ${d.timing}`);
  parts.push(`near ${d.area}`);
  return parts.join(", ");
}

export async function getShopByPhone(db: Db, phone: string): Promise<Shop | null> {
  const rows = await db.query<Shop>(`SELECT * FROM shops WHERE phone = $1`, [phone]);
  return rows[0] ?? null;
}

async function lastInboundAt(db: Db, phone: string): Promise<Date | null> {
  const rows = await db.query<{ last_inbound_at: Date | null }>(`SELECT last_inbound_at FROM contacts WHERE phone = $1`, [phone]);
  return rows[0]?.last_inbound_at ? new Date(rows[0].last_inbound_at) : null;
}

export async function logEvent(db: Db, kind: string, phone: string, detail: Record<string, unknown> = {}) {
  await db.query(`INSERT INTO events (kind, phone, detail) VALUES ($1, $2, $3)`, [kind, phone, JSON.stringify(detail)]);
}

/** Active shops in the category within the radius, best first. */
export async function matchShops(deps: Deps, req: Pick<RequestRow, "category" | "lat" | "lng" | "buyer_phone">): Promise<{ shop: Shop; distance: number }[]> {
  const group = getCategory(req.category)?.group;
  const radius = group === "appliance" ? deps.config.radiusKmAppliances : deps.config.radiusKmServices;
  // Simulator buyers only reach simulator shops, and real buyers only reach real shops,
  // so tests never send fake requests to real shops (or fake offers to real buyers).
  const shops = await deps.db.query<Shop>(
    `SELECT * FROM shops WHERE status = 'active' AND paused = false AND $1 = ANY(categories)
       AND (phone LIKE 'sim-%') = $2`,
    [req.category, isSimPhone(req.buyer_phone)],
  );
  return shops
    .map((shop) => ({ shop, distance: distanceKm(req.lat, req.lng, shop.lat, shop.lng) }))
    .filter((m) => m.distance <= radius)
    .map((m) => {
      const rating = m.shop.rating_count ? m.shop.rating_sum / m.shop.rating_count : 4;
      const responseRate = m.shop.notified_count >= 5 ? m.shop.replied_count / m.shop.notified_count : 0.6;
      // Reward good ratings and shops that actually reply; penalise distance gently.
      return { ...m, score: rating * 2 + responseRate * 4 - m.distance * 0.3 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, deps.config.shopsPerRequest)
    .map(({ shop, distance }) => ({ shop, distance }));
}

export async function createRequest(deps: Deps, buyerPhone: string, d: Draft): Promise<RequestRow> {
  const closesAt = new Date(deps.now().getTime() + deps.config.offerWindowMinutes * 60_000);
  const rows = await deps.db.query<RequestRow>(
    `INSERT INTO requests (buyer_phone, category, item, brand, budget_max, area, lat, lng, timing, needs_installation, raw_text, closes_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [buyerPhone, d.category, d.item, d.brand, d.budgetMax, d.area, d.lat, d.lng, d.timing, d.needsInstallation, d.rawText, closesAt, deps.now()],
  );
  return rows[0];
}

function shopAlertText(req: RequestRow, distance: number): string {
  const lines = [
    `🔔 *New customer request* · ${distance.toFixed(1)} km away`,
    describeDraft({ item: req.item, brand: req.brand, budgetMax: req.budget_max, area: req.area, timing: req.timing, needsInstallation: req.needs_installation }),
  ];
  if (req.raw_text) lines.push(`Customer wrote: "${req.raw_text.slice(0, 200)}"`);
  lines.push("", "Tap *Send price* and reply with your best price, model and when you can deliver or visit.");
  return lines.join("\n");
}

/** Sends the request to matched shops. Returns how many shops were asked. */
export async function broadcast(deps: Deps, req: RequestRow): Promise<number> {
  const matches = await matchShops(deps, req);
  const windowMs = 23 * 60 * 60 * 1000;
  for (const { shop, distance } of matches) {
    await deps.db.query(
      `INSERT INTO request_shops (request_id, shop_id, distance_km, notified_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [req.id, shop.id, distance, deps.now()],
    );
    await deps.db.query(`UPDATE shops SET notified_count = notified_count + 1 WHERE id = $1`, [shop.id]);
    const text = shopAlertText(req, distance);
    const buttons = [{ id: `quote:${req.id}`, title: "Send price" }, { id: `pass:${req.id}`, title: "Not available" }];
    const last = await lastInboundAt(deps.db, shop.phone);
    const inWindow = isSimPhone(shop.phone) || (last !== null && deps.now().getTime() - last.getTime() < windowMs);
    if (inWindow) {
      await deps.messenger.send(shop.phone, { type: "buttons", text, buttons });
    } else {
      // Outside WhatsApp's 24-hour window only an approved template may be sent.
      await deps.messenger.send(shop.phone, {
        type: "template",
        name: deps.config.whatsapp.shopAlertTemplate,
        bodyParams: [
          req.brand ? `${req.brand} ${req.item}` : req.item,
          `${req.area} (${distance.toFixed(1)} km)`,
          req.budget_max ? inr(req.budget_max) : "not given",
          req.timing || "flexible",
        ],
        buttonPayloads: buttons.map((b) => b.id),
        previewText: text,
        previewButtons: buttons,
      });
    }
  }
  if (matches.length === 0) await deps.db.query(`UPDATE requests SET needs_ops = true WHERE id = $1`, [req.id]);
  await logEvent(deps.db, "request_broadcast", req.buyer_phone, { requestId: req.id, shops: matches.length });
  return matches.length;
}

export async function saveOffer(
  deps: Deps, requestId: number, shopId: number,
  o: { price: number; brandModel: string; eta: string; notes: string }, source: "shop" | "ops" | "demo",
): Promise<"saved" | "closed" | "not_invited"> {
  const reqs = await deps.db.query<RequestRow>(`SELECT * FROM requests WHERE id = $1`, [requestId]);
  const req = reqs[0];
  if (!req || req.status !== "collecting") return "closed";
  const invited = await deps.db.query<{ status: string }>(`SELECT status FROM request_shops WHERE request_id = $1 AND shop_id = $2`, [requestId, shopId]);
  if (!invited[0]) {
    if (source !== "ops") return "not_invited";
    const shop = (await deps.db.query<Shop>(`SELECT * FROM shops WHERE id = $1`, [shopId]))[0];
    if (!shop) return "not_invited";
    await deps.db.query(
      `INSERT INTO request_shops (request_id, shop_id, distance_km, notified_at) VALUES ($1,$2,$3,$4)`,
      [requestId, shopId, distanceKm(req.lat, req.lng, shop.lat, shop.lng), deps.now()],
    );
  }
  await deps.db.query(
    `INSERT INTO offers (request_id, shop_id, price, brand_model, eta, notes, source, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (request_id, shop_id) DO UPDATE SET price = EXCLUDED.price, brand_model = EXCLUDED.brand_model,
       eta = EXCLUDED.eta, notes = EXCLUDED.notes, created_at = EXCLUDED.created_at`,
    [requestId, shopId, Math.round(o.price), o.brandModel, o.eta, o.notes, source, deps.now()],
  );
  if (invited[0]?.status !== "quoted") {
    await deps.db.query(`UPDATE request_shops SET status = 'quoted' WHERE request_id = $1 AND shop_id = $2`, [requestId, shopId]);
    await deps.db.query(`UPDATE shops SET replied_count = replied_count + 1 WHERE id = $1`, [shopId]);
  }
  const count = await deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM offers WHERE request_id = $1`, [requestId]);
  if (count[0].n >= deps.config.targetOffers) await closeAndSend(deps, requestId);
  return "saved";
}

export async function rankedOffers(db: Db, requestId: number): Promise<RankedOffer[]> {
  const rows = await db.query<RankedOffer>(
    `SELECT o.id AS offer_id, o.price, o.brand_model, o.eta, o.notes,
            s.id AS shop_id, s.name AS shop_name, s.phone AS shop_phone, s.area AS shop_area, s.address AS shop_address,
            s.lat AS shop_lat, s.lng AS shop_lng, s.rating_sum, s.rating_count, rs.distance_km
       FROM offers o JOIN shops s ON s.id = o.shop_id
       JOIN request_shops rs ON rs.request_id = o.request_id AND rs.shop_id = o.shop_id
      WHERE o.request_id = $1`,
    [requestId],
  );
  const rating = (r: RankedOffer) => (r.rating_count ? r.rating_sum / r.rating_count : 0);
  return rows.sort((a, b) => a.price - b.price || rating(b) - rating(a) || a.distance_km - b.distance_km);
}

function offerLine(o: RankedOffer): string {
  const bits = [inr(o.price)];
  if (o.brand_model) bits.push(o.brand_model);
  if (o.eta) bits.push(o.eta);
  bits.push(`${o.distance_km.toFixed(1)} km`, ratingText(o.rating_sum, o.rating_count));
  return bits.join(" · ");
}

/** Sends the buyer the ranked offers as a WhatsApp list. */
export async function sendOfferList(deps: Deps, req: RequestRow, offers: RankedOffer[]): Promise<void> {
  const top = offers.slice(0, 3);
  const body = [
    `🎉 *${offers.length} offer${offers.length > 1 ? "s" : ""}* for your ${req.brand ? req.brand + " " : ""}${req.item}:`,
    "",
    ...top.map((o, i) => `${i + 1}. *${o.shop_name}*${i === 0 ? " (lowest price)" : ""}\n   ${offerLine(o)}`),
    "",
    "Tap *See offers* to choose one. We'll share the shop's contact so you can confirm directly.",
  ].join("\n");
  await deps.messenger.send(req.buyer_phone, {
    type: "list",
    text: body,
    button: "See offers",
    rows: offers.slice(0, 10).map((o) => ({
      id: `pick:${o.offer_id}`,
      title: `${inr(o.price)} · ${o.shop_name}`,
      description: [o.brand_model, o.eta, `${o.distance_km.toFixed(1)} km`, ratingText(o.rating_sum, o.rating_count)].filter(Boolean).join(" · "),
    })),
  });
}

/** Closes offer collection and sends the buyer their options. Safe to call twice. */
export async function closeAndSend(deps: Deps, requestId: number): Promise<void> {
  const offers = await rankedOffers(deps.db, requestId);
  const next = offers.length ? "offers_sent" : "no_offers";
  const claimed = await deps.db.query<RequestRow>(
    `UPDATE requests SET status = $2, needs_ops = (needs_ops OR $3) WHERE id = $1 AND status = 'collecting' RETURNING *`,
    [requestId, next, offers.length === 0],
  );
  const req = claimed[0];
  if (!req) return;
  await deps.db.query(`UPDATE request_shops SET status = 'expired' WHERE request_id = $1 AND status = 'notified'`, [requestId]);

  if (!offers.length) {
    await deps.messenger.send(req.buyer_phone, {
      type: "text",
      text: `No shop has sent an offer for your ${req.item} yet. 🙏 Our Zyyko team will call shops near ${req.area} and get back to you here. Reply anytime to make a new request.`,
    });
    await setConversation(deps.db, req.buyer_phone, "idle", {});
    return;
  }
  await sendOfferList(deps, req, offers);
  await setConversation(deps.db, req.buyer_phone, "buyer_choosing", { requestId });
  await logEvent(deps.db, "offers_sent", req.buyer_phone, { requestId, offers: offers.length });
}

export async function pickOffer(deps: Deps, buyerPhone: string, buyerName: string, offerId: number): Promise<boolean> {
  const rows = await deps.db.query<RequestRow & { offer_request_id: number }>(
    `SELECT r.*, o.request_id AS offer_request_id FROM offers o JOIN requests r ON r.id = o.request_id WHERE o.id = $1`,
    [offerId],
  );
  const req = rows[0];
  if (!req || req.buyer_phone !== buyerPhone || req.status !== "offers_sent") return false;
  const claimed = await deps.db.query(`UPDATE requests SET status = 'selected' WHERE id = $1 AND status = 'offers_sent' RETURNING id`, [req.id]);
  if (!claimed.length) return false;
  const offers = await rankedOffers(deps.db, req.id);
  const chosen = offers.find((o) => o.offer_id === offerId)!;
  const fee = offerFee(req.category);
  await deps.db.query(`INSERT INTO selections (request_id, offer_id, fee, created_at) VALUES ($1,$2,$3,$4)`, [req.id, offerId, fee, deps.now()]);

  const shopContact = isSimPhone(chosen.shop_phone) ? chosen.shop_phone : `+${chosen.shop_phone}`;
  await deps.messenger.send(buyerPhone, {
    type: "text",
    text: [
      `✅ Great choice! *${chosen.shop_name}* has been told you picked their offer of ${inr(chosen.price)}.`,
      "",
      `📞 ${shopContact}`,
      `📍 ${chosen.shop_address || chosen.shop_area} · https://maps.google.com/?q=${chosen.shop_lat},${chosen.shop_lng}`,
      "",
      "They'll contact you to confirm. If anything goes wrong, reply here and our team will help.",
      "After the job, reply with a number from *1 to 5* to rate the shop.",
    ].join("\n"),
  });
  const buyerContact = isSimPhone(buyerPhone) ? buyerPhone : `+${buyerPhone}`;
  await deps.messenger.send(chosen.shop_phone, {
    type: "text",
    text: [
      `🎉 *A customer chose your offer!*`,
      `${req.brand ? req.brand + " " : ""}${req.item} · ${inr(chosen.price)}${chosen.eta ? " · " + chosen.eta : ""}`,
      `Customer: ${buyerName || "Zyyko customer"} · 📞 ${buyerContact}`,
      `Area: ${req.area}`,
      "",
      `Please call them within 15 minutes to confirm. Zyyko fee for this customer: ${inr(fee)}.`,
    ].join("\n"),
  });
  for (const o of offers) {
    if (o.offer_id === offerId) continue;
    await deps.messenger.send(o.shop_phone, { type: "text", text: `The customer for "${req.item} near ${req.area}" chose another offer this time. Thanks for quoting. Fast, sharp offers win more often.` });
  }
  await setConversation(deps.db, buyerPhone, "buyer_rating", { requestId: req.id, shopId: chosen.shop_id });
  await logEvent(deps.db, "offer_selected", buyerPhone, { requestId: req.id, offerId, fee });
  return true;
}

/** Called every few seconds: closes expired requests and lets demo shops quote. */
export async function tick(deps: Deps): Promise<void> {
  if (deps.config.demoAutoQuote) await demoShopsQuote(deps);
  const due = await deps.db.query<{ id: number }>(`SELECT id FROM requests WHERE status = 'collecting' AND closes_at <= $1`, [deps.now()]);
  for (const { id } of due) await closeAndSend(deps, id);
}

/** Demo shops (seeded for testers) answer automatically 20–60 s after being asked. */
async function demoShopsQuote(deps: Deps): Promise<void> {
  const pending = await deps.db.query<{ request_id: number; shop_id: number; budget_max: number | null; category: string; brand: string; notified_at: Date }>(
    `SELECT rs.request_id, rs.shop_id, r.budget_max, r.category, r.brand, rs.notified_at
       FROM request_shops rs JOIN shops s ON s.id = rs.shop_id JOIN requests r ON r.id = rs.request_id
      WHERE s.is_demo = true AND rs.status = 'notified' AND r.status = 'collecting'`,
  );
  for (const p of pending) {
    const delay = 20_000 + ((p.shop_id * 7919 + p.request_id * 104729) % 40_000);
    if (deps.now().getTime() - new Date(p.notified_at).getTime() < delay) continue;
    const group = getCategory(p.category)?.group;
    const base = p.budget_max ?? (group === "appliance" ? 35000 : 800);
    const factor = 0.84 + (((p.shop_id * 31 + p.request_id * 17) % 14) / 100);
    const price = Math.round((base * factor) / (group === "appliance" ? 100 : 10)) * (group === "appliance" ? 100 : 10);
    const etas = ["today", "tomorrow", "within 2 hours", "tomorrow morning"];
    await saveOffer(deps, p.request_id, p.shop_id, {
      price, brandModel: p.brand || "", eta: etas[(p.shop_id + p.request_id) % etas.length], notes: "Demo shop offer",
    }, "demo");
  }
}

export async function getConversation(db: Db, phone: string): Promise<{ state: string; data: Record<string, unknown> }> {
  const rows = await db.query<{ state: string; data: Record<string, unknown> }>(`SELECT state, data FROM conversations WHERE phone = $1`, [phone]);
  return rows[0] ?? { state: "idle", data: {} };
}

export async function setConversation(db: Db, phone: string, state: string, data: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO conversations (phone, state, data, updated_at) VALUES ($1,$2,$3, now())
     ON CONFLICT (phone) DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = now()`,
    [phone, state, JSON.stringify(data)],
  );
}
