// Production entry point: connect to Postgres, run migrations, start the web server and
// the background ticker that closes offer windows.
import { createClaudeUnderstanding, rulesOnly, transcribe } from "./ai.js";
import { loadConfig } from "./config.js";
import { createPgDb, migrate } from "./db.js";
import { tick, type Deps } from "./engine.js";
import { RoutingMessenger } from "./messenger.js";
import { buildServer } from "./server.js";
import { downloadMedia } from "./whatsapp.js";

const config = loadConfig();
if (!config.databaseUrl) throw new Error("DATABASE_URL is required. See docs/SETUP.md.");
if (!config.adminToken || config.adminToken.length < 16) throw new Error("ADMIN_TOKEN must be set (16+ random characters).");

const db = createPgDb(config.databaseUrl, config.databaseCaCert);
await migrate(db);

const deps: Deps = {
  db,
  config,
  messenger: new RoutingMessenger(db, config),
  ai: config.anthropic.apiKey ? createClaudeUnderstanding(config.anthropic.apiKey, config.anthropic.model) : rulesOnly,
  now: () => new Date(),
  transcribeVoice: async (mediaId, mimeType) => {
    if (!config.whatsapp.token || !config.sarvamApiKey) return "";
    try {
      const audio = await downloadMedia(mediaId, config.whatsapp.token, config.whatsapp.graphVersion);
      return await transcribe(audio, mimeType, config.sarvamApiKey);
    } catch (err) {
      console.warn("[voice] download failed:", (err as Error).message);
      return "";
    }
  },
};

const app = buildServer(deps, { logger: true });
await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`Zyyko running on :${config.port} · AI: ${config.anthropic.apiKey ? config.anthropic.model : "rules only"} · WhatsApp: ${config.whatsapp.token ? "on" : "off (simulator only)"}`);

let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try { await tick(deps); } catch (err) { console.error("[tick]", err); } finally { running = false; }
}, 10_000);
