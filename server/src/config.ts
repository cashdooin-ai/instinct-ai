// All runtime settings come from environment variables so nothing secret lives in the repo.
// See docs/SETUP.md for where each value comes from.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

function str(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export interface Config {
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  databaseCaCert: string;
  adminToken: string;
  webOrigin: string;
  whatsapp: {
    token: string;
    phoneNumberId: string;
    verifyToken: string;
    appSecret: string;
    graphVersion: string;
    shopAlertTemplate: string;
    templateLanguage: string;
  };
  anthropic: { apiKey: string; model: string };
  sarvamApiKey: string;
  offerWindowMinutes: number;
  targetOffers: number;
  shopsPerRequest: number;
  radiusKmAppliances: number;
  radiusKmServices: number;
  demoAutoQuote: boolean;
}

export function loadConfig(): Config {
  return {
    port: num("PORT", 3000),
    publicBaseUrl: str("PUBLIC_BASE_URL", "http://localhost:3000"),
    databaseUrl: str("DATABASE_URL"),
    databaseCaCert: str("DATABASE_CA_CERT"),
    adminToken: str("ADMIN_TOKEN"),
    webOrigin: str("WEB_ORIGIN", "*"),
    whatsapp: {
      token: str("WHATSAPP_TOKEN"),
      phoneNumberId: str("WHATSAPP_PHONE_NUMBER_ID"),
      verifyToken: str("WHATSAPP_VERIFY_TOKEN"),
      appSecret: str("META_APP_SECRET"),
      graphVersion: str("WHATSAPP_GRAPH_VERSION", "v23.0"),
      shopAlertTemplate: str("WHATSAPP_SHOP_ALERT_TEMPLATE", "zyyko_new_request"),
      templateLanguage: str("WHATSAPP_TEMPLATE_LANGUAGE", "en"),
    },
    anthropic: {
      apiKey: str("ANTHROPIC_API_KEY"),
      model: str("ANTHROPIC_MODEL", "claude-opus-5-5"),
    },
    sarvamApiKey: str("SARVAM_API_KEY"),
    offerWindowMinutes: num("OFFER_WINDOW_MINUTES", 15),
    targetOffers: num("TARGET_OFFERS", 5),
    shopsPerRequest: num("SHOPS_PER_REQUEST", 8),
    radiusKmAppliances: num("RADIUS_KM_APPLIANCES", 12),
    radiusKmServices: num("RADIUS_KM_SERVICES", 8),
    demoAutoQuote: str("DEMO_AUTO_QUOTE", "true") === "true",
  };
}
