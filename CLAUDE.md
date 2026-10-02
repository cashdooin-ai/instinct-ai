# Zyyko: notes for Claude sessions

Zyyko (zyyko.com) is a WhatsApp-first local-offers marketplace for Chandigarh Tricity: a buyer asks once,
nearby shops reply with prices, the buyer picks. The owner is not a developer. Claude writes all code; the
owner manages accounts and Railway settings (see docs/SETUP.md). Read docs/PROGRESS.md first. It's the
running log of what's built and what's next. Update it at the end of every session.

## Layout
- `server/`: Node 22 + TypeScript (ESM), Fastify, Postgres. One service runs everything.
  - `src/bot.ts`: conversation flows (buyer, shop, shop sign-up). Entry: `handleInbound`.
  - `src/engine.ts`: matching, broadcast to shops, offers, ranking, selection, `tick()` scheduler.
  - `src/parser.ts`: rule-based parsing (budget, category, area, offers). `src/ai.ts`: Claude + Sarvam, falls back to rules.
  - `src/geo.ts`: Tricity gazetteer (approximate coords). `src/catalog.ts`: categories + fees.
  - `src/messenger.ts`: phones starting `sim-` go to the simulator; everything else goes to the WhatsApp Cloud API.
  - `src/routes/`: admin panel (server-rendered HTML), simulator API; `public/simulator.html`.
  - `src/db.ts`: idempotent migrations run on startup. Add new tables/columns as new entries; never edit old ones.
- `web/`: zyyko.com landing + privacy (served by the server at `/` and `/privacy`).
- `docs/`: strategy blueprints (HTML), SETUP.md (owner), TESTING.md (testers), PROGRESS.md (log).

## Commands (run in `server/`)
- `npm test`: vitest, uses PGlite (real Postgres in-process). All tests must pass before pushing.
- `npm run typecheck`, `npm run build`
- `npx tsx test/dev-local.ts`: local server with demo shops at http://localhost:3000/simulator?token=dev-admin-token-123

## Rules
- Simulator traffic (`sim-` phones) must never reach real shops or real buyers. `matchShops` enforces this.
- Secrets only via env vars (see `server/.env.example`). Never log tokens or full buyer phone numbers.
- Keep WhatsApp limits in mind: 3 reply buttons (20 chars), 10 list rows (24/72 chars), and the 24-hour window
  (outside it, shops get the `zyyko_new_request` template).
- Default AI model is set by `ANTHROPIC_MODEL` (default `claude-opus-5-5`); the owner may switch to Haiku for cost.
