// Conversation flows for buyers, shops and shop sign-up. One entry point: handleInbound.
import { CATEGORIES, getCategory } from "./catalog.js";
import {
  broadcast, closeAndSend, createRequest, describeDraft, getConversation, getShopByPhone, logEvent,
  pickOffer, rankedOffers, saveOffer, sendOfferList, setConversation, type Deps, type Draft, type RequestRow, type Shop,
} from "./engine.js";
import { nearestPlace, normalize, resolveArea } from "./geo.js";
import { parseNumberList } from "./parser.js";
import type { Inbound } from "./whatsapp.js";

const WELCOME = [
  "👋 Welcome to *Zyyko*, Tricity's local offers service.",
  "",
  "Tell me what you need, and nearby shops will send you their best price in minutes. You can type or send a voice note.",
  "",
  "Examples:",
  "• _1.5 ton inverter AC under 40k, Sector 70 Mohali, with installation_",
  "• _AC service tomorrow, VIP Road Zirakpur_",
  "• _Plumber for kitchen leak today, Panchkula sector 11_",
  "",
  "Own a shop? Send *JOIN* to get customer requests.",
].join("\n");

const SHOP_HELP = [
  "🏪 *Zyyko for shops*",
  "When a customer near you asks for something you sell, you'll get a message here. Tap *Send price* and reply with your price.",
  "",
  "Commands: *PAUSE* (stop requests) · *RESUME* · *STATUS*",
].join("\n");

const AREA_PROMPT = "📍 Where do you need it? Share your location, or type your area (e.g. _Sector 70 Mohali_, _VIP Road Zirakpur_, _Sector 11 Panchkula_).";

async function touchContact(deps: Deps, phone: string, name: string) {
  await deps.db.query(
    `INSERT INTO contacts (phone, name, last_inbound_at) VALUES ($1,$2,$3)
     ON CONFLICT (phone) DO UPDATE SET last_inbound_at = EXCLUDED.last_inbound_at,
       name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE contacts.name END`,
    [phone, name, deps.now()],
  );
}

async function contactName(deps: Deps, phone: string): Promise<string> {
  const rows = await deps.db.query<{ name: string }>(`SELECT name FROM contacts WHERE phone = $1`, [phone]);
  return rows[0]?.name ?? "";
}

const say = (deps: Deps, to: string, text: string) => deps.messenger.send(to, { type: "text", text });

export async function handleInbound(deps: Deps, inbound: Inbound): Promise<void> {
  const { phone } = inbound;
  await touchContact(deps, phone, inbound.name);
  await deps.db.query(`INSERT INTO events (kind, phone, detail) VALUES ('inbound', $1, $2)`, [phone, JSON.stringify({ kind: inbound.kind })]);

  let event = inbound;
  if (event.kind === "audio") {
    const text = deps.transcribeVoice ? await deps.transcribeVoice(event.mediaId, event.mimeType) : "";
    if (!text) {
      await say(deps, phone, "🎤 Sorry, I couldn't understand that voice note. Could you type your request instead?");
      return;
    }
    await say(deps, phone, `🎤 I heard: "${text}"`);
    event = { kind: "text", phone, name: inbound.name, text };
  }
  if (event.kind === "unsupported") {
    await say(deps, phone, "I can read text, voice notes and locations. Please type what you need. 🙂");
    return;
  }

  const t = event.kind === "text" ? normalize(event.text) : "";
  if (t === "cancel" || t === "reset" || t === "stop") {
    await setConversation(deps.db, phone, "idle", {});
    await say(deps, phone, "OK, cancelled. Send a new request anytime.");
    return;
  }

  const shop = await getShopByPhone(deps.db, phone);
  if (shop) return handleShop(deps, shop, event);

  const conv = await getConversation(deps.db, phone);
  if (["join", "register", "list my shop", "shop", "seller", "partner"].includes(t)) return startOnboarding(deps, phone);
  if (conv.state.startsWith("onboard_")) return handleOnboarding(deps, phone, conv, event);
  return handleBuyer(deps, phone, conv, event);
}

// ---------------------------------------------------------------- buyers

function draftFromData(data: Record<string, unknown>): Draft | null {
  return (data.draft as Draft | undefined) ?? null;
}

async function confirmDraft(deps: Deps, phone: string, draft: Draft) {
  await setConversation(deps.db, phone, "buyer_confirm", { draft });
  await deps.messenger.send(phone, {
    type: "buttons",
    text: `Got it: *${describeDraft(draft)}*.\n\nShall I ask nearby shops for offers?`,
    buttons: [{ id: "find", title: "Get offers" }, { id: "edit", title: "Change" }],
  });
}

