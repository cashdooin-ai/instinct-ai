// AI helpers: Claude reads messy buyer requests and shop replies; Sarvam turns voice notes
// into text. Every function falls back to the rule-based parser, so the bot keeps working
// if a key is missing or a call fails.
import Anthropic from "@anthropic-ai/sdk";
import { CATEGORY_KEYS, getCategory } from "./catalog.js";
import { resolveArea } from "./geo.js";
import { parseOffer, parseRequest, type ParsedOffer, type ParsedRequest } from "./parser.js";

export interface Understanding {
  understandRequest(text: string): Promise<ParsedRequest>;
  understandOffer(text: string): Promise<ParsedOffer>;
}

export const rulesOnly: Understanding = {
  understandRequest: async (text) => parseRequest(text),
  understandOffer: async (text) => parseOffer(text),
};

const REQUEST_SCHEMA = {
  type: "object",
  properties: {
    is_greeting: { type: "boolean", description: "True if the message is only a greeting or asks how this works." },
    category: { type: "string", enum: [...CATEGORY_KEYS, "unknown"] },
    brand: { type: "string", description: "Brand if mentioned, else empty string." },
    budget_max_inr: { type: "integer", description: "Maximum budget in rupees, 0 if not mentioned." },
    area: { type: "string", description: "Locality/town in Chandigarh Tricity as written, else empty string." },
    timing: { type: "string", enum: ["today", "tomorrow", "this week", "weekend", ""] },
    needs_installation: { type: "boolean" },
  },
  required: ["is_greeting", "category", "brand", "budget_max_inr", "area", "timing", "needs_installation"],
  additionalProperties: false,
} as const;

const OFFER_SCHEMA = {
  type: "object",
  properties: {
    price_inr: { type: "integer", description: "Total price quoted in rupees, 0 if none." },
    brand_model: { type: "string" },
    eta: { type: "string", description: "When the shop can deliver/visit, e.g. 'today', 'tomorrow 5pm', else empty." },
  },
  required: ["price_inr", "brand_model", "eta"],
  additionalProperties: false,
} as const;

const REQUEST_SYSTEM = `You read WhatsApp messages sent to Zyyko, a service in Chandigarh Tricity (Chandigarh, Mohali, Zirakpur, Panchkula, Kharar, Derabassi, Pinjore) that collects offers from local shops for home appliances and home services.
Messages may be in English, Hindi, Punjabi or Hinglish. Extract the buyer's request into the schema.
Category guide: buying a new appliance -> the appliance key (ac, refrigerator, ...). Servicing/repairing an AC -> ac_service; RO service -> ro_service; repairing any other appliance -> appliance_repair. Plumbing, electrical, carpentry, painting, pest control and cleaning map to their own keys. Use "unknown" if it is none of these.
"40 hazaar" means 40000; "1.5 lakh" means 150000. "1.5 ton" and "5 star" are product specs, not prices.`;

const OFFER_SYSTEM = `You read a local shop's WhatsApp reply quoting a price to a customer. Extract the total price in rupees, the brand/model, and when they can deliver or visit. "36.9k" means 36900.`;

/** Models where the request must not carry an effort setting. */
const NO_EFFORT = /haiku|sonnet-4-5/;
/** Models that support server-side refusal fallbacks. */
const FALLBACK_MODELS = /claude-(opus-5|fable-5|sonnet-5-5)/;

export function createClaudeUnderstanding(apiKey: string, model: string): Understanding {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });

  async function extract(system: string, schema: object, text: string): Promise<Record<string, unknown> | null> {
    const params: Record<string, unknown> = {
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: text.slice(0, 2000) }],
      output_config: { format: { type: "json_schema", schema }, ...(NO_EFFORT.test(model) ? {} : { effort: "low" }) },
    };
    if (FALLBACK_MODELS.test(model)) {
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }
    // Typed loosely so the model can be switched by env var without code changes.
    const res = (await client.beta.messages.create(params as never)) as Anthropic.Beta.BetaMessage;
    if (res.stop_reason === "refusal") return null;
    const textBlock = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
    if (!textBlock) return null;
    return JSON.parse(textBlock.text) as Record<string, unknown>;
  }

  return {
    async understandRequest(text) {
      const rules = parseRequest(text);
      try {
        const r = await extract(REQUEST_SYSTEM, REQUEST_SCHEMA, text);
        if (!r) return rules;
        const category = typeof r.category === "string" && getCategory(r.category) ? r.category : rules.category;
        const budget = Number(r.budget_max_inr) > 0 ? Number(r.budget_max_inr) : rules.budgetMax;
        const place = (typeof r.area === "string" && r.area ? resolveArea(r.area) : null) ?? rules.place;
        return {
          category,
          item: category ? getCategory(category)!.label : "",
          brand: typeof r.brand === "string" && r.brand ? r.brand : rules.brand,
          budgetMax: budget,
          place,
          timing: typeof r.timing === "string" && r.timing ? r.timing : rules.timing,
          needsInstallation: r.needs_installation === true || rules.needsInstallation,
          isGreeting: r.is_greeting === true && !category,
        };
      } catch (err) {
        console.warn("[ai] request parse failed, using rules:", (err as Error).message);
        return rules;
      }
    },
    async understandOffer(text) {
      const rules = parseOffer(text);
      try {
        const r = await extract(OFFER_SYSTEM, OFFER_SCHEMA, text);
        if (!r) return rules;
        return {
          price: Number(r.price_inr) > 0 ? Number(r.price_inr) : rules.price,
          brandModel: typeof r.brand_model === "string" && r.brand_model ? r.brand_model : rules.brandModel,
          eta: typeof r.eta === "string" && r.eta ? r.eta : rules.eta,
          notes: rules.notes,
        };
      } catch (err) {
        console.warn("[ai] offer parse failed, using rules:", (err as Error).message);
        return rules;
      }
    },
  };
}

/** Speech-to-text for voice notes via Sarvam AI (Indian languages). Returns "" on failure. */
export async function transcribe(audio: Buffer, mimeType: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!apiKey) return "";
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), "voice.ogg");
    form.append("model", "saarika:v2.5");
    form.append("language_code", "unknown");
    const res = await fetchImpl("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": apiKey },
      body: form,
    });
    if (!res.ok) {
      console.warn(`[voice] sarvam ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return "";
    }
    const data = (await res.json()) as { transcript?: string };
    return data.transcript?.trim() ?? "";
  } catch (err) {
    console.warn("[voice] transcription failed:", (err as Error).message);
    return "";
  }
}
