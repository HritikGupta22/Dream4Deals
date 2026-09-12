require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./db');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS creators (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                TEXT NOT NULL,
        handle              TEXT NOT NULL,
        bio                 TEXT NOT NULL DEFAULT '',
        email               TEXT NOT NULL UNIQUE,
        salt                TEXT NOT NULL,
        password_hash       TEXT NOT NULL,
        email_verified      BOOLEAN NOT NULL DEFAULT FALSE,
        verification_token  TEXT,
        reset_token         TEXT,
        reset_token_expires TIMESTAMPTZ,
        role                TEXT NOT NULL DEFAULT 'owner',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        creator_id  UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        expires_at  TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reels (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slug                TEXT NOT NULL UNIQUE,
        instagram_media_id  TEXT NOT NULL UNIQUE,
        title               TEXT NOT NULL,
        caption             TEXT NOT NULL DEFAULT '',
        poster              TEXT NOT NULL DEFAULT '',
        video_url           TEXT NOT NULL DEFAULT '',
        creator_id          UUID REFERENCES creators(id) ON DELETE SET NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS products (
        id          TEXT NOT NULL,
        reel_id     UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        category    TEXT NOT NULL,
        price       NUMERIC(10,2) NOT NULL,
        image       TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (reel_id, id)
      );

      CREATE TABLE IF NOT EXISTS platforms (
        id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS offers (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id    TEXT NOT NULL,
        reel_id       UUID NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
        platform_id   UUID NOT NULL REFERENCES platforms(id),
        seller        TEXT NOT NULL,
        price         NUMERIC(10,2) NOT NULL,
        delivery      TEXT NOT NULL DEFAULT 'Free delivery',
        rating        TEXT NOT NULL DEFAULT '4.0',
        affiliate_url TEXT NOT NULL DEFAULT '',
        fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        available     BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS click_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reel_slug   TEXT,
        product_id  TEXT,
        platform    TEXT,
        seller      TEXT,
        creator_id  UUID REFERENCES creators(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS automation_rules (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id      UUID REFERENCES creators(id) ON DELETE CASCADE,
        reel_slug       TEXT,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        reply_comments  BOOLEAN NOT NULL DEFAULT TRUE,
        reply_dms       BOOLEAN NOT NULL DEFAULT TRUE,
        triggers        TEXT[] NOT NULL DEFAULT ARRAY['link','shop','buy'],
        reply_template  TEXT NOT NULL DEFAULT 'Hey{{name}}! Here are the shopping links: {{url}} 🛍️',
        fallback_slug   TEXT NOT NULL DEFAULT '',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(creator_id, reel_slug)
      );

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type       TEXT NOT NULL,
        detail     TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS user_last_reel (
        sender_id  TEXT PRIMARY KEY,
        slug       TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Phase 3: idempotency — prevents duplicate replies for same Meta event
      CREATE TABLE IF NOT EXISTS processed_events (
        event_id   TEXT PRIMARY KEY,
        kind       TEXT NOT NULL,
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Task 2-3: Instagram posts & seller links
      ALTER TABLE creators ADD COLUMN IF NOT EXISTS instagram_access_token TEXT;
      ALTER TABLE creators ADD COLUMN IF NOT EXISTS instagram_user_id TEXT UNIQUE;

      -- Upgrade databases created before per-reel automation was introduced.
      ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES creators(id) ON DELETE CASCADE;
      ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS reel_slug TEXT;

      CREATE TABLE IF NOT EXISTS creator_posts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id          UUID NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        instagram_media_id  TEXT NOT NULL,
        caption             TEXT NOT NULL DEFAULT '',
        image_url           TEXT NOT NULL DEFAULT '',
        post_type           TEXT NOT NULL DEFAULT 'CAROUSEL',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(creator_id, instagram_media_id)
      );

      -- Update products table to link to creator_posts
      ALTER TABLE products ADD COLUMN IF NOT EXISTS creator_id UUID REFERENCES creators(id) ON DELETE CASCADE;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS creator_post_id UUID REFERENCES creator_posts(id) ON DELETE CASCADE;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;

      CREATE TABLE IF NOT EXISTS seller_links (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id      TEXT NOT NULL,
        reel_id         UUID,
        platform        TEXT NOT NULL,
        affiliate_url   TEXT NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('✓ Migrations complete');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