async function handleBuyer(deps: Deps, phone: string, conv: { state: string; data: Record<string, unknown> }, event: Exclude<Inbound, { kind: "audio" | "unsupported" }>) {
  if (event.kind === "button") {
    if (event.id.startsWith("pick:")) {
      const ok = await pickOffer(deps, phone, await contactName(deps, phone), Number(event.id.slice(5)));
      if (!ok) await say(deps, phone, "That offer is no longer available. Send a new request anytime.");
      return;
    }
    if (event.id === "find") {
      const draft = draftFromData(conv.data);
      if (conv.state !== "buyer_confirm" || !draft) {
        await say(deps, phone, "Please send your request again. 🙂");
        return;
      }
      const req = await createRequest(deps, phone, draft);
      const asked = await broadcast(deps, req);
      await setConversation(deps.db, phone, "buyer_waiting", { requestId: req.id });
      const by = new Date(req.closes_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
      await say(deps, phone, asked
        ? `🔎 Asking ${asked} shop${asked > 1 ? "s" : ""} near ${draft.area}. You'll get the best offers by *${by}*, or sooner if they reply fast.`
        : `We don't have partner shops for this near ${draft.area} yet. 🙏 Our team will call shops for you and send offers here by *${by}*.`);
      return;
    }
    if (event.id === "edit") {
      await setConversation(deps.db, phone, "idle", {});
      await say(deps, phone, "Sure. Send your request again with the changes (item, budget, area, when).");
      return;
    }
    await say(deps, phone, WELCOME);
    return;
  }

  // Ratings after a completed choice.
  if (conv.state === "buyer_rating" && event.kind === "text" && /^[1-5]$/.test(event.text.trim())) {
    const shopId = Number(conv.data.shopId);
    await deps.db.query(`UPDATE shops SET rating_sum = rating_sum + $2, rating_count = rating_count + 1 WHERE id = $1`, [shopId, Number(event.text.trim())]);
    await setConversation(deps.db, phone, "idle", {});
    await say(deps, phone, "Thanks for rating! ⭐ It helps other buyers in Tricity.");
    return;
  }

  if (conv.state === "buyer_await_area") {
    const draft = draftFromData(conv.data);
    if (!draft) return setConversation(deps.db, phone, "idle", {});
    if (event.kind === "location") {
      const label = event.label || nearestPlace(event.lat, event.lng).name;
      return confirmDraft(deps, phone, { ...draft, area: label, lat: event.lat, lng: event.lng });
    }
    const place = resolveArea(event.text);
    if (place) return confirmDraft(deps, phone, { ...draft, area: place.name, lat: place.lat, lng: place.lng });
    const parsed = await deps.ai.understandRequest(event.text);
    if (!parsed.category) {
      await say(deps, phone, `I couldn't find that area. ${AREA_PROMPT}`);
      return;
    }
    // They sent a new request instead of an area; fall through and treat it as one.
  }

  if (event.kind === "location") {
    await say(deps, phone, "Thanks for the location! Now tell me what you need, e.g. _AC service tomorrow_.");
    return;
  }

  if (conv.state === "buyer_waiting") {
    const req = (await deps.db.query<RequestRow>(`SELECT * FROM requests WHERE id = $1`, [Number(conv.data.requestId)]))[0];
    if (req?.status === "collecting" && /\b(now|show|offers|results|done)\b/.test(normalize(event.text))) {
      const [{ n }] = await deps.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM offers WHERE request_id = $1`, [req.id]);
      if (n === 0) {
        await say(deps, phone, "⏳ No offers yet. Shops usually reply within a few minutes. I'll message you as soon as they do.");
        return;
      }
      await closeAndSend(deps, req.id);
      return;
    }
  }

  if (conv.state === "buyer_choosing" && /\b(show|offers|list|options|results)\b/.test(normalize(event.text))) {
    const req = (await deps.db.query<RequestRow>(`SELECT * FROM requests WHERE id = $1`, [Number(conv.data.requestId)]))[0];
    if (req?.status === "offers_sent") {
      await sendOfferList(deps, req, await rankedOffers(deps.db, req.id));
      return;
    }
  }

  const parsed = await deps.ai.understandRequest(event.text);
  const previous = conv.state === "buyer_confirm" ? draftFromData(conv.data) : null;

  if (!parsed.category && previous) {
    // A follow-up tweak like "budget 35k" or "make it tomorrow".
    const merged: Draft = {
      ...previous,
      budgetMax: parsed.budgetMax ?? previous.budgetMax,
      timing: parsed.timing || previous.timing,
      brand: parsed.brand || previous.brand,
      needsInstallation: previous.needsInstallation || parsed.needsInstallation,
      ...(parsed.place ? { area: parsed.place.name, lat: parsed.place.lat, lng: parsed.place.lng } : {}),
      rawText: `${previous.rawText} / ${event.text}`.slice(0, 500),
    };
    return confirmDraft(deps, phone, merged);
  }

  if (!parsed.category) {
    if (conv.state === "buyer_waiting") {
      await say(deps, phone, "⏳ I'm still collecting offers for your request. Reply *SHOW* to see what's in so far, or *CANCEL* to stop.");
      return;
    }
    if (conv.state === "buyer_choosing") {
      await say(deps, phone, "Tap *See offers* above to choose one (or reply *SHOW* to see them again). To ask for something else, just send a new request.");
      return;
    }
    await say(deps, phone, parsed.isGreeting || conv.state === "idle" ? WELCOME : "Sorry, I didn't get that. What do you need? (an appliance or a home service)");
    return;
  }

  const cat = getCategory(parsed.category)!;
  const draft: Draft = {
    category: cat.key, item: cat.label, brand: parsed.brand, budgetMax: parsed.budgetMax,
    area: parsed.place?.name ?? "", lat: parsed.place?.lat ?? 0, lng: parsed.place?.lng ?? 0,
    timing: parsed.timing, needsInstallation: parsed.needsInstallation, rawText: event.text.slice(0, 500),
  };
  if (!parsed.place) {
    await setConversation(deps.db, phone, "buyer_await_area", { draft });
    await deps.messenger.send(phone, { type: "location_request", text: AREA_PROMPT });
    return;
  }
  return confirmDraft(deps, phone, draft);
}

// ---------------------------------------------------------------- shop sign-up

async function startOnboarding(deps: Deps, phone: string) {
  await setConversation(deps.db, phone, "onboard_name", {});
  await say(deps, phone, "🏪 Great, let's list your shop on Zyyko. It's free; you pay a small fee only when a customer picks your offer.\n\nWhat is your *shop name*?");
}

function categoryMenu(): string {
  return CATEGORIES.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
}

async function handleOnboarding(deps: Deps, phone: string, conv: { state: string; data: Record<string, unknown> }, event: Exclude<Inbound, { kind: "audio" | "unsupported" }>) {
  if (conv.state === "onboard_name") {
    if (event.kind !== "text" || event.text.trim().length < 2) return say(deps, phone, "Please type your shop name.");
    await setConversation(deps.db, phone, "onboard_categories", { name: event.text.trim().slice(0, 80) });
    return say(deps, phone, `What do you sell or service? Reply with the numbers, e.g. *1, 2, 10*\n\n${categoryMenu()}`);
  }
  if (conv.state === "onboard_categories") {
    const picks = event.kind === "text" ? parseNumberList(event.text).filter((n) => n >= 1 && n <= CATEGORIES.length) : [];
    if (!picks.length) return say(deps, phone, `Please reply with numbers from the list, e.g. *1, 10*\n\n${categoryMenu()}`);
    await setConversation(deps.db, phone, "onboard_location", { ...conv.data, categories: picks.map((n) => CATEGORIES[n - 1].key) });
    return deps.messenger.send(phone, { type: "location_request", text: "📍 Please share your *shop location* (tap 📎 → Location), or type your area." });
  }
  if (conv.state === "onboard_location") {
    let lat: number, lng: number, area: string;
    if (event.kind === "location") {
      lat = event.lat; lng = event.lng; area = event.label || nearestPlace(lat, lng).name;
    } else if (event.kind === "text" && resolveArea(event.text)) {
      const p = resolveArea(event.text)!;
      lat = p.lat; lng = p.lng; area = p.name;
    } else {
      return say(deps, phone, "I couldn't find that area. Please share your shop location, or type e.g. _Phase 7 Mohali_.");
    }
    const ownerName = await contactName(deps, phone);
    await deps.db.query(
      `INSERT INTO shops (phone, name, owner_name, categories, area, lat, lng, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       ON CONFLICT (phone) DO NOTHING`,
      [phone, String(conv.data.name), ownerName, conv.data.categories as string[], area, lat, lng],
    );
    await setConversation(deps.db, phone, "idle", {});
    await logEvent(deps.db, "shop_signup", phone, { name: conv.data.name });
    return say(deps, phone, `✅ Thanks! *${conv.data.name}* (${area}) is registered. Our team will verify your shop shortly, and then you'll start getting customer requests here.`);
  }
}

// ---------------------------------------------------------------- shops

async function openRequestsFor(deps: Deps, shopId: number): Promise<number[]> {
  const rows = await deps.db.query<{ request_id: number }>(
    `SELECT rs.request_id FROM request_shops rs JOIN requests r ON r.id = rs.request_id
      WHERE rs.shop_id = $1 AND rs.status = 'notified' AND r.status = 'collecting' ORDER BY rs.notified_at DESC`,
    [shopId],
  );
  return rows.map((r) => r.request_id);
}

async function recordQuote(deps: Deps, shop: Shop, requestId: number, text: string): Promise<void> {
  const offer = await deps.ai.understandOffer(text);
  if (!offer.price) {
    await setConversation(deps.db, shop.phone, "shop_quote", { requestId });
    await say(deps, shop.phone, "Please include your *price* in rupees, e.g. _Voltas 5 star, ₹36,900, install tomorrow_.");
    return;
  }
  const result = await saveOffer(deps, requestId, shop.id, { price: offer.price, brandModel: offer.brandModel, eta: offer.eta, notes: offer.notes }, "shop");
  await setConversation(deps.db, shop.phone, "idle", {});
  if (result === "saved") {
    await say(deps, shop.phone, `✅ Offer sent: ₹${offer.price.toLocaleString("en-IN")}${offer.brandModel ? " · " + offer.brandModel : ""}${offer.eta ? " · " + offer.eta : ""}. We'll tell you if the customer picks you.`);
  } else {
    await say(deps, shop.phone, "Sorry, this request has already closed. Reply faster next time to win more customers! ⚡");
  }
}

async function handleShop(deps: Deps, shop: Shop, event: Exclude<Inbound, { kind: "audio" | "unsupported" }>) {
  if (shop.status !== "active") {
    await say(deps, shop.phone, "⏳ Your shop is still being verified by the Zyyko team. We'll message you once it's live.");
    return;
  }
  if (event.kind === "button") {
    const [action, id] = event.id.split(":");
    const requestId = Number(id);
    const invited = await deps.db.query<{ status: string; req_status: string }>(
      `SELECT rs.status, r.status AS req_status FROM request_shops rs JOIN requests r ON r.id = rs.request_id WHERE rs.request_id = $1 AND rs.shop_id = $2`,
      [requestId, shop.id],
    );
    if (!invited[0] || invited[0].req_status !== "collecting") {
      await say(deps, shop.phone, "This request has already closed.");
      return;
    }
    if (action === "quote") {
      await setConversation(deps.db, shop.phone, "shop_quote", { requestId });
      await say(deps, shop.phone, "Reply with your *best price*, model and when you can deliver/visit.\nExample: _Voltas 5 star 1.5T, ₹36,900, install tomorrow_");
      return;
    }
    if (action === "pass") {
      await deps.db.query(`UPDATE request_shops SET status = 'passed' WHERE request_id = $1 AND shop_id = $2`, [requestId, shop.id]);
      await say(deps, shop.phone, "OK, noted. 👍");
      return;
    }
    return;
  }
  if (event.kind === "location") {
    await deps.db.query(`UPDATE shops SET lat = $2, lng = $3 WHERE id = $1`, [shop.id, event.lat, event.lng]);
    await say(deps, shop.phone, "📍 Shop location updated.");
    return;
  }

  const t = normalize(event.text);
  if (t === "pause") {
    await deps.db.query(`UPDATE shops SET paused = true WHERE id = $1`, [shop.id]);
    return say(deps, shop.phone, "⏸️ Paused. You won't get new requests. Send *RESUME* to start again.");
  }
  if (t === "resume") {
    await deps.db.query(`UPDATE shops SET paused = false WHERE id = $1`, [shop.id]);
    return say(deps, shop.phone, "▶️ You're live again and will get new requests.");
  }
  if (t === "status") {
    const s = (await getShopByPhone(deps.db, shop.phone))!;
    return say(deps, shop.phone, `🏪 *${s.name}* · ${s.area}\nStatus: ${s.paused ? "paused" : "live"}\nRequests received: ${s.notified_count} · Offers sent: ${s.replied_count}\nRating: ${s.rating_count ? (s.rating_sum / s.rating_count).toFixed(1) + " ★" : "no ratings yet"}`);
  }

  const conv = await getConversation(deps.db, shop.phone);
  if (conv.state === "shop_quote") return recordQuote(deps, shop, Number(conv.data.requestId), event.text);

  // A price sent without tapping the button goes to their latest open request.
  const open = await openRequestsFor(deps, shop.id);
  if (open.length && /\d{3,}/.test(event.text.replace(/,/g, ""))) return recordQuote(deps, shop, open[0], event.text);
  await say(deps, shop.phone, SHOP_HELP);
}
