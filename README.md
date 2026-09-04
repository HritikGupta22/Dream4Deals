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

Reels are matched by Instagram media ID (see `instagramMediaId` in `backend/data.js`). DMs without a shared reel use that user’s last mapped reel, then the fallback slug.

## What this MVP includes

- Reel landing page driven by `/api/reels/:slug`
- Tagged products and platform + seller comparison
- Click tracking and shopping redirect
- Creator Studio: mapping, triggers, template, event log
- Webhook handler for comments and DMs

## Later

Next.js, Express, PostgreSQL, creator login, live affiliate feeds, and Meta OAuth — listed as open items in `TASKS.md`.
