const pool = require('./db');

function reelUrl(slug) {
  return `${process.env.FRONTEND_BASE_URL || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/reel/${slug}`;
}

// ── reels ─────────────────────────────────────────────────────────────────────
async function getReel(slug) {
  const reelRes = await pool.query(
    `SELECT r.id, r.slug, r.creator_id AS "creatorId", r.instagram_media_id AS "instagramMediaId",
            r.title, r.caption, r.poster, r.video_url AS "videoUrl",
            c.name AS creator_name, c.handle AS creator_handle,
            c.instagram_user_id AS "creatorInstagramUserId"
     FROM reels r
     LEFT JOIN creators c ON c.id = r.creator_id
     WHERE r.slug = $1`,
    [slug]
  );
  if (!reelRes.rows.length) return null;
  const row = reelRes.rows[0];

  const prodRes = await pool.query(
    `SELECT id, name, category, price::float AS price, image
     FROM products WHERE reel_id = $1 ORDER BY created_at`,
    [row.id]
  );
  const productIds = prodRes.rows.map((product) => product.id);
  const linksRes = productIds.length
    ? await pool.query(
      `SELECT product_id, platform, affiliate_url, price::float AS price
       FROM seller_links WHERE product_id = ANY($1::text[])`,
      [productIds]
    )
    : { rows: [] };
  const linksByProduct = new Map();
  for (const link of linksRes.rows) {
    const links = linksByProduct.get(link.product_id) || [];
    links.push({ platform: link.platform, url: link.affiliate_url, price: link.price });
    linksByProduct.set(link.product_id, links);
  }

  return {
    slug:              row.slug,
    creatorId:         row.creatorId,
    creatorInstagramUserId: row.creatorInstagramUserId,
    instagramMediaId:  row.instagramMediaId,
    title:             row.title,
    caption:           row.caption,
    poster:            row.poster,
    videoUrl:          row.videoUrl,
    creator: {
      name:      row.creator_name || 'Dream4Deals',
      handle:    row.creator_handle || '@dream4deal',
      followers: 'Instagram creator',
    },
    products: prodRes.rows.map((product) => ({
      ...product,
      sellerLinks: linksByProduct.get(product.id) || [],
    })),
  };
}

async function getReelByInstagramMediaId(mediaId) {
  const res = await pool.query(
    'SELECT slug FROM reels WHERE instagram_media_id = $1',
    [String(mediaId)]
  );
  if (!res.rows.length) return null;
  return getReel(res.rows[0].slug);
}

async function mappingRows() {
  const res = await pool.query(
    'SELECT instagram_media_id AS "instagramMediaId", slug, title FROM reels ORDER BY created_at'
  );
  return res.rows.map((r) => ({ ...r, url: reelUrl(r.slug) }));
}

async function addReel({ slug, instagramMediaId, title, caption, poster, videoUrl, creatorId }) {
  const res = await pool.query(
    `INSERT INTO reels (slug, instagram_media_id, title, caption, poster, video_url, creator_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, slug`,
    [slug, instagramMediaId, title, caption || '', poster || '', videoUrl || '', creatorId || null]
  );
  return getReel(res.rows[0].slug);
}

async function updateReel(slug, { title, caption, poster, videoUrl }) {
  await pool.query(
    `UPDATE reels SET
       title     = COALESCE(NULLIF($1,''), title),
       caption   = COALESCE(NULLIF($2,''), caption),
       poster    = COALESCE(NULLIF($3,''), poster),
       video_url = COALESCE(NULLIF($4,''), video_url)
     WHERE slug = $5`,
    [title, caption, poster, videoUrl, slug]
  );
  return getReel(slug);
}

async function deleteReel(slug) {
  const res = await pool.query('DELETE FROM reels WHERE slug=$1 RETURNING id', [slug]);
  return res.rowCount > 0;
}

// ── products ──────────────────────────────────────────────────────────────────
async function addProduct(slug, { id, name, category, price, image }) {
  const reelRes = await pool.query('SELECT id FROM reels WHERE slug=$1', [slug]);
  if (!reelRes.rows.length) return null;
  const reelId = reelRes.rows[0].id;
  const res = await pool.query(
    `INSERT INTO products (id, reel_id, name, category, price, image)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, category, price::float AS price, image`,
    [id, reelId, name, category, price, image]
  );
  return res.rows[0];
}

