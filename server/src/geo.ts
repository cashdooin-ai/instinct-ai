// Tricity gazetteer: resolves typed area names to approximate coordinates so the pilot
// works without a paid maps API. Coordinates are approximate (±1 km); a WhatsApp
// location pin always wins over a typed area.

export interface Place {
  key: string;
  name: string;
  town: string;
  lat: number;
  lng: number;
  aliases: string[];
}

const P = (key: string, name: string, town: string, lat: number, lng: number, aliases: string[] = []): Place =>
  ({ key, name, town, lat, lng, aliases });

export const PLACES: Place[] = [
  // Chandigarh
  P("chandigarh", "Chandigarh", "Chandigarh", 30.7398, 76.7827, ["chd", "chandigarh city", "sector 17"]),
  P("chd-sec-22", "Sector 22, Chandigarh", "Chandigarh", 30.7333, 76.7725, ["sector 22"]),
  P("chd-sec-35", "Sector 35, Chandigarh", "Chandigarh", 30.723, 76.757, ["sector 35"]),
  P("chd-sec-43", "Sector 43, Chandigarh", "Chandigarh", 30.719, 76.748, ["sector 43", "isbt 43"]),
  P("chd-sec-26", "Sector 26, Chandigarh", "Chandigarh", 30.728, 76.807, ["sector 26"]),
  P("chd-sec-8", "Sector 8, Chandigarh", "Chandigarh", 30.746, 76.796, ["sector 8"]),
  P("manimajra", "Manimajra", "Chandigarh", 30.717, 76.834, ["mani majra"]),
  P("chd-industrial", "Industrial Area, Chandigarh", "Chandigarh", 30.7058, 76.8013, ["industrial area", "elante"]),
  P("chd-sec-45", "Sector 45 / Burail", "Chandigarh", 30.705, 76.76, ["sector 45", "burail"]),
  // Mohali (SAS Nagar)
  P("mohali", "Mohali", "Mohali", 30.7046, 76.7179, ["sas nagar", "mohali city", "phase 7"]),
  P("mohali-phase-3b2", "Phase 3B2, Mohali", "Mohali", 30.709, 76.723, ["phase 3b2", "3b2"]),
  P("mohali-phase-11", "Phase 11, Mohali", "Mohali", 30.69, 76.728, ["phase 11"]),
  P("mohali-sec-70", "Sector 70, Mohali", "Mohali", 30.7, 76.705, ["sector 70"]),
  P("mohali-sec-82", "Sector 82 / JLPL, Mohali", "Mohali", 30.668, 76.715, ["sector 82", "jlpl"]),
  P("aerocity", "Aerocity, Mohali", "Mohali", 30.667, 76.735, ["aero city", "airport road"]),
  P("sohana", "Sohana, Mohali", "Mohali", 30.687, 76.702, []),
  P("kharar", "Kharar", "Kharar", 30.746, 76.645, []),
  P("new-chandigarh", "New Chandigarh / Mullanpur", "New Chandigarh", 30.78, 76.68, ["mullanpur", "new chd"]),
  // Zirakpur
  P("zirakpur", "Zirakpur", "Zirakpur", 30.6425, 76.8173, ["zkp", "zirakpur city"]),
  P("vip-road", "VIP Road, Zirakpur", "Zirakpur", 30.644, 76.812, ["vip road"]),
  P("dhakoli", "Dhakoli, Zirakpur", "Zirakpur", 30.659, 76.83, []),
  P("baltana", "Baltana, Zirakpur", "Zirakpur", 30.667, 76.822, []),
  P("peer-muchalla", "Peer Muchalla, Zirakpur", "Zirakpur", 30.665, 76.845, ["pir muchalla", "peermuchalla"]),
  P("lohgarh", "Lohgarh, Zirakpur", "Zirakpur", 30.629, 76.823, []),
  // Panchkula
  P("panchkula", "Panchkula", "Panchkula", 30.6942, 76.8606, ["pkl", "panchkula city", "sector 5 panchkula"]),
  P("pkl-sec-20", "Sector 20, Panchkula", "Panchkula", 30.668, 76.848, ["sector 20 panchkula"]),
  P("pkl-sec-11", "Sector 11, Panchkula", "Panchkula", 30.69, 76.85, ["sector 11 panchkula"]),
  P("mdc", "Mansa Devi Complex", "Panchkula", 30.724, 76.856, ["mansa devi", "mdc"]),
  P("pinjore", "Pinjore", "Pinjore", 30.7983, 76.918, ["pinjaur"]),
  P("kalka", "Kalka", "Kalka", 30.839, 76.94, []),
  // Derabassi
  P("derabassi", "Derabassi", "Derabassi", 30.5872, 76.8428, ["dera bassi", "dera-bassi"]),
];

const TOWN_WORDS: Record<string, string> = {
  chandigarh: "chandigarh", chd: "chandigarh",
  mohali: "mohali", "sas nagar": "mohali",
  zirakpur: "zirakpur", zkp: "zirakpur",
  panchkula: "panchkula", pkl: "panchkula",
  kharar: "kharar", pinjore: "pinjore", pinjaur: "pinjore", kalka: "kalka",
  derabassi: "derabassi", "dera bassi": "derabassi",
};

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  return ` ${haystack} `.includes(` ${normalize(phrase)} `);
}

/** Finds the most specific known place mentioned in free text, or null. */
export function resolveArea(text: string): Place | null {
  const t = normalize(text);
  if (!t) return null;
  const town = Object.keys(TOWN_WORDS).find((w) => containsPhrase(t, w));
  const townKey = town ? TOWN_WORDS[town] : null;

  // Specific localities first (longest alias wins), preferring ones in the mentioned town.
  let best: { place: Place; score: number } | null = null;
  for (const place of PLACES) {
    for (const alias of [place.name, ...place.aliases]) {
      if (!containsPhrase(t, alias)) continue;
      let score = normalize(alias).length;
      if (townKey && normalize(place.town) === townKey) score += 100;
      if (townKey && normalize(place.town) !== townKey && /sector|phase/.test(alias)) score -= 200;
      if (!best || score > best.score) best = { place, score };
    }
  }
  if (best && best.score > 0) return best.place;
  if (townKey) return PLACES.find((p) => p.key === townKey) ?? null;
  // "sector 32" with no town: most people mean Chandigarh.
  if (/\bsector \d{1,2}\b/.test(t)) return PLACES.find((p) => p.key === "chandigarh") ?? null;
  return null;
}

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest gazetteer place to a coordinate, used to label a shared location pin. */
export function nearestPlace(lat: number, lng: number): Place {
  let best = PLACES[0];
  let bestD = Infinity;
  for (const p of PLACES) {
    const d = distanceKm(lat, lng, p.lat, p.lng);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}
