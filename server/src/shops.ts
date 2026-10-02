// Shop management used by the admin panel: bulk import from the field team's sheet,
// demo shops for testers, and approvals.
import { CATEGORIES } from "./catalog.js";
import type { Db } from "./db.js";
import { PLACES, resolveArea } from "./geo.js";
import type { Messenger } from "./messenger.js";

/** "98765 43210" or "+91-98765-43210" -> "919876543210". */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null;
}

function categoryKeys(raw: string): string[] {
  return raw.split(/[|;/]/).map((s) => s.trim().toLowerCase()).filter(Boolean).flatMap((s) => {
    const hit = CATEGORIES.find((c) => c.key === s.replace(/\s+/g, "_") || c.label.toLowerCase() === s);
    return hit ? [hit.key] : [];
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === "," && !quoted) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export interface ImportResult { imported: number; updated: number; errors: string[] }

/**
 * CSV columns (header row required, any order):
 * name, phone, categories, area, address, owner_name, lat, lng
 * categories: keys or labels separated by | e.g. "ac|refrigerator" or "AC service / repair|Plumber"
 */
export async function importShopsCsv(db: Db, csv: string): Promise<ImportResult> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const result: ImportResult = { imported: 0, updated: 0, errors: [] };
  if (lines.length < 2) { result.errors.push("Paste a header row and at least one shop."); return result; }
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const col = (row: string[], name: string) => row[header.indexOf(name)] ?? "";
  for (const [i, line] of lines.slice(1).entries()) {
    const row = splitCsvLine(line);
    const rowNo = i + 2;
    const name = col(row, "name");
    const phone = normalizePhone(col(row, "phone"));
    const cats = categoryKeys(col(row, "categories"));
    if (!name || !phone) { result.errors.push(`Row ${rowNo}: needs a name and a valid 10-digit phone.`); continue; }
    if (!cats.length) { result.errors.push(`Row ${rowNo} (${name}): no recognised categories.`); continue; }
    let lat = Number(col(row, "lat"));
    let lng = Number(col(row, "lng"));
    let area = col(row, "area");
    if (!lat || !lng) {
      const place = resolveArea(`${area} ${col(row, "address")}`);
      if (!place) { result.errors.push(`Row ${rowNo} (${name}): couldn't place area "${area}". Add lat,lng.`); continue; }
      lat = place.lat; lng = place.lng; area = area || place.name;
    }
    const rows = await db.query<{ inserted: boolean }>(
      `INSERT INTO shops (phone, name, owner_name, categories, area, address, lat, lng, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, owner_name = EXCLUDED.owner_name, categories = EXCLUDED.categories,
         area = EXCLUDED.area, address = EXCLUDED.address, lat = EXCLUDED.lat, lng = EXCLUDED.lng
       RETURNING (xmax = 0) AS inserted`,
      [phone, name, col(row, "owner_name"), cats, area, col(row, "address"), lat, lng],
    );
    if (rows[0]?.inserted) result.imported++; else result.updated++;
  }
  return result;
}

const DEMO_SHOPS: { name: string; place: string; cats: string[] }[] = [
  { name: "Sharma Electronics", place: "mohali-sec-70", cats: ["ac", "refrigerator", "washing_machine", "tv"] },
  { name: "Cool Point AC", place: "mohali", cats: ["ac", "ac_service", "air_cooler"] },
  { name: "Gill Home Appliances", place: "kharar", cats: ["ac", "refrigerator", "washing_machine", "microwave", "geyser"] },
  { name: "Aggarwal Electronics", place: "chd-sec-22", cats: ["ac", "refrigerator", "tv", "microwave", "water_purifier"] },
  { name: "Sector 35 Digital", place: "chd-sec-35", cats: ["tv", "washing_machine", "microwave", "chimney"] },
  { name: "Manimajra Cooling Centre", place: "manimajra", cats: ["ac", "ac_service", "refrigerator", "appliance_repair"] },
  { name: "VIP Road Electronics", place: "vip-road", cats: ["ac", "refrigerator", "washing_machine", "tv", "geyser"] },
  { name: "Dhakoli Appliance Hub", place: "dhakoli", cats: ["ac", "air_cooler", "water_purifier", "chimney"] },
  { name: "Panchkula Electronics", place: "panchkula", cats: ["ac", "refrigerator", "tv", "washing_machine"] },
  { name: "Pinjore Electricals", place: "pinjore", cats: ["ac", "geyser", "electrician", "appliance_repair"] },
  { name: "Derabassi Home Store", place: "derabassi", cats: ["ac", "refrigerator", "air_cooler"] },
  { name: "QuickFix AC Services", place: "mohali-phase-11", cats: ["ac_service", "appliance_repair", "ro_service"] },
  { name: "Tricity Plumbing Co.", place: "zirakpur", cats: ["plumber"] },
  { name: "Sandhu Plumber & Sanitary", place: "mohali-sec-70", cats: ["plumber"] },
  { name: "Bright Spark Electricians", place: "chd-sec-43", cats: ["electrician"] },
  { name: "Panchkula Home Services", place: "pkl-sec-11", cats: ["plumber", "electrician", "carpenter", "ac_service"] },
  { name: "Zirakpur RO Care", place: "baltana", cats: ["ro_service", "water_purifier"] },
  { name: "Termite Shield Pest Control", place: "chandigarh", cats: ["pest_control"] },
  { name: "SparkleClean Home Cleaning", place: "aerocity", cats: ["home_cleaning"] },
  { name: "Royal Painters", place: "dhakoli", cats: ["painter", "carpenter"] },
];

/** Creates demo shops (phones "sim-shop-N") that testers can act as in the simulator. */
export async function seedDemoShops(db: Db): Promise<number> {
  let n = 0;
  for (const [i, s] of DEMO_SHOPS.entries()) {
    const place = PLACES.find((p) => p.key === s.place)!;
    // Spread shops a little so they're not all on the same point.
    const jitter = ((i * 37) % 9 - 4) * 0.002;
    await db.query(
      `INSERT INTO shops (phone, name, owner_name, categories, area, address, lat, lng, status, is_demo, rating_sum, rating_count)
       VALUES ($1,$2,'Demo owner',$3,$4,$5,$6,$7,'active',true,$8,$9) ON CONFLICT (phone) DO NOTHING`,
      [`sim-shop-${i + 1}`, s.name, s.cats, place.name, `${place.name} (demo)`, place.lat + jitter, place.lng - jitter, 4 * (2 + (i % 4)) + (i % 3), 2 + (i % 4)],
    );
    n++;
  }
  return n;
}

export async function setShopStatus(db: Db, messenger: Messenger, shopId: number, status: "active" | "rejected" | "pending"): Promise<void> {
  const rows = await db.query<{ phone: string; name: string; status: string }>(
    `UPDATE shops SET status = $2 WHERE id = $1 RETURNING phone, name, status`, [shopId, status],
  );
  const shop = rows[0];
  if (shop && status === "active") {
    await messenger.send(shop.phone, {
      type: "text",
      text: `🎉 *${shop.name}* is now live on Zyyko! You'll get customer requests here. Tap *Send price* to reply. Send *HELP* anytime.`,
    });
  }
}
