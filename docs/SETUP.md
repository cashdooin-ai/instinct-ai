# Zyyko setup guide (for the owner)

You set up the accounts and paste in keys. Claude writes the code. You don't need to write any code to follow this guide.

**Rules for keys and passwords:** paste them only into the Railway dashboard (Step 2). Never paste them into chat, WhatsApp, email or GitHub.

You'll end up with:

| What | Where | Cost |
|---|---|---|
| Server (bot, admin, simulator, website) | Railway, Hobby plan | about $5–8/month (~₹450–700) |
| Database | Supabase, Free plan, Mumbai region | ₹0 to start |
| Domain zyyko.com | your registrar | you already have it |
| WhatsApp messages | Meta, pay per message | about ₹0.115 per message to shops |
| AI (optional) | Anthropic | pay per use, set a monthly limit |
| Voice notes (optional) | Sarvam AI | about ₹30 per hour of audio |

---

## Step 1: Database (Supabase), 10 minutes

1. Go to **supabase.com**, then **Start your project**, and sign in with GitHub.
2. Click **New project**:
   - Name: `zyyko`
   - Database password: click **Generate**, then **copy it and save it** in your password manager.
   - Region: **South Asia (Mumbai)**
   - Plan: Free
3. When the project is ready, click **Connect** at the top.
4. Choose **Session pooler**, then copy the **URI**. It looks like:
   `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`
5. Replace `[YOUR-PASSWORD]` with the password from step 2. This full line is your **DATABASE_URL**. Keep it for Step 2.

The app creates its own tables the first time it starts. Later, you can see all requests, shops and offers in Supabase under **Table Editor**.

## Step 2: Server (Railway), 15 minutes

**Why Railway:** Zyyko needs a server that is always on. It answers WhatsApp at any hour and checks every 10 seconds for offer windows that have closed. Railway runs it like that and redeploys when new code is pushed.

- **Vercel isn't suitable:** it pauses between requests, so offer windows would never close.
- **The Hostinger cloud server would work,** but you'd have to maintain it yourself: updates, security, restarts and SSL certificates. Keep it for later or for other uses.

**2a. Make three secret tokens.** Use your password manager's generator: 40 characters, letters and numbers only. Save all three in the password manager.
- `ADMIN_TOKEN`: opens the admin panel. Only you have this.
- `TESTER_TOKEN`: opens the simulator. You share this with testers.
- `WHATSAPP_VERIFY_TOKEN`: you'll paste this into Meta later.

**2b. Create the service**
1. Go to **railway.com** and log in with GitHub. Choose the **Hobby** plan (needed so it stays always on).
2. Click **New Project → Deploy from GitHub repo**, then pick `cashdooin-ai/instinct-ai`.
3. Open the new service, then **Settings**:
   - **Source → Branch:** `main` if Claude's pull request has been merged, otherwise `claude/optimistic-wright-ippj8t`.
   - **Root Directory:** leave **empty**. The repo's `railway.json` tells Railway how to build.
   - **Region:** **Southeast Asia (Singapore)**, the closest to India and to your Supabase database in Mumbai.
4. Open **Variables → Raw Editor** and paste this, replacing the values:
   ```
   DATABASE_URL=your Supabase link from Step 1
   ADMIN_TOKEN=your admin token
   TESTER_TOKEN=your tester token
   WHATSAPP_VERIFY_TOKEN=your verify token
   NODE_VERSION=22
   OFFER_WINDOW_MINUTES=15
   DEMO_AUTO_QUOTE=true
   ```
   Leave the WhatsApp, Anthropic and Sarvam keys out for now. Click **Update Variables**.
5. Go to **Settings → Networking → Generate Domain**. You get an address like `zyyko-production.up.railway.app`.
6. Railway deploys on its own (3–5 minutes). Open `https://YOUR-RAILWAY-ADDRESS/health`. You should see `{"ok":true}`.

From now on, every time Claude pushes code to that branch, Railway redeploys on its own.

> Prefer Render? `render.yaml` is also in the repo: Render → New → Blueprint, Starter plan, same variables.

## Step 3: Admin panel and testers

1. Open the admin panel on your phone or laptop:
   `https://YOUR-RAILWAY-ADDRESS/admin?token=ADMIN_TOKEN`
   After the first time, the device remembers you.
