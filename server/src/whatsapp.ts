// Inbound side of WhatsApp: verifies Meta's signature and turns webhook payloads into
// simple events the bot understands. The simulator produces the same events.
import { createHmac, timingSafeEqual } from "node:crypto";

interface Base { phone: string; name: string; messageId?: string }

export type Inbound =
  | (Base & { kind: "text"; text: string })
  | (Base & { kind: "button"; id: string; title: string })
  | (Base & { kind: "location"; lat: number; lng: number; label: string })
  | (Base & { kind: "audio"; mediaId: string; mimeType: string })
  | (Base & { kind: "unsupported"; type: string });

export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!appSecret) return false;
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = header.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseWebhook(body: any): Inbound[] {
  const out: Inbound[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) names.set(String(c.wa_id), String(c.profile?.name ?? ""));
      for (const m of value.messages ?? []) {
        const phone = String(m.from ?? "");
        if (!phone) continue;
        const name = names.get(phone) ?? "";
        const messageId = m.id ? String(m.id) : undefined;
        switch (m.type) {
          case "text":
            out.push({ kind: "text", phone, name, messageId, text: String(m.text?.body ?? "") });
            break;
          case "interactive": {
            const r = m.interactive?.button_reply ?? m.interactive?.list_reply;
            if (r) out.push({ kind: "button", phone, name, messageId, id: String(r.id), title: String(r.title ?? "") });
            else out.push({ kind: "unsupported", phone, name, messageId, type: "interactive" });
            break;
          }
          case "button": // quick-reply button on a template message
            out.push({ kind: "button", phone, name, messageId, id: String(m.button?.payload ?? ""), title: String(m.button?.text ?? "") });
            break;
          case "location":
            out.push({
              kind: "location", phone, name, messageId,
              lat: Number(m.location?.latitude), lng: Number(m.location?.longitude),
              label: String(m.location?.name ?? m.location?.address ?? ""),
            });
            break;
          case "audio":
            out.push({ kind: "audio", phone, name, messageId, mediaId: String(m.audio?.id ?? ""), mimeType: String(m.audio?.mime_type ?? "audio/ogg") });
            break;
          default:
            out.push({ kind: "unsupported", phone, name, messageId, type: String(m.type) });
        }
      }
    }
  }
  return out;
}

/** Downloads a WhatsApp media file (e.g. a voice note) using the Cloud API. */
export async function downloadMedia(mediaId: string, token: string, graphVersion: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const meta = await fetchImpl(`https://graph.facebook.com/${graphVersion}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!meta.ok) throw new Error(`media lookup failed: ${meta.status}`);
  const { url } = (await meta.json()) as { url: string };
  const file = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!file.ok) throw new Error(`media download failed: ${file.status}`);
  return Buffer.from(await file.arrayBuffer());
}