async function updateProduct(slug, productId, { name, category, price, image }) {
  const reelRes = await pool.query('SELECT id FROM reels WHERE slug=$1', [slug]);
  if (!reelRes.rows.length) return null;
  const reelId = reelRes.rows[0].id;
  const res = await pool.query(
    `UPDATE products SET
       name     = COALESCE(NULLIF($1,''), name),
       category = COALESCE(NULLIF($2,''), category),
       price    = COALESCE(NULLIF($3::text,'')::numeric, price),
       image    = COALESCE(NULLIF($4,''), image)
     WHERE reel_id=$5 AND id=$6
     RETURNING id, name, category, price::float AS price, image`,
    [name || '', category || '', price != null ? String(price) : '', image || '', reelId, productId]
  );
  return res.rows[0] || null;
}

async function deleteProduct(slug, productId) {
  const reelRes = await pool.query('SELECT id FROM reels WHERE slug=$1', [slug]);
  if (!reelRes.rows.length) return false;
  const res = await pool.query(
    'DELETE FROM products WHERE reel_id=$1 AND id=$2 RETURNING id',
    [reelRes.rows[0].id, productId]
  );
  return res.rowCount > 0;
}

// ── offers ────────────────────────────────────────────────────────────────────
async function getPlatforms() {
  const res = await pool.query('SELECT id, name FROM platforms ORDER BY name');
  return res.rows;
}

async function addOffer(productId, { platformId, seller, price, delivery, rating, affiliateUrl }) {
  const res = await pool.query(
    `INSERT INTO offers (product_id, platform_id, seller, price, delivery, rating, affiliate_url, available, fetched_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW())
     RETURNING id, seller, price::float AS price, delivery, rating, affiliate_url AS link, available`,
    [productId, platformId, seller, price, delivery || '', rating || '', affiliateUrl || '']
  );
  return res.rows[0];
}

async function updateOffer(offerId, { seller, price, delivery, rating, affiliateUrl, available }) {
  const res = await pool.query(
    `UPDATE offers SET
       seller        = COALESCE(NULLIF($1,''), seller),
       price         = COALESCE(NULLIF($2::text,'')::numeric, price),
       delivery      = COALESCE(NULLIF($3,''), delivery),
       rating        = COALESCE(NULLIF($4,''), rating),
       affiliate_url = COALESCE(NULLIF($5,''), affiliate_url),
       available     = COALESCE($6, available),
       fetched_at    = NOW()
     WHERE id=$7
     RETURNING id, seller, price::float AS price, delivery, rating, affiliate_url AS link, available`,
    [seller||'', price!=null?String(price):'', delivery||'', rating||'', affiliateUrl||'', available??null, offerId]
  );
  return res.rows[0] || null;
}

async function deleteOffer(offerId) {
  const res = await pool.query('DELETE FROM offers WHERE id=$1 RETURNING id', [offerId]);
  return res.rowCount > 0;
}

async function getOffersRaw(productId) {
  const res = await pool.query(
    `SELECT o.id, p.name AS platform, p.id AS platform_id, o.seller,
            o.price::float AS price, o.delivery, o.rating,
            o.affiliate_url AS link, o.available
     FROM offers o JOIN platforms p ON p.id = o.platform_id
     WHERE o.product_id = $1 ORDER BY p.name, o.price`,
    [productId]
  );
  return res.rows;
}

async function getOffers(productId) {
  const res = await pool.query(
    `SELECT p.name AS platform, o.seller, o.price::float AS price,
            o.delivery, o.rating, o.affiliate_url AS link, o.available,
            o.fetched_at
     FROM offers o
     JOIN platforms p ON p.id = o.platform_id
     WHERE o.product_id = $1 AND o.available = true
     ORDER BY p.name, o.price`,
    [productId]
  );

  // Group by platform
  const grouped = {};
  for (const row of res.rows) {
    if (!grouped[row.platform]) grouped[row.platform] = { platform: row.platform, sellers: [], fetchedAt: row.fetched_at };
    grouped[row.platform].sellers.push({
      seller:   row.seller,
      price:    row.price,
      delivery: row.delivery,
      rating:   row.rating,
      link:     row.link,
    });
  }
  return Object.values(grouped);
}

module.exports = {
  reelUrl, getReel, getReelByInstagramMediaId, mappingRows,
  addReel, updateReel, deleteReel,
  addProduct, updateProduct, deleteProduct,
  getPlatforms, addOffer, updateOffer, deleteOffer, getOffersRaw, getOffers,
};
