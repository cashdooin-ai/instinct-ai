import { beforeEach, describe, expect, it } from "vitest";
import { handleInbound } from "../src/bot.js";
import { tick, type Deps } from "../src/engine.js";
import type { Db } from "../src/db.js";
import { seedDemoShops } from "../src/shops.js";
import { Clock, FakeMessenger, testDeps, textOf } from "./helpers.js";

const BUYER = "sim-buyer-1";
let deps: Deps, db: Db, messenger: FakeMessenger, clock: Clock;

const text = (phone: string, t: string, name = "Rohit") => handleInbound(deps, { kind: "text", phone, name, text: t });
const tap = (phone: string, id: string) => handleInbound(deps, { kind: "button", phone, name: "", id, title: id });

beforeEach(async () => {
  ({ deps, db, messenger, clock } = await testDeps());
  await seedDemoShops(db);
});

describe("buyer to shops to choice", () => {
  it("runs the whole flow", async () => {
    await text(BUYER, "hi");
    expect(textOf(messenger.last(BUYER))).toContain("Welcome to *Zyyko*");

    await text(BUYER, "Need 1.5 ton inverter AC under 40k, Sector 70 Mohali, with installation");
    const confirm = messenger.last(BUYER);
    expect(confirm.type).toBe("buttons");
    expect(textOf(confirm)).toContain("Air conditioner");
    expect(textOf(confirm)).toContain("₹40,000");

    // Follow-up tweak updates the draft instead of starting over.
    await text(BUYER, "budget 38k");
    expect(textOf(messenger.last(BUYER))).toContain("₹38,000");

    messenger.clear();
    await tap(BUYER, "find");
    expect(textOf(messenger.last(BUYER))).toMatch(/Asking \d+ shops near Sector 70, Mohali/);

    const alerted = messenger.sent.filter((s) => s.to.startsWith("sim-shop-"));
    expect(alerted.length).toBeGreaterThanOrEqual(3);
    // Only AC sellers within 12 km: Pinjore and Derabassi are too far from Mohali.
    const names = await db.query<{ name: string }>(`SELECT s.name FROM request_shops rs JOIN shops s ON s.id = rs.shop_id`);
    expect(names.map((n) => n.name)).toContain("Sharma Electronics");
    expect(names.map((n) => n.name)).not.toContain("Pinjore Electricals");
    expect(names.map((n) => n.name)).not.toContain("Tricity Plumbing Co.");

    const [shopA, shopB] = alerted.map((a) => a.to);
    const reqId = Number((alerted[0].msg as { buttons: { id: string }[] }).buttons[0].id.split(":")[1]);

    // Shop A taps "Send price" then replies; shop B just replies with a price.
    await tap(shopA, `quote:${reqId}`);
    await text(shopA, "Voltas 5 star 1.5T, 36,900, install tomorrow");
    expect(textOf(messenger.last(shopA))).toContain("Offer sent: ₹36,900");
    await text(shopB, "LG 3 star 34500 today");
    expect(textOf(messenger.last(shopB))).toContain("Offer sent: ₹34,500");

    // Window closes: buyer gets a ranked list, cheapest first.
    clock.advance(16 * 60_000);
    await tick(deps);
    const list = messenger.last(BUYER);
    expect(list.type).toBe("list");
    if (list.type !== "list") throw new Error();
    expect(list.rows).toHaveLength(2);
    expect(list.rows[0].title).toContain("₹34,500");
    expect(textOf(list)).toContain("(lowest price)");

    // Late offers are refused politely.
    const late = alerted[2]?.to;
    if (late) {
      await text(late, "33000");
      expect(textOf(messenger.last(late))).not.toContain("Offer sent");
    }

    // Buyer picks the second offer.
    await tap(BUYER, list.rows[1].id);
    expect(textOf(messenger.last(BUYER))).toContain("Great choice");
    expect(textOf(messenger.last(shopA))).toContain("A customer chose your offer");
    expect(textOf(messenger.last(shopA))).toContain("sim-buyer-1");
    expect(textOf(messenger.last(shopB))).toContain("chose another offer");

    const [sel] = await db.query<{ fee: number }>(`SELECT fee FROM selections`);
    expect(sel.fee).toBe(99);

    // Picking twice does nothing.
    await tap(BUYER, list.rows[0].id);
    expect(textOf(messenger.last(BUYER))).toContain("no longer available");

    // Rating.
    await text(BUYER, "5");
    expect(textOf(messenger.last(BUYER))).toContain("Thanks for rating");
  });

  it("asks for the area when it's missing, accepts a location pin", async () => {
    await text(BUYER, "plumber for kitchen leak today");
    expect(messenger.last(BUYER).type).toBe("location_request");
    await handleInbound(deps, { kind: "location", phone: BUYER, name: "", lat: 30.6425, lng: 76.8173, label: "" });
    const confirm = messenger.last(BUYER);
    expect(confirm.type).toBe("buttons");
    expect(textOf(confirm)).toContain("Plumber");
    expect(textOf(confirm)).toContain("Zirakpur");
  });

  it("flags requests with no matching shops for the team", async () => {
    await text(BUYER, "chimney under 15k in Pinjore");
    await tap(BUYER, "find");
    expect(textOf(messenger.last(BUYER))).toContain("Our team will call shops");
    const [r] = await db.query<{ needs_ops: boolean }>(`SELECT needs_ops FROM requests`);
    expect(r.needs_ops).toBe(true);
    clock.advance(16 * 60_000);
    await tick(deps);
    expect(textOf(messenger.last(BUYER))).toContain("No shop has sent an offer");
  });

  it("SHOW waits while there are no offers, then sends what's in", async () => {
    await text(BUYER, "AC 1.5 ton under 40k Sector 70 Mohali");
    await tap(BUYER, "find");
    await text(BUYER, "show");
    expect(textOf(messenger.last(BUYER))).toContain("No offers yet");
    const shop = messenger.sent.find((s) => s.to.startsWith("sim-shop-"))!.to;
    await text(shop, "35000");
    await text(BUYER, "show");
    expect(messenger.last(BUYER).type).toBe("list");
  });

  it("closes early once enough offers arrive", async () => {
    deps.config.targetOffers = 2;
    await text(BUYER, "AC 1.5 ton under 40k Sector 70 Mohali");
    await tap(BUYER, "find");
    const shops = [...new Set(messenger.sent.filter((s) => s.to.startsWith("sim-shop-")).map((s) => s.to))];
    await text(shops[0], "35000");
    await text(shops[1], "36000");
    expect(messenger.last(BUYER).type).toBe("list");
  });

  it("demo shops quote automatically", async () => {
    deps.config.demoAutoQuote = true;
    await text(BUYER, "AC service tomorrow VIP Road Zirakpur");
    await tap(BUYER, "find");
    clock.advance(70_000);
    await tick(deps);
    const offers = await db.query(`SELECT * FROM offers`);
    expect(offers.length).toBeGreaterThan(0);
  });
});

