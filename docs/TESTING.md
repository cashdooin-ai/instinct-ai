# Zyyko test checklist (for testers)

Open the simulator link the owner sent you (`…/simulator?token=…`). It works like WhatsApp in your browser:
- **Act as** (top left) switches between buyers and demo shops.
- **📍 Location…** (bottom left) shares a location.
- Buttons and offer rows in bot messages can be clicked.
- **Clear chat** starts that person's chat over.

Demo shops also send offers automatically within about a minute, so you can test alone.

## How to report a bug

For each problem, send the owner:
1. **What you did**: the exact message you typed or button you clicked.
2. **What you expected.**
3. **What happened**, with a screenshot.
4. **Who you were acting as** (e.g. Buyer 2, or Sharma Electronics) and the time.

## Test cases

Tick each one. Write ❌ and a note if it fails.

### Buyer basics
- [ ] 1. As **Buyer 1**, send `hi`. You get a welcome message with examples.
- [ ] 2. Send `1.5 ton inverter AC under 40k, Sector 70 Mohali, with installation`. You see a summary with **Get offers** / **Change**. Check the item, ₹40,000, installation and the area.
- [ ] 3. Send `budget 38k`. The summary updates to ₹38,000.
- [ ] 4. Click **Get offers**. It says how many shops were asked and by what time.
- [ ] 5. Wait up to 2 minutes. You get a list of offers, cheapest first, with distance and rating.
- [ ] 6. Click an offer. You get the shop's contact and a Google Maps link.
- [ ] 7. Send `5`. You get a thank-you for rating.

### Hindi / Hinglish / Punjabi
- [ ] 8. `Bhaiya fridge chahiye double door 30 hazaar tak, Zirakpur`. Understood as a refrigerator, ₹30,000, Zirakpur.
- [ ] 9. `ac thanda nahi kar raha, kal aa jao, Phase 11 Mohali`. Understood as **AC service / repair**, tomorrow.
- [ ] 10. `ghar mein deemak hai, panchkula sector 11`. Understood as **pest control**.
- [ ] 11. Try 5 messages of your own in the way real people would type them. Note which ones were misunderstood.

### Missing details
- [ ] 12. `plumber chahiye aaj` (no area). The bot asks for your area. Share **📍 VIP Road, Zirakpur**. The summary shows Zirakpur.
- [ ] 13. Repeat, but type the area: `dhakoli`. It works.
- [ ] 14. Type a place outside Tricity: `Ludhiana`. The bot says it couldn't find the area.

### Acting as a shop
- [ ] 15. As **Buyer 2**, request `AC 1.5 ton under 40k Sector 70 Mohali` and click **Get offers**.
- [ ] 16. Switch **Act as** to **Sharma Electronics**. You see the request with **Send price** / **Not available**.
- [ ] 17. Click **Send price**, then type `Voltas 5 star 36,900 install tomorrow`. It replies "Offer sent: ₹36,900".
- [ ] 18. Switch to **Cool Point AC** and type just `35500` (without clicking the button). It's accepted as an offer.
- [ ] 19. Switch to another shop that got the request and click **Not available**. It replies "OK, noted".
- [ ] 20. Switch back to **Buyer 2**. When offers arrive, your two typed offers are there. Pick **Sharma Electronics**.
- [ ] 21. Switch to **Sharma Electronics**. It says "A customer chose your offer!" with the buyer's details. **Cool Point AC** says the customer chose another offer.
- [ ] 22. As a shop, send `STATUS`, then `PAUSE`, then `RESUME`.

### Shop sign-up
- [ ] 23. Act as **New shop (to test JOIN)**. Send `JOIN`, then answer shop name, categories (`1, 2, 13`) and area (`Phase 7 Mohali`). It says the shop is registered.
- [ ] 24. Send `hi`. It says the shop is still being verified.
- [ ] 25. Ask the owner to approve the shop in the admin panel. The new shop then gets a "now live" message.

### Edge cases
- [ ] 26. Send `CANCEL` in the middle of a request. The bot resets.
- [ ] 27. Request something no demo shop sells nearby, e.g. `chimney in Pinjore`. It says the team will call shops. After the window ends, it says no offers yet.
- [ ] 28. After requesting, send `SHOW` before the window ends. You get the offers received so far.
- [ ] 29. Click an old offer button again after already choosing. It says the offer is no longer available.
- [ ] 30. Try it on a phone browser. Is everything readable and clickable?

## What else to note
- Any message from the bot that sounds confusing or wrong.
- Anything that took too long.
- Ideas: what would make you, as a buyer or shop owner, use this every time?
