// Small HTML helpers for the admin panel. Server-rendered, no build step.

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function maskPhone(phone: string): string {
  if (phone.startsWith("sim-")) return phone;
  return phone.length > 6 ? `${phone.slice(0, 4)}••••${phone.slice(-3)}` : phone;
}

export function fmtTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
}

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Zyyko admin</title>
<style>
:root{--bg:#F5F6FA;--card:#fff;--ink:#151A2C;--muted:#596079;--line:#D8DCE8;--accent:#2340A0;--chili:#C2410C;--good:#1E7A3E;--warn:#9A6400;--bad:#B3261E}
@media (prefers-color-scheme:dark){:root{--bg:#0E1120;--card:#161A2E;--ink:#E5E8F3;--muted:#9BA2BC;--line:#2A3050;--accent:#8EA6FF;--chili:#FF8A50;--good:#6BCB8B;--warn:#F0B53A;--bad:#F2867E;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card)}
header b{font-size:16px}header a{color:var(--muted);text-decoration:none}header a:hover{color:var(--accent)}
main{max-width:1200px;margin:0 auto;padding:20px}
h1{font-size:20px;margin:0 0 16px}h2{font-size:16px;margin:28px 0 10px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}.tile b{display:block;font-size:22px}.tile span{color:var(--muted);font-size:12px}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}tr:last-child td{border-bottom:0}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid currentColor}
.s-collecting{color:var(--warn)}.s-offers_sent{color:var(--accent)}.s-selected,.s-active,.s-quoted{color:var(--good)}.s-no_offers,.s-rejected,.s-expired,.s-passed{color:var(--bad)}.s-pending,.s-notified{color:var(--muted)}
.ops{color:var(--chili);font-weight:600}
form.inline{display:inline}button,.btn{font:inherit;padding:5px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--bg);cursor:pointer;text-decoration:none;display:inline-block}
button.ghost{background:transparent;color:var(--accent)}
input,select,textarea{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)}
textarea{width:100%;min-height:140px;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px}
.muted{color:var(--muted)}a{color:var(--accent)}
.flash{background:var(--card);border-left:4px solid var(--good);padding:10px 14px;margin-bottom:16px;border-radius:6px}
</style></head><body>
<header><b>Zyyko admin</b><a href="/admin">Dashboard</a><a href="/admin/shops">Shops</a><a href="/admin/leads">Leads</a><a href="/simulator">Simulator</a></header>
<main>${body}</main></body></html>`;
}

export const pill = (status: string) => `<span class="pill s-${esc(status)}">${esc(status.replace(/_/g, " "))}</span>`;
