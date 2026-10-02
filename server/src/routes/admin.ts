// Admin panel: watch requests, add offers from phone calls, approve and import shops.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CATEGORIES, getCategory } from "../catalog.js";
import { closeAndSend, inr, saveOffer, type Deps, type RequestRow, type Shop } from "../engine.js";
import { importShopsCsv, seedDemoShops, setShopStatus } from "../shops.js";
import { esc, fmtTime, layout, maskPhone, pill } from "../views.js";
import { safeEqual, readCookie } from "./auth.js";

type Form = Record<string, string>;

export function registerAdmin(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = deps.config.adminToken;
    const q = (req.query as Record<string, string> | undefined)?.token;
    if (token && q && safeEqual(q, token)) {
      reply.header("Set-Cookie", `zyyko_admin=${encodeURIComponent(q)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`);
      return;
    }
    const cookie = readCookie(req.headers.cookie, "zyyko_admin");
    if (token && cookie && safeEqual(cookie, token)) return;
    reply.code(401).type("text/html").send(layout("Sign in", `<h1>Admin sign-in</h1><p>Open <code>/admin?token=YOUR_ADMIN_TOKEN</code> once on this device.</p>`));
  };

  app.register(async (admin) => {
    admin.addHook("preHandler", requireAdmin);

    admin.get("/admin", async (req, reply) => {
      const flash = (req.query as Record<string, string>).msg;
      const [counts] = await db.query<Record<string, number>>(`SELECT
          (SELECT count(*)::int FROM requests WHERE created_at > now() - interval '1 day') AS req_today,
          (SELECT count(*)::int FROM requests) AS req_total,
          (SELECT count(*)::int FROM offers) AS offers,
          (SELECT count(*)::int FROM selections) AS selections,
          (SELECT coalesce(sum(fee),0)::int FROM selections) AS fees,
          (SELECT count(*)::int FROM shops WHERE status = 'active') AS shops_active,
          (SELECT count(*)::int FROM shops WHERE status = 'pending') AS shops_pending,
          (SELECT count(*)::int FROM requests WHERE needs_ops AND status IN ('collecting','no_offers')) AS needs_ops`);
      const requests = await db.query<RequestRow & { asked: number; offers: number }>(
        `SELECT r.*, (SELECT count(*)::int FROM request_shops rs WHERE rs.request_id = r.id) AS asked,
                (SELECT count(*)::int FROM offers o WHERE o.request_id = r.id) AS offers
           FROM requests r ORDER BY r.id DESC LIMIT 50`);
      const pending = await db.query<Shop>(`SELECT * FROM shops WHERE status = 'pending' ORDER BY id DESC`);
      const tile = (v: unknown, label: string) => `<div class="tile"><b>${esc(v)}</b><span>${esc(label)}</span></div>`;
      const body = `
        ${flash ? `<div class="flash">${esc(flash)}</div>` : ""}
        <h1>Dashboard</h1>
        <div class="tiles">
          ${tile(counts.req_today, "Requests, last 24 h")}${tile(counts.req_total, "Requests, all time")}
          ${tile(counts.offers, "Offers received")}${tile(counts.selections, "Offers chosen")}
          ${tile(inr(counts.fees), "Shop fees earned (pending)")}${tile(counts.shops_active, "Live shops")}
          ${tile(counts.shops_pending, "Shops awaiting approval")}${tile(counts.needs_ops, "Requests needing the team")}
        </div>
        <h2>Latest requests</h2>
        <div class="wrap"><table><thead><tr><th>#</th><th>Time</th><th>Buyer</th><th>Request</th><th>Area</th><th>Budget</th><th>Shops asked</th><th>Offers</th><th>Status</th></tr></thead><tbody>
        ${requests.map((r) => `<tr><td><a href="/admin/requests/${r.id}">${r.id}</a></td><td>${esc(fmtTime(r.created_at))}</td><td>${esc(maskPhone(r.buyer_phone))}</td>
          <td>${esc(r.brand ? r.brand + " " : "")}${esc(r.item)}${r.needs_ops ? ' <span class="ops">needs team</span>' : ""}</td><td>${esc(r.area)}</td>
          <td>${r.budget_max ? esc(inr(r.budget_max)) : "–"}</td><td>${r.asked}</td><td>${r.offers}</td><td>${pill(r.status)}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">No requests yet. Try the <a href="/simulator">simulator</a>.</td></tr>`}
        </tbody></table></div>
        <h2>Shops awaiting approval</h2>
        <div class="wrap"><table><thead><tr><th>Shop</th><th>Phone</th><th>Area</th><th>Categories</th><th></th></tr></thead><tbody>
        ${pending.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${esc(s.area)}</td><td>${esc(s.categories.map((c) => getCategory(c)?.label ?? c).join(", "))}</td>
          <td><form class="inline" method="post" action="/admin/shops/${s.id}/status"><input type="hidden" name="status" value="active"><button>Approve</button></form>
              <form class="inline" method="post" action="/admin/shops/${s.id}/status"><input type="hidden" name="status" value="rejected"><button class="ghost">Reject</button></form></td></tr>`).join("") || `<tr><td colspan="5" class="muted">None.</td></tr>`}
        </tbody></table></div>`;
      reply.type("text/html").send(layout("Dashboard", body));
    });

    admin.get("/admin/requests/:id", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const r = (await db.query<RequestRow>(`SELECT * FROM requests WHERE id = $1`, [id]))[0];
      if (!r) return reply.code(404).send("Not found");
      const asked = await db.query<{ name: string; phone: string; distance_km: number; status: string }>(
        `SELECT s.name, s.phone, rs.distance_km, rs.status FROM request_shops rs JOIN shops s ON s.id = rs.shop_id WHERE rs.request_id = $1 ORDER BY rs.distance_km`, [id]);
      const offers = await db.query<{ id: number; name: string; price: number; brand_model: string; eta: string; notes: string; source: string; chosen: boolean }>(
        `SELECT o.id, s.name, o.price, o.brand_model, o.eta, o.notes, o.source, EXISTS (SELECT 1 FROM selections x WHERE x.offer_id = o.id) AS chosen
           FROM offers o JOIN shops s ON s.id = o.shop_id WHERE o.request_id = $1 ORDER BY o.price`, [id]);
      const candidates = await db.query<Shop>(
        `SELECT * FROM shops WHERE status = 'active' AND $1 = ANY(categories) AND (phone LIKE 'sim-%') = $2 ORDER BY name`,
        [r.category, r.buyer_phone.startsWith("sim-")]);
      const body = `
        <h1>Request #${r.id} ${pill(r.status)} ${r.needs_ops ? '<span class="ops">needs team</span>' : ""}</h1>
        <div class="grid2">
          <div class="card"><b>${esc(r.brand ? r.brand + " " : "")}${esc(r.item)}</b><br>
            Buyer: ${esc(r.buyer_phone)}<br>Area: ${esc(r.area)}<br>Budget: ${r.budget_max ? esc(inr(r.budget_max)) : "–"} · When: ${esc(r.timing || "flexible")} · Installation: ${r.needs_installation ? "yes" : "no"}<br>
            Created ${esc(fmtTime(r.created_at))} · closes ${esc(fmtTime(r.closes_at))}<br>
            <p class="muted">“${esc(r.raw_text)}”</p>
            ${r.status === "collecting" ? `<form method="post" action="/admin/requests/${r.id}/close"><button>Close now and send offers to buyer</button></form>` : ""}
          </div>
          <div class="card"><b>Add an offer from a phone call</b>
            ${r.status === "collecting" ? `<form method="post" action="/admin/requests/${r.id}/offer" style="display:grid;gap:8px;margin-top:8px">
              <select name="shop_id" required>${candidates.map((s) => `<option value="${s.id}">${esc(s.name)} · ${esc(s.area)}</option>`).join("")}</select>
              <input name="price" type="number" min="1" placeholder="Price in ₹" required>
              <input name="brand_model" placeholder="Brand / model (optional)">
              <input name="eta" placeholder="When (e.g. tomorrow)">
              <button>Add offer</button></form>` : `<p class="muted">Request is ${esc(r.status)}; offers are closed.</p>`}
          </div>
        </div>
        <h2>Offers</h2>
        <div class="wrap"><table><thead><tr><th>Shop</th><th>Price</th><th>Model</th><th>When</th><th>Source</th><th>Note</th></tr></thead><tbody>
          ${offers.map((o) => `<tr><td>${esc(o.name)}${o.chosen ? ' <span class="pill s-selected">chosen</span>' : ""}</td><td>${esc(inr(o.price))}</td><td>${esc(o.brand_model)}</td><td>${esc(o.eta)}</td><td>${esc(o.source)}</td><td class="muted">${esc(o.notes)}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No offers yet.</td></tr>`}
        </tbody></table></div>
        <h2>Shops asked</h2>
        <div class="wrap"><table><thead><tr><th>Shop</th><th>Phone</th><th>Distance</th><th>Status</th></tr></thead><tbody>
          ${asked.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.phone)}</td><td>${s.distance_km.toFixed(1)} km</td><td>${pill(s.status)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No shops matched. Call shops and add offers above.</td></tr>`}
        </tbody></table></div>`;
      reply.type("text/html").send(layout(`Request ${id}`, body));
    });

    admin.post("/admin/requests/:id/offer", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const f = req.body as Form;
      const price = Number(f.price);
      if (!(price > 0)) return reply.redirect(`/admin/requests/${id}`);
      await saveOffer(deps, id, Number(f.shop_id), { price, brandModel: f.brand_model ?? "", eta: f.eta ?? "", notes: "Added by Zyyko team from phone call" }, "ops");
      reply.redirect(`/admin/requests/${id}`);
    });

    admin.post("/admin/requests/:id/close", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      await closeAndSend(deps, id);
      reply.redirect(`/admin/requests/${id}`);
    });

    admin.get("/admin/shops", async (req, reply) => {
      const flash = (req.query as Record<string, string>).msg;
      const shops = await db.query<Shop>(`SELECT * FROM shops ORDER BY status, name`);
      const body = `
        ${flash ? `<div class="flash">${esc(flash)}</div>` : ""}
        <h1>Shops (${shops.length})</h1>
        <div class="grid2">
          <div class="card"><b>Import shops from your sheet</b>
            <p class="muted">Paste CSV with a header row. Columns: <code>name, phone, categories, area, address, owner_name, lat, lng</code>. Separate categories with <code>|</code>. Imported shops go live straight away.</p>
            <form method="post" action="/admin/shops/import"><textarea name="csv" placeholder="name,phone,categories,area,address,owner_name
Sharma Electronics,9876543210,ac|refrigerator|tv,Sector 70 Mohali,SCO 12 Sector 70,Rakesh Sharma"></textarea><br><button>Import</button></form>
            <details><summary class="muted">Category keys</summary><p class="muted">${CATEGORIES.map((c) => `<code>${c.key}</code> ${esc(c.label)}`).join(" · ")}</p></details>
          </div>
          <div class="card"><b>Demo shops for testers</b>
            <p class="muted">Adds 20 demo shops across Tricity (phones <code>sim-shop-1</code>…). They only exist in the simulator and send automatic offers, so a tester can try the whole flow alone.</p>
            <form method="post" action="/admin/seed-demo"><button>Add demo shops</button></form>
          </div>
        </div>
        <h2>All shops</h2>
        <div class="wrap"><table><thead><tr><th>Shop</th><th>Phone</th><th>Area</th><th>Categories</th><th>Asked / replied</th><th>Rating</th><th>Status</th><th></th></tr></thead><tbody>
        ${shops.map((s) => `<tr><td>${esc(s.name)}${s.is_demo ? ' <span class="muted">(demo)</span>' : ""}${s.paused ? ' <span class="muted">(paused)</span>' : ""}</td><td>${esc(s.phone)}</td><td>${esc(s.area)}</td>
          <td>${esc(s.categories.map((c) => getCategory(c)?.label ?? c).join(", "))}</td><td>${s.notified_count} / ${s.replied_count}</td>
          <td>${s.rating_count ? (s.rating_sum / s.rating_count).toFixed(1) + " ★" : "–"}</td><td>${pill(s.status)}</td>
          <td>${s.status !== "active" ? `<form class="inline" method="post" action="/admin/shops/${s.id}/status"><input type="hidden" name="status" value="active"><button>Make live</button></form>` : `<form class="inline" method="post" action="/admin/shops/${s.id}/status"><input type="hidden" name="status" value="pending"><button class="ghost">Take offline</button></form>`}</td></tr>`).join("")}
        </tbody></table></div>`;
      reply.type("text/html").send(layout("Shops", body));
    });

    admin.post("/admin/shops/:id/status", async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const status = (req.body as Form).status;
      if (status === "active" || status === "rejected" || status === "pending") await setShopStatus(db, deps.messenger, id, status);
      const back = (req.headers.referer ?? "").includes("/admin/shops") ? "/admin/shops" : "/admin";
      reply.redirect(back);
    });

    admin.post("/admin/shops/import", async (req, reply) => {
      const result = await importShopsCsv(db, (req.body as Form).csv ?? "");
      const msg = `Imported ${result.imported}, updated ${result.updated}.${result.errors.length ? " Problems: " + result.errors.slice(0, 10).join(" ") : ""}`;
      reply.redirect(`/admin/shops?msg=${encodeURIComponent(msg)}`);
    });

    admin.post("/admin/seed-demo", async (_req, reply) => {
      const n = await seedDemoShops(db);
      reply.redirect(`/admin/shops?msg=${encodeURIComponent(`${n} demo shops are ready. Open the simulator to test.`)}`);
    });

    admin.get("/admin/leads", async (_req, reply) => {
      const leads = await db.query<{ id: number; kind: string; name: string; phone: string; area: string; category: string; message: string; created_at: Date }>(
        `SELECT * FROM leads ORDER BY id DESC LIMIT 200`);
      const body = `<h1>Leads from zyyko.com</h1><div class="wrap"><table><thead><tr><th>Time</th><th>Type</th><th>Name</th><th>Phone</th><th>Area</th><th>Category</th><th>Message</th></tr></thead><tbody>
        ${leads.map((l) => `<tr><td>${esc(fmtTime(l.created_at))}</td><td>${esc(l.kind)}</td><td>${esc(l.name)}</td><td>${esc(l.phone)}</td><td>${esc(l.area)}</td><td>${esc(l.category)}</td><td>${esc(l.message)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">No leads yet.</td></tr>`}
        </tbody></table></div>`;
      reply.type("text/html").send(layout("Leads", body));
    });
  });
}
