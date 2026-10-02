# Zyyko setup guide (for the owner)

You set up the accounts and paste in keys. Claude writes the code. You don't need to write any code to follow this guide.

**Rules for keys and passwords:** paste them only into the Render dashboard (Step 2). Never paste them into chat, WhatsApp, email or GitHub.

You'll end up with:

| What | Where | Cost |
|---|---|---|
| Server (bot, admin, simulator, website) | Render, Starter plan | about $7/month (~₹620) |
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

## Step 2: Server (Render), 15 minutes

1. Go to **render.com** and sign up **with GitHub**. Allow access to the `cashdooin-ai/instinct-ai` repository.
2. Choose which code version to run:
   - The code is on the branch `claude/optimistic-wright-ippj8t`. The simplest route is to merge it into `main` on GitHub (Claude can open the pull request; you click **Merge**).
   - Or, in Step 4 below, change the branch to `claude/optimistic-wright-ippj8t`.
3. In Render, click **New +**, then **Blueprint**, and pick the `instinct-ai` repository. Render reads the `render.yaml` file and shows a service called **zyyko**.
4. Fill in the values it asks for:
   - `DATABASE_URL`: from Step 1.
   - `PUBLIC_BASE_URL`: leave blank for now; set it in Step 5.
   - Leave all the WhatsApp, Anthropic and Sarvam values **blank** for now.
5. Click **Apply**. The first deploy takes about 3–5 minutes.
6. When it says **Live**, open `https://zyyko.onrender.com/health` (use your service's address, shown at the top of the page). You should see `{"ok":true}`.

> Use the **Starter** plan, not Free. The Free plan goes to sleep, and the bot stops closing offer windows.

From now on, every time Claude pushes code to the branch Render watches, Render redeploys on its own.

## Step 3: Admin panel and testers

1. In Render, open **zyyko → Environment**. Copy the values of **ADMIN_TOKEN** and **TESTER_TOKEN**. Render generated them for you.
2. Open the admin panel on your phone or laptop:
   `https://YOUR-RENDER-ADDRESS/admin?token=ADMIN_TOKEN`
   After the first time, the device remembers you.
3. Go to **Shops**, then click **Add demo shops**. This creates 20 pretend shops across Tricity for testing.
4. Send your testers this link (it's their link, not the admin one):
   `https://YOUR-RENDER-ADDRESS/simulator?token=TESTER_TOKEN`
   Also send them `docs/TESTING.md`.

**Never share the ADMIN_TOKEN.** If it leaks, change it in Render → Environment and click **Save** (Render redeploys).

## Step 4: Import your real shops

When the field team has visited shops, put them in a Google Sheet with these columns:

`name, phone, categories, area, address, owner_name, lat, lng`

- `phone`: 10-digit mobile.
- `categories`: keys separated by `|`, e.g. `ac|refrigerator|washing_machine`. The full key list is shown on the Shops page.
- `area`: e.g. `Phase 7 Mohali` or `VIP Road Zirakpur`.
- `lat, lng` are optional but more accurate. In Google Maps, long-press the shop and copy the numbers.

In the sheet, use **File → Download → CSV**, open the file, copy everything, and paste it into **Admin → Shops → Import**. Imported shops go live immediately. Tell each shop owner to save the Zyyko WhatsApp number and send **Hi** once (see Step 7 for why).

## Step 5: Connect zyyko.com

1. In Render: **zyyko → Settings → Custom Domains → Add**, then `zyyko.com`. Add `www.zyyko.com` as well.
2. Render shows the DNS records to add. Log in to where you bought zyyko.com (GoDaddy, Hostinger, etc.), open **DNS settings**, and add exactly those records.
3. Wait 10 minutes to a few hours. Render shows **Verified** and adds HTTPS automatically.
4. In Render → Environment, set `PUBLIC_BASE_URL` = `https://zyyko.com` and click **Save**.

## Step 6: AI understanding (optional, recommended)

Without a key, built-in rules understand most messages (English and common Hinglish). The AI handles messier messages better.

1. Go to **console.anthropic.com** and sign up. Under **Billing**, add credit (start with $10).
2. Under **Limits**, set a monthly spend limit, e.g. $20.
3. Under **API Keys**, create a key named `zyyko-render`.
4. Paste it in Render → Environment as `ANTHROPIC_API_KEY` and click **Save**.

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
3. Copy the **Phone number ID** and put it in Render as `WHATSAPP_PHONE_NUMBER_ID`.
4. In **App settings → Basic**, click **Show** next to App secret. Put it in Render as `META_APP_SECRET`.
5. In WhatsApp Manager, add a **payment method** for message charges.

**7c. Permanent access token**
1. In **business.facebook.com → Settings → Users → System users**, click **Add**. Name it `zyyko-server` with the Admin role.
2. Click **Assign assets**: give it full control of your app and your WhatsApp account.
3. Click **Generate token**, choose your app, set it to never expire, and tick `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Put the token in Render as `WHATSAPP_TOKEN`.

**7d. Webhook (how messages reach the server)**
1. In **developers.facebook.com → your app → WhatsApp → Configuration → Webhook**, click **Edit**:
   - Callback URL: `https://zyyko.com/webhooks/whatsapp`
   - Verify token: copy `WHATSAPP_VERIFY_TOKEN` from Render → Environment and paste it here.
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
2. In Render, click **Save** so it redeploys with the WhatsApp keys.
3. From your own phone, message the Zyyko number: `AC service tomorrow VIP Road Zirakpur`. You should get a reply within seconds.
4. In `web/index.html`, set the WhatsApp number (Claude will do this; just tell Claude the number).

## Step 8: Voice notes (optional)

1. Go to **dashboard.sarvam.ai** and create an API key.
2. Put it in Render as `SARVAM_API_KEY`. Voice notes in Hindi, Punjabi and English are then turned into text.

## Step 9: Before real customers

- [ ] Real shops imported, and each has sent **Hi** to the Zyyko number.
- [ ] Set `DEMO_AUTO_QUOTE` = `false`. Demo shops never reach real buyers either way, but this stops simulator noise.
- [ ] Privacy page checked by a lawyer, with the business name and address filled in.
- [ ] Before taking any payments: have a freelance developer review the code and security (a few days' work).

## When something breaks

1. Render → zyyko → **Logs**. Copy the red lines (they never contain your keys) and paste them to Claude.
2. Admin panel → the request's page shows which shops were asked and what they replied.
3. Supabase → **Table Editor** → `events` lists everything that happened, newest at the bottom.
