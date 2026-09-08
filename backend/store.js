const crypto = require('crypto');
const pool   = require('./db');

// ── helpers ───────────────────────────────────────────────────────────────────
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function publicUser(u) {
  return { id: u.id, name: u.name, handle: u.handle, email: u.email };
}

// ── users / auth ──────────────────────────────────────────────────────────────
async function createUser({ name, handle, email, password }) {
  const existing = await pool.query('SELECT id FROM creators WHERE email=$1', [email.toLowerCase()]);
  if (existing.rows.length) throw new Error('An account already uses this email.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const res  = await pool.query(
    `INSERT INTO creators (name, handle, email, salt, password_hash)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name, handle, email`,
    [name, handle, email.toLowerCase(), salt, hash]
  );
  return publicUser(res.rows[0]);
}

async function authenticate(email, password) {
  const res = await pool.query('SELECT * FROM creators WHERE email=$1', [String(email).toLowerCase()]);
  const u   = res.rows[0];
  if (!u || hashPassword(password, u.salt) !== u.password_hash) return null;
  return publicUser(u);
}

async function createSession(userId) {
  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO sessions (token, creator_id, expires_at) VALUES ($1,$2,$3)',
    [token, userId, expiresAt]
  );
  return token;
}

async function userForToken(token) {
  const res = await pool.query(
    `SELECT c.id, c.name, c.handle, c.email
     FROM sessions s JOIN creators c ON c.id = s.creator_id
     WHERE s.token=$1 AND s.expires_at > NOW()`,
    [token]
  );
  return res.rows[0] ? publicUser(res.rows[0]) : null;
}

// ── creator profile ───────────────────────────────────────────────────────────
async function getCreator(creatorId) {
  if (creatorId) {
    const res = await pool.query('SELECT name, handle, bio FROM creators WHERE id=$1', [creatorId]);
    return res.rows[0] || { name: 'Dream4Deals', handle: '@dream4deal', bio: '' };
  }
  // fallback: first creator or default
  const res = await pool.query('SELECT name, handle, bio FROM creators ORDER BY created_at LIMIT 1');
  return res.rows[0] || { name: 'Dream4Deals', handle: '@dream4deal', bio: '' };
}

async function saveCreator(creatorId, { name, handle, bio }) {
  const res = await pool.query(
    'UPDATE creators SET name=$1, handle=$2, bio=$3 WHERE id=$4 RETURNING name, handle, bio',
    [name, handle, bio, creatorId]
  );
  return res.rows[0];
}

// ── automation settings ───────────────────────────────────────────────────────
const DEFAULT_RULE = {
  enabled: true, reply_comments: true, reply_dms: true,
  triggers: ['link', 'shop', 'buy', 'price'],
  reply_template: 'Hey{{name}}! Here are the shopping links: {{url}} 🛍️',
  fallback_slug: 'dress-pink-edit',
};

async function getSettings() {
  const res = await pool.query('SELECT * FROM automation_rules ORDER BY updated_at DESC LIMIT 1');
  const row = res.rows[0] || DEFAULT_RULE;
  return {
    enabled:       row.enabled,
    replyComments: row.reply_comments,
    replyDms:      row.reply_dms,
    triggers:      row.triggers || DEFAULT_RULE.triggers,
    replyTemplate: row.reply_template,
    fallbackSlug:  row.fallback_slug,
    id:            row.id,
  };
}

async function saveSettings({ enabled, replyComments, replyDms, triggers, replyTemplate }) {
  const cleanTriggers = (Array.isArray(triggers) ? triggers : [])
    .map((w) => String(w).trim().toLowerCase()).filter(Boolean);

  const existing = await pool.query('SELECT id FROM automation_rules LIMIT 1');
  if (existing.rows.length) {
    await pool.query(
      `UPDATE automation_rules SET enabled=$1, reply_comments=$2, reply_dms=$3,
       triggers=$4, reply_template=$5, updated_at=NOW() WHERE id=$6`,
      [enabled, replyComments, replyDms, cleanTriggers, replyTemplate, existing.rows[0].id]
    );
  } else {
    await pool.query(
      `INSERT INTO automation_rules (enabled, reply_comments, reply_dms, triggers, reply_template)
       VALUES ($1,$2,$3,$4,$5)`,
      [enabled, replyComments, replyDms, cleanTriggers, replyTemplate]
    );
  }
  return getSettings();
}

