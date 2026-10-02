import { describe, expect, it } from "vitest";
import { distanceKm, resolveArea } from "../src/geo.js";
import { parseBudget, parseOffer, parseRequest } from "../src/parser.js";

describe("parseBudget", () => {
  it.each([
    ["AC under 40k", 40000],
    ["budget ₹40,000", 40000],
    ["40 hazaar tak", 40000],
    ["rs 35000 max", 35000],
    ["sofa around 1.5 lakh", 150000],
    ["fridge 25-30k", 30000],
  ])("%s -> %d", (text, want) => expect(parseBudget(text)).toBe(want));

  it.each(["1.5 ton inverter AC", "5 star fridge 260 litre", "sector 70 mohali", "call 9876543210", "AC service"])(
    "ignores specs and numbers that aren't prices: %s",
    (text) => expect(parseBudget(text)).toBeNull(),
  );
});

describe("parseRequest", () => {
  it("reads a full appliance request", () => {
    const r = parseRequest("Need 1.5 ton Voltas inverter AC under 40k in Sector 70 Mohali with installation tomorrow");
    expect(r.category).toBe("ac");
    expect(r.brand).toBe("Voltas");
    expect(r.budgetMax).toBe(40000);
    expect(r.place?.key).toBe("mohali-sec-70");
    expect(r.needsInstallation).toBe(true);
    expect(r.timing).toBe("tomorrow");
  });

  it("tells AC service apart from buying an AC", () => {
    expect(parseRequest("AC service chahiye kal, VIP road zirakpur").category).toBe("ac_service");
    expect(parseRequest("ac thanda nahi kar raha").category).toBe("ac_service");
    expect(parseRequest("fridge repair panchkula").category).toBe("appliance_repair");
    expect(parseRequest("RO service needed").category).toBe("ro_service");
  });

  it("understands Hinglish service words", () => {
    expect(parseRequest("ghar mein deemak hai").category).toBe("pest_control");
    expect(parseRequest("kitchen tap leakage plumber aaj").category).toBe("plumber");
    expect(parseRequest("hi").isGreeting).toBe(true);
  });
});

describe("parseOffer", () => {
  it("finds the price and ignores specs", () => {
    const o = parseOffer("Voltas 5 star 1.5 ton, 36,900 with install tomorrow");
    expect(o.price).toBe(36900);
    expect(o.brandModel).toBe("Voltas");
    expect(o.eta).toBe("tomorrow");
    expect(parseOffer("visit charge rs 299, repair extra").price).toBe(299);
    expect(parseOffer("36.9k").price).toBe(36900);
    expect(parseOffer("available").price).toBeNull();
  });
});

describe("geo", () => {
  it("resolves Tricity areas", () => {
    expect(resolveArea("dhakoli zirakpur")?.key).toBe("dhakoli");
    expect(resolveArea("sector 11 panchkula")?.key).toBe("pkl-sec-11");
    expect(resolveArea("Sector 22 Mohali")?.key).toBe("mohali"); // Chandigarh's sector 22 must not win
    expect(resolveArea("sector 32")?.key).toBe("chandigarh");
    expect(resolveArea("Dera Bassi")?.key).toBe("derabassi");
    expect(resolveArea("somewhere in Delhi")).toBeNull();
  });

  it("measures distance in km", () => {
    const d = distanceKm(30.7046, 76.7179, 30.6425, 76.8173); // Mohali to Zirakpur
    expect(d).toBeGreaterThan(10);
    expect(d).toBeLessThan(13);
  });
});
