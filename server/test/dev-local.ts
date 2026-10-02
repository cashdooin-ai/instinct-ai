// Local playground: in-memory Postgres, demo shops, demo auto-quotes. Not used in production.
// Run: npx tsx test/dev-local.ts  then open http://localhost:3000/simulator?token=dev-admin-token-123
import { rulesOnly } from "../src/ai.js";
import { tick, type Deps } from "../src/engine.js";
import { RoutingMessenger } from "../src/messenger.js";
import { buildServer } from "../src/server.js";
import { seedDemoShops } from "../src/shops.js";
import { testConfig, testDb } from "./helpers.js";

const db = await testDb();
const config = testConfig({ adminToken: "dev-admin-token-123", demoAutoQuote: true, offerWindowMinutes: 3 });
config.whatsapp.token = "";
const deps: Deps = { db, config, messenger: new RoutingMessenger(db, config), ai: rulesOnly, now: () => new Date() };
await seedDemoShops(db);
const app = buildServer(deps);
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "127.0.0.1" });
setInterval(() => tick(deps).catch(console.error), 3000);
console.log("Local Zyyko on http://localhost:3000 · simulator: /simulator?token=dev-admin-token-123");
