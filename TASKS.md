# Dream4Deals — Project Delivery Tracker

> **Source of truth.** Check a task only after its code is implemented and its acceptance check passes.

---

## Product Vision

**Dream4Deals** is a creator-first shopping layer built on top of Instagram fashion content.

```
Instagram Reel posted by creator
        ↓
Viewer comments or DMs a trigger word (e.g. "LINK")
        ↓
Dream4Deals auto-replies with a unique reel page URL
        ↓
Visitor lands on the reel page
        ↓
Sees all tagged products from that reel
        ↓
Compares prices across platforms (Amazon, Flipkart, Myntra, Meesho, etc.)
        ↓
Sees multiple sellers per platform with ratings, delivery, and price
        ↓
Lowest price is highlighted automatically
        ↓
Clicks "Buy Now" → tracked affiliate redirect → retailer product page
```

**Who it serves:**
- **Creators** — monetise their fashion reels without managing a store
- **Shoppers** — find the best price for products they see in reels
- **Retailers/Affiliates** — reach high-intent buyers at the moment of discovery

---

## Current Architecture

```
Dream4Deals/
  frontend/                  Next.js 15 app (App Router, TypeScript, Tailwind CSS)
    app/
      layout.tsx             Root layout — header, footer, fonts
      page.tsx               Redirects / → /reel/anaya-pink-edit
      reel/[slug]/
        page.tsx             Server component — fetches reel data, sets metadata
        ReelClient.tsx       Client component — product grid, comparison panel
      studio/
        page.tsx             Creator Studio — auth, reel mapping, product tagging, automation
    lib/
      api.ts                 Fetch helpers + INR formatter
      types.ts               Shared TypeScript interfaces
    next.config.ts           Rewrites /api/* → Express backend on :3000
  backend/                   Node.js + Express API, local JSON store, Meta webhook handler
    server.js                API routes: reels, offers, redirect, auth, automation, webhooks
    data.js                  Demo reel + product seed data
    instagram.js             Meta Graph API adapters
    store.js                 Local JSON read/write helpers
    local-store.json         Dev-only storage (replaced by PostgreSQL in Phase 2)
  package.json               Root scripts — runs backend + Next.js together via concurrently
  TASKS.md                   This file
```

**Run locally:**
```bash
npm install          # install concurrently at root
npm run dev          # starts backend on :3000 + Next.js on :3001 with hot reload
```
Open `http://localhost:3001/reel/anaya-pink-edit`

**Local dev storage:** `backend/local-store.json` — suitable for development only.

---

## Phase 0 — Project Foundation

**Goal:** any developer can clone, configure, and run the project locally.

- [x] Confirm product name: **Dream4Deals**
- [x] Separate `frontend/` and `backend/` folders
- [x] Add `npm start` and `npm run dev` scripts in `package.json`
- [x] Add `.gitignore` for `.env`, `node_modules`, and dev data files
- [ ] Complete `.env.example` with every required variable and inline comments
- [ ] Add ESLint + Prettier config and `npm run lint` script
- [ ] Add unit and API test runner (`jest` or `vitest`) with `npm test` script
- [ ] Add GitHub Actions CI: lint → test → build on every pull request
- [ ] Add `LICENSE` file (MIT or chosen licence)
- [ ] Add `CONTRIBUTING.md` with branch, commit, and PR conventions

**Acceptance:** clone → `cp backend/.env.example backend/.env` → `npm start` → reel page loads at `localhost:3000`.

---

## Phase 1 — Creator Reel Website MVP

**Goal:** a working public reel page and a Creator Studio for managing content locally.

### Frontend — Next.js

- [x] Migrate frontend from static HTML/JS to Next.js 15 (App Router, TypeScript, Tailwind CSS)
- [x] Server component reel page `/reel/[slug]` — SSR fetch + dynamic metadata
- [x] Client component for product grid and comparison panel interactions
- [x] Creator Studio at `/studio` — full client component
- [x] API proxy via `next.config.ts` rewrites (`/api/*` → Express on `:3000`)
- [x] Shared `lib/api.ts` fetch helpers and `lib/types.ts` TypeScript interfaces
- [x] Root `package.json` runs backend + Next.js together via `concurrently`
- [ ] Edit product form — update name, image, category, price for an existing product
- [ ] Reel poster/video upload — store file locally; display on reel page
- [ ] Manual QA pass: reel page, comparison table, and Creator Studio on mobile and desktop

### Public Reel Page

- [x] Serve unique public route `/reel/[slug]`
- [x] Display creator identity (name, handle, followers)
- [x] Display reel title, caption, and poster/video slot
- [x] Display all products tagged to the reel
- [x] Display platform comparison panel per product (Amazon, Flipkart, Myntra, Meesho, etc.)
- [x] Display multiple sellers per platform with price, delivery, and seller rating
- [x] Highlight the lowest valid price automatically
- [x] "Buy Now" button sends visitor through tracked redirect endpoint `/api/redirect`
- [x] Record click events locally (product, platform, seller, reel, timestamp)