2. Go to **Shops**, then click **Add demo shops**. This creates 20 pretend shops across Tricity for testing.
3. Send your testers this link (it's their link, not the admin one):
   `https://YOUR-RAILWAY-ADDRESS/simulator?token=TESTER_TOKEN`
   Also send them `docs/TESTING.md`.

**Never share the ADMIN_TOKEN.** If it leaks, change it in Railway → Variables (Railway redeploys).

## Step 4: Import your real shops

When the field team has visited shops, put them in a Google Sheet with these columns:

`name, phone, categories, area, address, owner_name, lat, lng`

- `phone`: 10-digit mobile.
- `categories`: keys separated by `|`, e.g. `ac|refrigerator|washing_machine`. The full key list is shown on the Shops page.
- `area`: e.g. `Phase 7 Mohali` or `VIP Road Zirakpur`.
- `lat, lng` are optional but more accurate. In Google Maps, long-press the shop and copy the numbers.

In the sheet, use **File → Download → CSV**, open the file, copy everything, and paste it into **Admin → Shops → Import**. Imported shops go live immediately. Tell each shop owner to save the Zyyko WhatsApp number and send **Hi** once (see Step 7 for why).

## Step 5: Connect zyyko.com

1. In Railway: **Settings → Networking → Custom Domain**. Add `www.zyyko.com`, then add `zyyko.com`.
2. Railway shows a **CNAME** record for each. Log in to where zyyko.com's DNS is managed (e.g. Hostinger → Domains → DNS), and add the records exactly as shown.
   - Many registrars can't put a CNAME on the bare `zyyko.com`. If yours refuses, either use the registrar's **redirect** feature to send `zyyko.com` → `https://www.zyyko.com`, or move DNS to **Cloudflare** (free), which supports it.
3. Wait 10 minutes to a few hours. Railway shows the domain as active and adds HTTPS automatically.
4. In Railway → Variables, add `PUBLIC_BASE_URL=https://www.zyyko.com` (or `https://zyyko.com`).

## Step 6: AI understanding (optional, recommended)

Without a key, built-in rules understand most messages (English and common Hinglish). The AI handles messier messages better.

1. Go to **console.anthropic.com** and sign up. Under **Billing**, add credit (start with $10).
2. Under **Limits**, set a monthly spend limit, e.g. $20.
3. Under **API Keys**, create a key named `zyyko-server`.
4. Add it in Railway → Variables as `ANTHROPIC_API_KEY`.

`ANTHROPIC_MODEL` is set to `claude-opus-5-5`, the most capable option. To cut AI cost by about 4×, change it to `claude-haiku-4-5`. It's slightly less accurate on messy messages.

## Step 7: WhatsApp (when your business documents are ready)

This takes the longest, mostly waiting for Meta's approval. You need:
- business registration documents (GST certificate, Udyam or company papers),
- a **new SIM number that is not on WhatsApp** (not your personal number),
- the privacy page live at `https://zyyko.com/privacy` (it is once Step 5 is done; get the text checked by a lawyer).

**7a. Meta Business**
1. Go to **business.facebook.com**, create a business portfolio called "Zyyko" with your legal business name.
2. Go to **Settings → Business info**, then **Security Center → Start verification**, and upload your documents. Approval takes about 2–10 days.

**7b. App and number**
1. Go to **developers.facebook.com → My Apps → Create app**. Choose **Business**, connect your Zyyko business portfolio, and add the **WhatsApp** product.
2. In **WhatsApp → API Setup**, click **Add phone number**. Enter the new SIM number, display name **Zyyko**, and category **Shopping & Retail**, then verify it with the SMS code.
3. Copy the **Phone number ID** and put it in Railway → Variables as `WHATSAPP_PHONE_NUMBER_ID`.
4. In **App settings → Basic**, click **Show** next to App secret. Put it in Railway → Variables as `META_APP_SECRET`.
5. In WhatsApp Manager, add a **payment method** for message charges.

**7c. Permanent access token**
1. In **business.facebook.com → Settings → Users → System users**, click **Add**. Name it `zyyko-server` with the Admin role.
2. Click **Assign assets**: give it full control of your app and your WhatsApp account.
3. Click **Generate token**, choose your app, set it to never expire, and tick `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Put the token in Railway → Variables as `WHATSAPP_TOKEN`.

**7d. Webhook (how messages reach the server)**
1. In **developers.facebook.com → your app → WhatsApp → Configuration → Webhook**, click **Edit**:
   - Callback URL: `https://zyyko.com/webhooks/whatsapp`
   - Verify token: copy `WHATSAPP_VERIFY_TOKEN` from Railway → Variables and paste it here.
2. Click **Verify and save**, then subscribe to the **messages** field.

**7e. Message template for shops**

WhatsApp only lets a business message someone first using a pre-approved template. Shops who haven't messaged Zyyko in the last 24 hours get new requests through this template.

In WhatsApp Manager, go to **Message templates → Create template**:
- Category: **Utility**
- Name: `zyyko_new_request`
- Language: **English**
- Body:
  ```
  New customer request near you on Zyyko: {{1}}
  Area: {{2}}
  Budget: {{3}}
  Needed: {{4}}
  Tap a button below to reply.
  ```
  Meta asks for sample values: `Air conditioner`, `Sector 70, Mohali (1.2 km)`, `₹40,000`, `tomorrow`.
- Buttons: **Quick reply** `Send price`, then **Quick reply** `Not available`.

Submit it. Approval usually takes minutes to a day.

**7f. Go live**
1. In the app dashboard, switch the app to **Live** and add the privacy URL `https://zyyko.com/privacy`.
2. Add the WhatsApp keys in Railway → Variables; Railway redeploys with them.
3. From your own phone, message the Zyyko number: `AC service tomorrow VIP Road Zirakpur`. You should get a reply within seconds.
4. In `web/index.html`, set the WhatsApp number (Claude will do this; just tell Claude the number).

## Step 8: Voice notes (optional)

1. Go to **dashboard.sarvam.ai** and create an API key.
2. Put it in Railway → Variables as `SARVAM_API_KEY`. Voice notes in Hindi, Punjabi and English are then turned into text.

## Step 9: Before real customers

- [ ] Real shops imported, and each has sent **Hi** to the Zyyko number.
- [ ] Set `DEMO_AUTO_QUOTE` = `false`. Demo shops never reach real buyers either way, but this stops simulator noise.
- [ ] Privacy page checked by a lawyer, with the business name and address filled in.
- [ ] Before taking any payments: have a freelance developer review the code and security (a few days' work).

## When something breaks

1. Railway → your service → **Deployments → View logs**. Copy the red lines (they never contain your keys) and paste them to Claude.
2. Admin panel → the request's page shows which shops were asked and what they replied.
3. Supabase → **Table Editor** → `events` lists everything that happened, newest at the bottom.
