# Zyyko progress log

## 2026-10-02: Pilot build v0.1
**Decisions:** Pilot area is Chandigarh Tricity (Chandigarh, Mohali, Kharar, New Chandigarh, Zirakpur, Panchkula,
Derabassi, Pinjore, Kalka). Categories are home appliances (buy) and home services (book). WhatsApp first, plus a web
simulator for testers until Meta approval. The owner has testers but no developers.

**Built**
- WhatsApp Cloud API webhook (signature check, de-duplication), text/button/list/location/voice-note handling.
- Buyer flow: understand the request (rules + optional Claude), ask for a missing area (pin or typed), confirm,
  follow-up edits ("budget 38k"), send to up to 8 nearby shops, 15-minute window or early close at 5 offers,
  ranked list, choice, contact exchange, 1–5 rating, SHOW/CANCEL.
- Shop flow: alerts with Send price / Not available (template outside the 24-hour window), price replies parsed,
  late offers refused, PAUSE/RESUME/STATUS, JOIN sign-up with admin approval.
- Admin panel: dashboard, request detail, add offers from phone calls, close now, approve/import shops (CSV),
  demo shops, leads.
- Simulator for testers; demo shops auto-quote. Test and real traffic never mix.
- zyyko.com landing page + lead form, draft privacy page.
- Render blueprint, setup guide, tester checklist. 35 automated tests.

**Not built yet (next candidates, roughly in order)**
1. Owner feedback from testers → fix wording and parsing misses (collect from TESTING.md results).
2. WhatsApp go-live once Meta approves (template name/language must match the env vars).
3. In-chat payments (Razorpay / WhatsApp Pay) for advances; fee collection from shops (currently recorded as "pending").
4. Shop catalogue/prices from photos; shop dashboard on the web; weekly shop summary.
5. ChatGPT app / Claude connector (MCP server) exposing search_local_offers / request_quotes / place_order.
6. Automatic rating reminder after the job; buyer "my requests" history.
7. Programmatic SEO pages on zyyko.com (city × category).

**Open questions for the owner**
- Is the business registered (GST/Udyam)? Meta verification needs it.
- WhatsApp number to use (new SIM).
- Fee levels (₹99 appliances / ₹49 services per chosen offer) and whether to charge during the pilot.