### Creator Authentication

- [x] Creator registration API — salted bcrypt password hash, session token response
- [x] Creator login API — verify password, return session token
- [x] Auth middleware — require valid session token on all creator-only endpoints

### Creator Studio UI (`/studio`)

- [x] Register / Sign In tabs with validation messages
- [x] Profile edit form (display name, Instagram handle, bio)
- [x] Reel mapping form — enter Instagram media ID, title, and URL slug
- [x] Reel mapping list with delete controls
- [x] Product tagging form — add product (name, image URL, category, reference price)
- [x] Delete reel mapping
- [x] Error states on every form

**Acceptance:** creator signs in → maps a reel → tags products → visitor opens reel URL → compares prices → follows Buy Now redirect. Core flow verified locally 2026-09-04.

---

## Phase 2 — Persistent Data and Real Commerce

**Goal:** replace the local JSON file with a real database and connect real affiliate product data.

### Database — PostgreSQL

- [ ] Provision PostgreSQL for development, staging, and production
- [ ] Write migrations: `creators`, `sessions`, `reels`, `products`, `offers`, `seller_offers`, `click_events`, `automation_rules`, `webhook_logs`
- [ ] Migrate all `backend/local-store.json` data into PostgreSQL
- [ ] Replace `backend/data.js` demo data with live database queries
- [ ] Add seed script for local development data
- [ ] Add pagination and filtering to list endpoints
- [ ] Add input validation and consistent API error responses
- [ ] Document backup and restore procedure

### Affiliate Offers and Product Data

- [ ] Join affiliate/partner programs for each target retailer (Amazon Associates, Flipkart Affiliate, Myntra, Meesho, etc.)
- [ ] Store affiliate links per offer — never hard-code demo URLs in production
- [ ] Import product catalog/feed data from each approved affiliate source
- [ ] Normalise product records across platforms (name, image, category, brand)
- [ ] Store per-offer fields: price, delivery cost, delivery estimate, availability, seller name, seller rating, affiliate URL, fetched timestamp
- [ ] Implement lowest-price logic: total cost = price + delivery, exclude out-of-stock
- [ ] Show "last updated" timestamp and "unavailable" state in the UI
- [ ] Add scheduled jobs to refresh offer prices and alert on fetch failures
- [ ] Track click attribution: reel, product, offer, platform, seller, creator, timestamp
- [ ] Import affiliate conversion/commission data where the network API allows

**Acceptance:** every displayed offer has an approved affiliate source, a recent timestamp, and a working tracked redirect.

---

## Phase 3 — Instagram / Meta Automation (Official API Only)

**Goal:** a comment or DM with a trigger word on a mapped reel automatically receives the Dream4Deals reel URL.

### Already Built (local/dev)

- [x] Instagram media ID → Dream4Deals slug mapping
- [x] Automation ON/OFF toggle per creator
- [x] Separate comment-reply and DM-reply toggles
- [x] Configurable trigger words (e.g. "LINK", "SHOP", "BUY")
- [x] Reply template with `{{url}}` and `{{creator}}` placeholders
- [x] `GET /webhooks/instagram` — Meta webhook verification (hub challenge)
- [x] `POST /webhooks/instagram` — receive and parse comment and DM events
- [x] `X-Hub-Signature-256` validation when `META_APP_SECRET` is set
- [x] Parse comment and DM event payloads into internal job objects
- [x] Meta Graph API adapters: private reply to comment, send DM
- [x] Log automation events and errors locally

### Still Required for Live Use

- [ ] Create and configure a Meta Developer app under the business account
- [ ] Confirm `@dream4deals` is an eligible Instagram Professional account; link in Meta Business Manager
- [ ] Implement OAuth flow for creator account connection; remove manual long-lived token entry
- [ ] Encrypt stored Meta access tokens at rest; implement token refresh and revocation
- [ ] Configure a public HTTPS callback URL and set `META_VERIFY_TOKEN`
- [ ] Subscribe only to the webhook fields required: `comments`, `messages`
- [ ] Submit app for Meta permission review (`instagram_manage_comments`, `instagram_manage_messages`)
- [ ] Complete Meta data-use policy and privacy policy checks
- [ ] Test trigger-word match and non-match for comments in Meta's test environment
- [ ] Test trigger-word match and non-match for DMs in Meta's test environment
- [ ] Confirm Meta's 7-day private-reply window and 24-hour DM window rules before enabling live sending
- [ ] Move webhook event processing to an async queue (e.g. BullMQ + Redis) with retry on failure
- [ ] Add idempotency check using Meta event/message IDs to prevent duplicate replies
- [ ] Support per-reel automation rules and safe fallback when no reel is mapped
- [ ] Add webhook delivery monitoring, dead-letter queue, error alerts, and audit log UI

> **Policy reminder:** never use Instagram passwords, browser automation, scraping, or unofficial third-party bots. All automation depends on Meta API permissions, account eligibility, and app review approval.

**Acceptance:** Meta verifies the public webhook endpoint; a real test comment/DM with a trigger word receives exactly one correct reel URL reply.

