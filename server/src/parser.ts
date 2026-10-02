// Rule-based understanding of buyer requests and shop offers. Works with no AI key and
// is the safety net when the AI call fails. The AI parser (ai.ts) refines these results.
import { BRANDS, CATEGORIES, getCategory } from "./catalog.js";
import { normalize, resolveArea, type Place } from "./geo.js";

export interface ParsedRequest {
  category: string | null;
  item: string;
  brand: string;
  budgetMax: number | null;
  place: Place | null;
  timing: string;
  needsInstallation: boolean;
  isGreeting: boolean;
}

export interface ParsedOffer {
  price: number | null;
  brandModel: string;
  eta: string;
  notes: string;
}

const SERVICE_WORDS = ["service", "servicing", "repair", "repairing", "fix", "gas", "gas filling", "not cooling", "thanda nahi", "kharab", "kharaab", "noise", "leaking", "uninstall", "reinstall", "shifting", "cleaning", "theek", "thik", "mechanic", "technician", "not working", "band ho gaya"];
const GREETINGS = ["hi", "hello", "hey", "hii", "hiii", "namaste", "sat sri akal", "sasriakal", "start", "menu", "help"];
const UNIT_AFTER = /^\s*(ton|tonne|tr|star|door|litre|liter|ltr|l|kg|inch|inches|"|hp|watt|w|year|years|yr|yrs|month|months|sq|sqft|bhk|cm|km|min|mins|minutes|hours|hrs|am|pm)\b/;

function has(t: string, phrase: string): boolean {
  return ` ${t} `.includes(` ${normalize(phrase)} `);
}

function detectCategory(t: string): string | null {
  const isService = SERVICE_WORDS.some((w) => has(t, w));
  const applianceHit = CATEGORIES.find((c) => c.group === "appliance" && c.keywords.some((k) => has(t, k)));
  if (applianceHit && isService) {
    if (applianceHit.key === "ac") return "ac_service";
    if (applianceHit.key === "water_purifier") return "ro_service";
    return "appliance_repair";
  }
  const serviceHit = CATEGORIES.find((c) => c.group === "service" && c.keywords.some((k) => has(t, k)));
  if (serviceHit) return serviceHit.key;
  if (applianceHit) return applianceHit.key;
  return null;
}

/** Reads amounts like ₹40,000 · 40k · 40 hazaar · 1.5 lakh · under 40000. Ignores "1.5 ton", "5 star". */
export function parseBudget(text: string): number | null {
  const t = text.toLowerCase().replace(/,/g, "");
  const re = /(₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|hazaar|hazar|hajar|hzr|lakhs|lakh|lac|l)?(?![a-z0-9])/g;
  let best: number | null = null;
  for (const m of t.matchAll(re)) {
    const [, currency, digits, mult] = m;
    const after = t.slice((m.index ?? 0) + m[0].length);
    const before = t.slice(Math.max(0, (m.index ?? 0) - 12), m.index ?? 0);
    if (!mult && UNIT_AFTER.test(after)) continue;
    if (digits.length >= 10) continue; // phone number
    let value = Number(digits);
    if (mult === "k" || mult === "thousand" || mult?.startsWith("ha") || mult === "hzr") value *= 1000;
    else if (mult && /^(lakh|lac|lakhs|l)$/.test(mult)) value *= 100000;
    const contextual = /(budget|under|upto|up to|below|within|max|tak|around|approx|less than|range)\s*$/.test(before);
    if (!currency && !mult && !contextual && value < 500) continue;
    if (!currency && !mult && !contextual && /sector|phase|sec\s*$/.test(before)) continue;
    if (value < 100) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

function detectTiming(t: string): string {
  if (/\b(today|aaj|abhi|now|urgent|asap|turant|jaldi)\b/.test(t)) return "today";
  if (/\b(tomorrow|kal|kall)\b/.test(t)) return "tomorrow";
  if (/\b(this week|is hafte|iss hafte|week)\b/.test(t)) return "this week";
  if (/\b(weekend|saturday|sunday)\b/.test(t)) return "weekend";
  return "";
}

function detectBrand(t: string): string {
  const hit = BRANDS.find((b) => has(t, b));
  return hit ? hit.replace(/\b\w/g, (c) => c.toUpperCase()) : "";
}

export function parseRequest(text: string): ParsedRequest {
  const t = normalize(text);
  const isGreeting = GREETINGS.includes(t);
  const category = isGreeting ? null : detectCategory(t);
  const cat = category ? getCategory(category) : undefined;
  return {
    category,
    item: cat ? cat.label : "",
    brand: detectBrand(t),
    budgetMax: parseBudget(text),
    place: resolveArea(text),
    timing: detectTiming(t),
    needsInstallation: /\b(install|installation|fitting|fit|lagwana|lagana|lagwani|lagani)\b/.test(t),
    isGreeting,
  };
}

/** Reads a shop's reply like "Voltas 5 star 36,900 install tomorrow". */
export function parseOffer(text: string): ParsedOffer {
  const t = text.toLowerCase().replace(/,/g, "");
  let price: number | null = null;
  const re = /(₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|hazaar|hazar)?(?![a-z0-9])/g;
  for (const m of t.matchAll(re)) {
    const [, currency, digits, mult] = m;
    const after = t.slice((m.index ?? 0) + m[0].length);
    if (!mult && !currency && UNIT_AFTER.test(after)) continue;
    if (digits.length >= 10) continue;
    let v = Number(digits);
    if (mult) v *= 1000;
    if (v < 100) continue;
    if (currency) { price = v; break; }
    if (price === null || v > price) price = v;
  }
  return {
    price,
    brandModel: detectBrand(normalize(text)),
    eta: detectTiming(normalize(text)),
    notes: text.trim().slice(0, 300),
  };
}

/** "1, 3 5" -> [1, 3, 5] */
export function parseNumberList(text: string): number[] {
  return [...new Set((text.match(/\d+/g) ?? []).map(Number))];
}
