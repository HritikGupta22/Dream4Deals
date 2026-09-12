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

## Later

Next.js, Express, PostgreSQL, creator login, live affiliate feeds, and Meta OAuth — listed as open items in `TASKS.md`.