---

## Phase 4 — Creator Dashboard and Analytics

**Goal:** creators can manage all their content and understand performance from a single dashboard.

### Account Management

- [ ] Password reset flow (email link → new password)
- [ ] Email verification on registration
- [ ] Secure logout and session expiry
- [ ] Multi-creator support with role model (owner, editor)

### Dashboard Overview

- [ ] Summary cards: total reels, total clicks, top product, estimated revenue, automation status
- [ ] Recent activity feed: latest clicks, automation events, errors

### Content Management

- [ ] Full reel CRUD: create, edit (title, caption, poster, slug), delete
- [ ] Full product CRUD: create, edit (name, image, category, price), delete, reorder
- [ ] Offer management: add/edit/remove platform offers per product
- [ ] Image upload and management for product images and reel posters

### Automation Rule Editor

- [ ] Per-reel trigger words, reply template, and ON/OFF toggle
- [ ] Preview reply before enabling
- [ ] Event log per reel: sent, failed, skipped, duplicate

### Analytics

- [ ] Click analytics by reel, product, platform, seller, and date range
- [ ] Conversion and commission data (where affiliate network provides it)
- [ ] Top-performing reels and products ranked by clicks and revenue
- [ ] Export analytics as CSV

### Notifications

- [ ] In-app notification preferences (price drops, automation errors, new clicks)
- [ ] Price-drop alerts for tagged products
- [ ] Subscriber opt-in/out for price alerts

**Acceptance:** a creator can manage all content, review automation health, and understand which reels and products drive the most revenue.

---

## Phase 5 — Security, Legal, Reliability, and Launch

**Goal:** production-ready, compliant, and recoverable.

### Security

- [ ] Replace dev session tokens with secure HTTP-only cookies or a proven session library
- [ ] Add rate limiting on auth and webhook endpoints
- [ ] Add account lockout after repeated failed login attempts
- [ ] Add CSRF protection on all state-changing endpoints
- [ ] Add security headers (CSP, HSTS, X-Frame-Options, etc.)
- [ ] Encrypt all secrets and tokens at rest; never log raw tokens or personal messages
- [ ] Validate and sanitise all API inputs server-side
- [ ] Restrict CORS to the deployed frontend domain only
- [ ] Restrict redirect destinations to a verified allowlist of affiliate domains

### Legal and Compliance

- [ ] Privacy policy covering data collected, retention, and deletion
- [ ] Terms of service
- [ ] Affiliate/sponsorship disclosure on reel pages
- [ ] Cookie notice and consent banner where required by law
- [ ] Data retention and deletion policy for webhook logs and visitor messages
- [ ] Consent handling for price-alert subscribers

### Reliability and Observability

- [ ] Structured application logs (JSON, log levels)
- [ ] Error reporting service (e.g. Sentry)
- [ ] Uptime monitoring with alerting
- [ ] Database automated backups with tested restore procedure
- [ ] Load and performance test: reel pages under traffic, webhook burst handling

### Deployment

- [ ] Deploy frontend (static CDN or Vercel/Netlify)
- [ ] Deploy backend (Node.js on Railway, Render, or EC2)
- [ ] Deploy PostgreSQL (managed RDS or Railway)
- [ ] Configure DNS, `PUBLIC_BASE_URL`, and HTTPS certificates
- [ ] Separate environment configs: development, staging, production
- [ ] Document rollback procedure for failed deployments

### Quality Assurance

- [ ] Accessibility audit: keyboard navigation, colour contrast, ARIA labels, mobile
- [ ] SEO audit: page titles, meta descriptions, Open Graph images, canonical URLs, sitemap, robots.txt, structured data (Product schema)
- [ ] Final Meta policy and compliance review
- [ ] Controlled beta launch with a small group of creators

**Acceptance:** production is HTTPS-only, monitored, backed up, compliant with applicable law and Meta policy, and can recover from a failed deployment without data loss.

---

## Progress Summary

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Project Foundation | 🟡 Mostly done |
| 1 | Creator Reel Website MVP (Next.js) | 🟡 Core done, 3 items open |
| 2 | Persistent Data and Real Commerce | 🔴 Not started |
| 3 | Instagram / Meta Automation | 🟡 Dev layer done, live setup pending |
| 4 | Creator Dashboard and Analytics | 🔴 Not started |
| 5 | Security, Legal, Reliability, Launch | 🔴 Not started |

---

## Immediate Next Steps

1. Run locally: `npm run dev` → open `http://localhost:3001/reel/anaya-pink-edit`
2. In Creator Studio: register a creator account → map a reel → tag products → verify Buy Now redirect
3. Complete the 3 open Phase 1 items (product edit form, video upload, mobile QA)
4. Start Phase 2: set up PostgreSQL and migrate off `local-store.json`
5. For live Instagram automation: complete all Phase 3 Meta app and permission-review steps before sending any real messages

> **Do not** add Instagram passwords, use browser automation, or scrape Instagram. All automation must go through the official Meta Graph API after app review approval.