// ── event log ─────────────────────────────────────────────────────────────────
async function logEvent(type, detail) {
  await pool.query(
    'INSERT INTO webhook_logs (type, detail) VALUES ($1,$2)',
    [String(type), String(detail)]
  );
}

async function listEvents() {
  const res = await pool.query(
    'SELECT type, detail, created_at AS at FROM webhook_logs ORDER BY created_at DESC LIMIT 50'
  );
  return res.rows;
}

// ── user ↔ reel memory ────────────────────────────────────────────────────────
async function rememberUserReel(senderId, slug) {
  if (!senderId || !slug) return;
  await pool.query(
    `INSERT INTO user_last_reel (sender_id, slug, updated_at) VALUES ($1,$2,NOW())
     ON CONFLICT (sender_id) DO UPDATE SET slug=$2, updated_at=NOW()`,
    [senderId, slug]
  );
}

async function lastReelForUser(senderId) {
  if (!senderId) return null;
  const res = await pool.query('SELECT slug FROM user_last_reel WHERE sender_id=$1', [senderId]);
  return res.rows[0]?.slug || null;
}

// ── analytics ─────────────────────────────────────────────────────────────
async function getAnalytics(creatorId) {
  const [byReel, byPlatform, byProduct, daily] = await Promise.all([
    pool.query(
      `SELECT reel_slug AS label, COUNT(*) AS clicks
       FROM click_events WHERE creator_id=$1 AND reel_slug IS NOT NULL
       GROUP BY reel_slug ORDER BY clicks DESC LIMIT 5`,
      [creatorId]
    ),
    pool.query(
      `SELECT platform AS label, COUNT(*) AS clicks
       FROM click_events WHERE creator_id=$1 AND platform IS NOT NULL
       GROUP BY platform ORDER BY clicks DESC LIMIT 5`,
      [creatorId]
    ),
    pool.query(
      `SELECT product_id AS label, COUNT(*) AS clicks
       FROM click_events WHERE creator_id=$1 AND product_id IS NOT NULL
       GROUP BY product_id ORDER BY clicks DESC LIMIT 5`,
      [creatorId]
    ),
    pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS clicks
       FROM click_events WHERE creator_id=$1
         AND created_at >= NOW() - INTERVAL '14 days'
       GROUP BY day ORDER BY day`,
      [creatorId]
    ),
  ]);
  return {
    byReel:     byReel.rows.map((r) => ({ label: r.label, clicks: Number(r.clicks) })),
    byPlatform: byPlatform.rows.map((r) => ({ label: r.label, clicks: Number(r.clicks) })),
    byProduct:  byProduct.rows.map((r) => ({ label: r.label, clicks: Number(r.clicks) })),
    daily:      daily.rows.map((r) => ({ day: r.day, clicks: Number(r.clicks) })),
  };
}

// ── dashboard stats ──────────────────────────────────────────────────────────
async function getDashboard(creatorId) {
  const [reels, clicks, topProduct, topPlatform, revenue] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM reels WHERE creator_id=$1', [creatorId]),
    pool.query('SELECT COUNT(*) FROM click_events WHERE creator_id=$1', [creatorId]),
    pool.query(
      `SELECT product_id, COUNT(*) AS cnt FROM click_events
       WHERE creator_id=$1 AND product_id IS NOT NULL
       GROUP BY product_id ORDER BY cnt DESC LIMIT 1`,
      [creatorId]
    ),
    pool.query(
      `SELECT platform, COUNT(*) AS cnt FROM click_events
       WHERE creator_id=$1 AND platform IS NOT NULL
       GROUP BY platform ORDER BY cnt DESC LIMIT 1`,
      [creatorId]
    ),
    pool.query(
      `SELECT COALESCE(SUM(o.price * 0.05), 0) AS est
       FROM click_events ce
       JOIN offers o ON o.product_id = ce.product_id AND o.platform = ce.platform
       WHERE ce.creator_id=$1`,
      [creatorId]
    ),
  ]);
  return {
    totalReels:   Number(reels.rows[0].count),
    totalClicks:  Number(clicks.rows[0].count),
    topProduct:   topProduct.rows[0]?.product_id  || null,
    topPlatform:  topPlatform.rows[0]?.platform   || null,
    estRevenue:   Math.round(Number(revenue.rows[0].est)),
  };
}

// ── click events ──────────────────────────────────────────────────────────────
async function logClick({ reelSlug, productId, platform, seller, creatorId }) {
  await pool.query(
    `INSERT INTO click_events (reel_slug, product_id, platform, seller, creator_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [reelSlug || null, productId || null, platform || null, seller || null, creatorId || null]
  );
}

// ── email verification & password reset ────────────────────────────────────
async function requestEmailVerification(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const res = await pool.query(
    'UPDATE creators SET verification_token=$1 WHERE email=$2 RETURNING id',
    [token, email.toLowerCase()]
  );
  if (!res.rows.length) return null;
  // In production: send email with verification link
  return token;
}

async function verifyEmail(token) {
  const res = await pool.query(
    'UPDATE creators SET email_verified=TRUE, verification_token=NULL WHERE verification_token=$1 RETURNING id',
    [token]
  );
  return res.rows[0] ? true : false;
}

async function requestPasswordReset(email) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  const res = await pool.query(
    'UPDATE creators SET reset_token=$1, reset_token_expires=$2 WHERE email=$3 RETURNING id',
    [token, expiresAt, email.toLowerCase()]
  );
  if (!res.rows.length) return null;
  // In production: send email with reset link
  return token;
}

async function resetPassword(token, newPassword) {
  const res = await pool.query(
    `SELECT id, salt FROM creators 
     WHERE reset_token=$1 AND reset_token_expires > NOW()`,
    [token]
  );
  if (!res.rows.length) return null;
  const user = res.rows[0];
  const hash = hashPassword(newPassword, user.salt);
  await pool.query(
    'UPDATE creators SET password_hash=$1, reset_token=NULL, reset_token_expires=NULL WHERE id=$2',
    [hash, user.id]
  );
  return user.id;
}

// ── logout ─────────────────────────────────────────────────────────────────
async function logout(token) {
  await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
}

// ── activity feed ──────────────────────────────────────────────────────────
async function getActivityFeed(creatorId, limit = 20) {
  const res = await pool.query(
    `SELECT 'click' AS type, reel_slug AS label, NULL AS detail, created_at AS at
     FROM click_events WHERE creator_id=$1
     UNION ALL
     SELECT 'event' AS type, type AS label, detail, created_at AS at
     FROM webhook_logs WHERE created_at >= NOW() - INTERVAL '7 days'
     ORDER BY at DESC LIMIT $2`,
    [creatorId, limit]
  );
  return res.rows;
}

// ── per-reel automation rules ──────────────────────────────────────────────
async function getReelAutomation(creatorId, reelSlug) {
  const res = await pool.query(
    `SELECT * FROM automation_rules 
     WHERE creator_id=$1 AND reel_slug=$2`,
    [creatorId, reelSlug]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    enabled: row.enabled,
    replyComments: row.reply_comments,
    replyDms: row.reply_dms,
    triggers: row.triggers || [],
    replyTemplate: row.reply_template,
  };
}

async function saveReelAutomation(creatorId, reelSlug, { enabled, replyComments, replyDms, triggers, replyTemplate }) {
  const cleanTriggers = (Array.isArray(triggers) ? triggers : [])
    .map((w) => String(w).trim().toLowerCase()).filter(Boolean);
  
  const existing = await pool.query(
    'SELECT id FROM automation_rules WHERE creator_id=$1 AND reel_slug=$2',
    [creatorId, reelSlug]
  );
  
  if (existing.rows.length) {
    await pool.query(
      `UPDATE automation_rules 
       SET enabled=$1, reply_comments=$2, reply_dms=$3, triggers=$4, reply_template=$5, updated_at=NOW()
       WHERE creator_id=$6 AND reel_slug=$7`,
      [enabled, replyComments, replyDms, cleanTriggers, replyTemplate, creatorId, reelSlug]
    );
  } else {
    await pool.query(
      `INSERT INTO automation_rules (creator_id, reel_slug, enabled, reply_comments, reply_dms, triggers, reply_template)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [creatorId, reelSlug, enabled, replyComments, replyDms, cleanTriggers, replyTemplate]
    );
  }
  return getReelAutomation(creatorId, reelSlug);
}

async function deleteReelAutomation(creatorId, reelSlug) {
  await pool.query(
    'DELETE FROM automation_rules WHERE creator_id=$1 AND reel_slug=$2',
    [creatorId, reelSlug]
  );
}

module.exports = {
  createUser, authenticate, createSession, userForToken,
  getCreator, saveCreator,
  getSettings, saveSettings,
  logEvent, listEvents,
  rememberUserReel, lastReelForUser,
  logClick, getDashboard, getAnalytics,
  requestEmailVerification, verifyEmail, requestPasswordReset, resetPassword, logout,
  getActivityFeed, getReelAutomation, saveReelAutomation, deleteReelAutomation,
  getInstagramToken, createInstagramToken, getCreatorInstagramPosts, syncInstagramPosts, getCreatorPostProducts, saveProductsForPost,
};


// ── Instagram Posts (New) ──────────────────────────────────────────────────────
async function getInstagramToken(creatorId) {
  const res = await pool.query(
    'SELECT instagram_access_token FROM creators WHERE id=$1',
    [creatorId]
  );
  return res.rows[0]?.instagram_access_token || null;
}

async function createInstagramToken(creatorId, token) {
  await pool.query(
    'UPDATE creators SET instagram_access_token=$1 WHERE id=$2',
    [token, creatorId]
  );
  return token;
}

async function getCreatorInstagramPosts(creatorId) {
  // Fetch posts from database
  const res = await pool.query(
    `SELECT id, instagram_media_id, caption, image_url, post_type, created_at
     FROM creator_posts
     WHERE creator_id=$1
     ORDER BY created_at DESC
     LIMIT 50`,
    [creatorId]
  );
  
  return res.rows.map(row => ({
    id: row.id,
    instagramMediaId: row.instagram_media_id,
    caption: row.caption,
    imageUrl: row.image_url,
    postType: row.post_type,
    createdAt: row.created_at,
    products: []
  }));
}

async function syncInstagramPosts(creatorId, posts) {
  // Insert or update posts from Meta API
  for (const post of posts) {
    await pool.query(
      `INSERT INTO creator_posts (creator_id, instagram_media_id, caption, image_url, post_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (creator_id, instagram_media_id) DO UPDATE
       SET caption=$3, image_url=$4, updated_at=NOW()`,
      [creatorId, post.id, post.caption || '', post.media_type || 'CAROUSEL', post.media_url || '']
    );
  }
}

async function getCreatorPostProducts(postId) {
  const res = await pool.query(
    `SELECT p.id, p.name, p.image_url, p.created_at
     FROM products p
     WHERE p.creator_post_id=$1
     ORDER BY p.created_at DESC`,
    [postId]
  );
  return res.rows;
}

async function saveProductsForPost(creatorId, postId, products) {
  // Delete existing products for this post
  await pool.query('DELETE FROM products WHERE creator_post_id=$1', [postId]);
  
  // Insert new products
  for (const product of products) {
    const productId = `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    await pool.query(
      `INSERT INTO products (id, reel_id, name, category, price, image, creator_id, creator_post_id, image_url)
       VALUES ($1, NULL, $2, 'uncategorized', 0, '', $3, $4, $5)`,
      [productId, product.name, creatorId, postId, product.imageUrl]
    );
    
    // Insert seller links
    for (const link of product.sellerLinks || []) {
      await pool.query(
        `INSERT INTO seller_links (product_id, platform, affiliate_url)
         VALUES ($1, $2, $3)`,
        [productId, link.platform, link.url]
      );
    }
  }
}