describe("test and real traffic stay apart", () => {
  it("never sends real buyers to demo shops, or simulator buyers to real shops", async () => {
    await db.query(`INSERT INTO shops (phone, name, categories, area, lat, lng, status) VALUES ('919800000001','Real AC Shop','{ac}','Sector 70, Mohali',30.7,76.705,'active')`);
    await text("919811111111", "AC 1.5 ton under 40k Sector 70 Mohali");
    await tap("919811111111", "find");
    const realAsked = await db.query<{ phone: string }>(`SELECT s.phone FROM request_shops rs JOIN shops s ON s.id = rs.shop_id JOIN requests r ON r.id = rs.request_id WHERE r.buyer_phone = '919811111111'`);
    expect(realAsked.map((r) => r.phone)).toEqual(["919800000001"]);

    await text(BUYER, "AC 1.5 ton under 40k Sector 70 Mohali");
    await tap(BUYER, "find");
    const simAsked = await db.query<{ phone: string }>(`SELECT s.phone FROM request_shops rs JOIN shops s ON s.id = rs.shop_id JOIN requests r ON r.id = rs.request_id WHERE r.buyer_phone = $1`, [BUYER]);
    expect(simAsked.length).toBeGreaterThan(0);
    expect(simAsked.every((r) => r.phone.startsWith("sim-"))).toBe(true);
  });
});

describe("shop sign-up", () => {
  it("registers a shop and waits for approval", async () => {
    const shop = "sim-newshop-1";
    await text(shop, "JOIN", "Rakesh");
    expect(textOf(messenger.last(shop))).toContain("shop name");
    await text(shop, "Rakesh Electronics", "Rakesh");
    expect(textOf(messenger.last(shop))).toContain("Reply with the numbers");
    await text(shop, "1, 2, 13", "Rakesh");
    expect(messenger.last(shop).type).toBe("location_request");
    await text(shop, "Phase 7 Mohali", "Rakesh");
    expect(textOf(messenger.last(shop))).toContain("is registered");
    const [row] = await db.query<{ status: string; categories: string[]; owner_name: string }>(`SELECT status, categories, owner_name FROM shops WHERE phone = $1`, [shop]);
    expect(row.status).toBe("pending");
    expect(row.categories).toEqual(["ac", "refrigerator", "plumber"]);
    expect(row.owner_name).toBe("Rakesh");
    await text(shop, "hello");
    expect(textOf(messenger.last(shop))).toContain("still being verified");
  });
});
