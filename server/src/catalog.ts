// What Zyyko handles in the pilot: home appliances (buy) and home services (book).
// Keywords include common Hinglish/Punjabi spellings people type on WhatsApp.

export type Group = "appliance" | "service";

export interface Category {
  key: string;
  label: string;
  group: Group;
  keywords: string[];
}

export const CATEGORIES: Category[] = [
  { key: "ac", label: "Air conditioner", group: "appliance", keywords: ["ac", "a c", "air conditioner", "airconditioner", "split ac", "window ac", "inverter ac"] },
  { key: "refrigerator", label: "Refrigerator", group: "appliance", keywords: ["fridge", "refrigerator", "freezer", "double door", "single door"] },
  { key: "washing_machine", label: "Washing machine", group: "appliance", keywords: ["washing machine", "washing", "front load", "top load", "washer"] },
  { key: "tv", label: "TV", group: "appliance", keywords: ["tv", "television", "led tv", "smart tv", "led"] },
  { key: "microwave", label: "Microwave / oven", group: "appliance", keywords: ["microwave", "oven", "otg"] },
  { key: "water_purifier", label: "Water purifier", group: "appliance", keywords: ["ro", "water purifier", "purifier", "aquaguard"] },
  { key: "geyser", label: "Geyser", group: "appliance", keywords: ["geyser", "geaser", "gizer", "water heater"] },
  { key: "air_cooler", label: "Air cooler", group: "appliance", keywords: ["cooler", "air cooler"] },
  { key: "chimney", label: "Kitchen chimney", group: "appliance", keywords: ["chimney"] },
  { key: "ac_service", label: "AC service / repair", group: "service", keywords: [] },
  { key: "appliance_repair", label: "Appliance repair", group: "service", keywords: [] },
  { key: "ro_service", label: "RO service", group: "service", keywords: [] },
  { key: "plumber", label: "Plumber", group: "service", keywords: ["plumber", "plumbing", "tap", "leak", "leakage", "pipe", "nal", "toilet", "flush", "basin", "tanki", "seepage"] },
  { key: "electrician", label: "Electrician", group: "service", keywords: ["electrician", "wiring", "switch", "switchboard", "mcb", "short circuit", "fan install", "light fitting", "bijli"] },
  { key: "carpenter", label: "Carpenter", group: "service", keywords: ["carpenter", "furniture repair", "almirah", "wardrobe repair", "door repair", "lakdi"] },
  { key: "painter", label: "Painter", group: "service", keywords: ["painter", "painting", "paint", "safedi", "whitewash", "putty", "rang"] },
  { key: "pest_control", label: "Pest control", group: "service", keywords: ["pest", "termite", "deemak", "dimak", "cockroach", "bed bugs", "khatmal", "mosquito"] },
  { key: "home_cleaning", label: "Home cleaning", group: "service", keywords: ["deep clean", "deep cleaning", "home cleaning", "sofa cleaning", "bathroom cleaning", "kitchen cleaning", "safai"] },
];

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

export function getCategory(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

/** Fee a shop pays when a buyer picks its offer (pilot defaults, editable later). */
export function offerFee(key: string): number {
  return getCategory(key)?.group === "appliance" ? 99 : 49;
}

export const BRANDS = [
  "samsung", "lg", "voltas", "daikin", "hitachi", "blue star", "bluestar", "lloyd", "carrier", "panasonic",
  "whirlpool", "godrej", "haier", "ifb", "bosch", "sony", "mi", "xiaomi", "oneplus", "tcl", "kent",
  "aquaguard", "eureka forbes", "livpure", "bajaj", "havells", "ao smith", "racold", "crompton", "symphony",
  "faber", "elica", "kaff", "philips", "onida", "toshiba", "hisense", "vu", "o general", "mitsubishi",
];
