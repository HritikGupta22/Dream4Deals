# Dream4Deals

Creator-first shopping layer for Instagram fashion content:

**Instagram comment or DM → automatic website link → reel page → tagged products → price/seller comparison → Buy Now.**

## Run locally

```powershell
npm start
```

Open `http://localhost:3001/reel/dress-pink-edit`.

## Folder structure

```
frontend/          Public website (HTML, CSS, JS)
backend/           API, reel mapping, comparison data, Meta webhook
backend/.env       Meta credentials (copy from .env.example; do not commit)
```

## Instagram auto-reply (official API only)

1. Copy `backend/.env.example` to `backend/.env`.
2. Connect the Instagram professional account in a Meta app.
3. Callback URL: `https://YOUR-DOMAIN/webhooks/instagram` with the same `META_VERIFY_TOKEN`.
4. Subscribe to Instagram **comments** and **messages**.
5. Deploy on public HTTPS. Meta cannot reach `localhost`.
6. In Creator Studio, turn auto-reply on for comments and/or DMs.

### Diagnose missing Instagram replies

Run `node backend/diagnose-instagram.js dream4deal moon.litfeelss` to check account subscriptions and recent comments by that username. This reads Meta and the database without sending messages. The report is saved to `backend/storage/instagram-diagnostics.json`.

The Studio simulator checks rule matching only; it does not test Meta webhook delivery or send a DM. An account subscription containing `comments` also does not verify the app-level callback configuration or app access for public users. When a real comment appears in the API but there is no corresponding incoming request in the tunnel inspector or backend log, check the app's publishing status, Instagram webhook callback/field settings, and permission access in Meta Developers. Use Meta's `comments` webhook test to check its configured route.

### Recovery when comment webhooks are missing

Run `node backend/preview-comment-recovery.js` for a read-only recovery scan. It logs eligible missed comments in `backend/storage/backend.log`, sends no messages, and does not claim events.

The backend also supports `INSTAGRAM_COMMENT_RECOVERY_MODE=preview` for a scan every 60 seconds after restart. Recovery defaults to `off`; `live` explicitly enables dispatch through the normal private-comment-reply handler. Do not enable live mode while diagnosis is restricted to read-only checks.

Recovery checks mapped posts with enabled comment rules. It considers visible matching comments between 1 minute and 1 hour old, excludes the creator's comments and already claimed events, and does not require a follower relationship. Each scan reads at most three pages of 50 comments per post and logs when that limit is reached. Live recovery shares event IDs with webhooks to avoid duplicate sends. Meta can still reject a private reply; this addresses missing webhook events, not Meta permission or recipient restrictions. Existing failed event claims are not retried by this mechanism.

Reels are matched by Instagram media ID (see `instagramMediaId` in `backend/data.js`). DMs without a shared reel use that user’s last mapped reel, then the fallback slug.

## What this MVP includes

- Reel landing page driven by `/api/reels/:slug`
- Tagged products and platform + seller comparison
- Click tracking and shopping redirect
- Creator Studio: mapping, triggers, template, event log
- Webhook handler for comments and DMs

## Store prices and sizes

Product pages request `/api/reels/:slug/prices` in the background. Saved positive prices are reused without a retailer request. Each unique lookup URL has a maximum lifetime budget of two outgoing HTTP requests, including redirects. Lookup stops when a price is found or the store blocks access; missing metadata can use the remaining request. Concurrent visitors share the same lookup. Successes and failures are saved in `backend/storage/retailer-lookups.json`, with the budget reserved before each request, so subsequent visits and backend restarts do not keep retrying. Flipkart product lookups omit campaign parameters while retaining product (`pid`) and seller (`lid`) identifiers. The original affiliate URL is retained for shopper clicks.

This is a saved price snapshot, not continuous live pricing. There is no automatic expiry, polling, or retry after a completed lookup. Long short-link redirect chains can exhaust the budget before reaching a product page. The local lookup ledger is intended for one backend process with persistent storage; multiple server instances need a shared database and atomic request-budget reservations before deployment.

Prices come from public INR product metadata. Sizes are read from structured product metadata and Flipkart's size links; listed sizes do not guarantee stock. Delivery information is not fetched or displayed in the comparison UI.

Some stores, including Meesho in our verification, return a verification page instead of product data. The app reports this without inventing a price. Reliable coverage for these stores needs an authorized retailer/affiliate data feed; an affiliate tracking link alone does not grant API access.

`fktr.in` links that redirect through `linkredirect.in/visitretailer/...` are resolved using their embedded Flipkart deep link without requesting the intermediary. Flipkart can still block the deep-link endpoint; use a full Flipkart affiliate product URL when available.

Meesho invite links that redirect through `meesho.onelink.me` use the embedded `af_web_dp` product URL without contacting the intermediary. The destination must remain an allowed HTTPS Meesho URL. Full product URLs can also return verification pages or HTTP 403/429, so normalization alone does not guarantee a live price.

## Studio images and automation

Product image fields accept an HTTP/HTTPS URL or a local file through Browse. Authenticated uploads use `POST /api/product-images` (10 MB limit). JPG, PNG, GIF and WebP are stored directly; other browser-readable image formats are converted to PNG in the browser. Formats the browser cannot decode must first be exported as JPG or PNG.

Files are stored in `backend/uploads` under generated filenames and served through `/api/product-images/:filename`, including through the frontend's API proxy. The product database stores the public image URL, not the file contents. Keep this directory on persistent storage and back it up. Production with multiple backend instances needs shared storage or object storage. Use a stable public hostname: URLs saved under a temporary tunnel hostname need updating if that hostname changes. Replaced or abandoned uploads are not automatically deleted.

Per-reel automation supports adding/removing trigger words or phrases (comma-separated input), and editing the reply template. Both `{name}` and `{url}` are required by the UI and API, including when saving disabled automation. Saved rules reload when continuing from products to automation. Save changes before testing; tests use the persisted rule.

## Later

Next.js, Express, PostgreSQL, creator login, live affiliate feeds, and Meta OAuth — listed as open items in `TASKS.md`.
