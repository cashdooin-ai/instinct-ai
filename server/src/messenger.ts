// Outbound messages. Phones starting with "sim-" go to the web simulator; everything else
// goes to the WhatsApp Cloud API. Both see the same message shapes, so the bot code
// doesn't care which one it's talking to.
import type { Config } from "./config.js";
import type { Db } from "./db.js";

export interface Button { id: string; title: string }
export interface ListRow { id: string; title: string; description?: string }

export type OutMessage =
  | { type: "text"; text: string }
  | { type: "buttons"; text: string; buttons: Button[] }
  | { type: "list"; text: string; button: string; rows: ListRow[] }
  | { type: "location_request"; text: string }
  | {
      type: "template";
      name: string;
      bodyParams: string[];
      buttonPayloads: string[];
      /** What the simulator shows, and what the template's approved text says. */
      previewText: string;
      previewButtons: Button[];
    };

export interface Messenger {
  send(to: string, msg: OutMessage): Promise<void>;
}

export const isSimPhone = (phone: string) => phone.startsWith("sim-");

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Converts our message shape to the WhatsApp Cloud API body. Exported for tests. */
export function toWhatsAppBody(to: string, msg: OutMessage, templateLanguage: string): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (msg.type) {
    case "text":
      return { ...base, type: "text", text: { body: clip(msg.text, 4096), preview_url: false } };
    case "buttons":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: clip(msg.text, 1024) },
          action: {
            buttons: msg.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: clip(b.id, 256), title: clip(b.title, 20) } })),
          },
        },
      };
    case "list":
      return {
        ...base,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: clip(msg.text, 4096) },
          action: {
            button: clip(msg.button, 20),
            sections: [{
              title: "Options",
              rows: msg.rows.slice(0, 10).map((r) => ({
                id: clip(r.id, 200),
                title: clip(r.title, 24),
                ...(r.description ? { description: clip(r.description, 72) } : {}),
              })),
            }],
          },
        },
      };
    case "location_request":
      return {
        ...base,
        type: "interactive",
        interactive: { type: "location_request_message", body: { text: clip(msg.text, 1024) }, action: { name: "send_location" } },
      };
    case "template":
      return {
        ...base,
        type: "template",
        template: {
          name: msg.name,
          language: { code: templateLanguage },
          components: [
            { type: "body", parameters: msg.bodyParams.map((text) => ({ type: "text", text: clip(text, 900) })) },
            ...msg.buttonPayloads.map((payload, i) => ({
              type: "button", sub_type: "quick_reply", index: String(i), parameters: [{ type: "payload", payload }],
            })),
          ],
        },
      };
  }
}

export class RoutingMessenger implements Messenger {
  constructor(private db: Db, private config: Config, private fetchImpl: typeof fetch = fetch) {}

  async send(to: string, msg: OutMessage): Promise<void> {
    if (isSimPhone(to)) {
      await this.db.query(`INSERT INTO sim_messages (phone, direction, payload) VALUES ($1, 'out', $2)`, [to, JSON.stringify(msg)]);
      return;
    }
    const { token, phoneNumberId, graphVersion, templateLanguage } = this.config.whatsapp;
    if (!token || !phoneNumberId) {
      console.warn(`[whatsapp] not configured; dropping message to ${to.slice(0, 4)}…`);
      return;
    }
    const res = await this.fetchImpl(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(toWhatsAppBody(to, msg, templateLanguage)),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[whatsapp] send failed ${res.status}: ${body.slice(0, 500)}`);
      await this.db.query(`INSERT INTO events (kind, phone, detail) VALUES ('send_failed', $1, $2)`, [to, JSON.stringify({ status: res.status, body: body.slice(0, 500), type: msg.type })]);
    }
  }
}
