const http = require('http');
const fs   = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const {
  offers, getReel, getReelByInstagramMediaId, reelUrl, mappingRows, reels,
  addReel, deleteReel, updateReel, addProduct, updateProduct, deleteProduct,
} = require('./data');
const {
  validSignature, matchesTrigger, applyTemplate,
  collectIncoming, sendPublicCommentReply, sendDirectMessage,
} = require('./instagram');
const store = require('./store');

const PORT        = Number(process.env.PORT) || 3000;
const UPLOAD_DIR  = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJson(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

function resolveReel(job) {
  const settings = store.getSettings();
  const byMedia  = getReelByInstagramMediaId(job.mediaId);
  if (byMedia) return byMedia;
  const remembered = store.lastReelForUser(job.senderId);
  if (remembered) return getReel(remembered);
  return getReel(settings.fallbackSlug) || reels[0] || null;
}

async function handleJob(job) {
  const settings = store.getSettings();
  if (!settings.enabled)                              { store.logEvent('Automation off', job.text || job.kind); return; }
  if (job.kind === 'comment' && !settings.replyComments) { store.logEvent('Comment replies disabled', job.text || ''); return; }
  if (job.kind === 'dm'      && !settings.replyDms)      { store.logEvent('DM replies disabled', job.text || ''); return; }
  if (!matchesTrigger(job.text, settings.triggers))  { store.logEvent(`${job.kind} ignored`, job.text || 'No text'); return; }

  const reel = resolveReel(job);
  if (!reel) { store.logEvent('Reel not mapped', job.mediaId || 'No Instagram media ID'); return; }
  if (job.senderId) store.rememberUserReel(job.senderId, reel.slug);

  const dmMessage = applyTemplate(settings.replyTemplate, {
    name: job.username, url: reelUrl(reel.slug), title: reel.title,
  });

  if (job.kind === 'comment') {
    if (!job.commentId) { store.logEvent('Reply skipped', 'No comment ID'); return; }
    try {
      await sendPublicCommentReply(job.commentId, 'Link has been sent to your DM! 📩');
      store.logEvent('Comment public reply sent', reel.slug);
    } catch (err) {
      store.logEvent('Comment public reply failed', err.message);
    }
    if (!job.senderId) { store.logEvent('DM skipped', 'No sender ID on comment event'); return; }
    const r = await sendDirectMessage(job.senderId, dmMessage);
    store.logEvent(r.sent ? 'DM sent after comment' : 'DM queued for setup', r.sent ? reel.slug : r.reason);
    return;
  }

  if (!job.senderId) { store.logEvent('DM skipped', 'No sender ID'); return; }
  const r = await sendDirectMessage(job.senderId, dmMessage);
  store.logEvent(r.sent ? 'Instagram DM sent' : 'DM queued for setup', r.sent ? reel.slug : r.reason);
}

async function handleInstagramWebhook(req, res) {
  const raw = (await readBody(req)).toString('utf8');
  if (!validSignature(raw, req.headers['x-hub-signature-256'], process.env.META_APP_SECRET))
    return sendJson(res, 403, { error: 'Invalid webhook signature' });
  const payload = parseJson(raw);
  if (!payload) return sendJson(res, 400, { error: 'Invalid JSON' });
  sendJson(res, 200, { received: true });
  for (const job of collectIncoming(payload)) {
    try { await handleJob(job); } catch (e) { store.logEvent('Instagram reply failed', e.message); }
  }
}

function requireCreator(req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user  = store.userForToken(token);
  if (!user) { sendJson(res, 401, { error: 'Creator sign-in required.' }); return null; }
  return user;
}

function publicSettings() {
  return {
    ...store.getSettings(),
    metaConfigured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_INSTAGRAM_ACCOUNT_ID),
    mappings: mappingRows(),
  };
}

// Multipart file upload — extracts first file field from multipart/form-data
function parseMultipart(body, boundary) {
  const parts = body.toString('binary').split('--' + boundary);
  for (const part of parts) {
    const match = part.match(/Content-Disposition:[^\r\n]*filename="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*)\r\n$/);
    if (!match) continue;
    const filename = `${Date.now()}-${match[1].replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const data     = Buffer.from(match[2], 'binary');
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), data);
    return filename;
  }
  return null;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
      return res.end();
    }

    // ── Webhooks ──────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/webhooks/instagram') {
      const valid = url.searchParams.get('hub.mode') === 'subscribe' &&
                    url.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN;
      if (!valid) return sendJson(res, 403, { error: 'Webhook verification failed' });
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(url.searchParams.get('hub.challenge') || '');
    }
    if (req.method === 'POST' && url.pathname === '/webhooks/instagram')
      return handleInstagramWebhook(req, res);

    // ── File upload ───────────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/upload') {
      if (!requireCreator(req, res)) return;
      const body     = await readBody(req);
      const ct       = req.headers['content-type'] || '';
      const boundary = ct.split('boundary=')[1];
      if (!boundary) return sendJson(res, 400, { error: 'Missing multipart boundary' });
      const filename = parseMultipart(body, boundary);
      if (!filename)  return sendJson(res, 400, { error: 'No file found in upload' });
      const fileUrl  = `${process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`}/uploads/${filename}`;
      return sendJson(res, 200, { url: fileUrl });
    }

    // Serve uploaded files
    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      const file = path.normalize(path.join(UPLOAD_DIR, url.pathname.replace('/uploads/', '')));
      if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200);
      return fs.createReadStream(file).pipe(res);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const data = parseJson((await readBody(req)).toString()) || {};
      if (!data.name || !data.handle || !/^\S+@\S+\.\S+$/.test(data.email || '') || String(data.password || '').length < 8)
        return sendJson(res, 400, { error: 'Name, handle, valid email, and an 8-character password are required.' });
      try {
        const user = store.createUser(data);
        return sendJson(res, 201, { user, token: store.createSession(user.id) });
      } catch (e) { return sendJson(res, 409, { error: e.message }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const data = parseJson((await readBody(req)).toString()) || {};
      const user = store.authenticate(data.email, data.password);
      if (!user) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
      return sendJson(res, 200, { user, token: store.createSession(user.id) });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user  = store.userForToken(token);
      return user ? sendJson(res, 200, { user }) : sendJson(res, 401, { error: 'Sign in required.' });
    }

    // ── Creator profile ───────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/creator/profile') {
      if (!requireCreator(req, res)) return;
      return sendJson(res, 200, store.getCreator());
    }
    if (req.method === 'POST' && url.pathname === '/api/creator/profile') {
      if (!requireCreator(req, res)) return;
      const data = parseJson((await readBody(req)).toString()) || {};
      return sendJson(res, 200, store.saveCreator({
        name: String(data.name || '').trim(),
        handle: String(data.handle || '').trim(),
        bio: String(data.bio || '').trim(),
      }));
    }

    // ── Reels ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/reels')
      return sendJson(res, 200, mappingRows());

    if (req.method === 'GET' && url.pathname.startsWith('/api/reels/') && !url.pathname.includes('/products')) {
      const slug = url.pathname.split('/')[3];
      const reel = getReel(slug);
      if (!reel) return sendJson(res, 404, { error: 'Reel not found' });
      return sendJson(res, 200, reel);
    }

    if (req.method === 'POST' && url.pathname === '/api/reels') {
      if (!requireCreator(req, res)) return;
      const data = parseJson((await readBody(req)).toString()) || {};
      const slug = String(data.slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!slug || !data.title || !data.instagramMediaId)
        return sendJson(res, 400, { error: 'Instagram media ID, title, and slug are required.' });
      if (getReel(slug) || getReelByInstagramMediaId(data.instagramMediaId))
        return sendJson(res, 409, { error: 'That reel URL or Instagram media ID already exists.' });
      const creator = store.getCreator();
      const reel = addReel({
        slug, instagramMediaId: String(data.instagramMediaId),
        creator: { name: creator.name, handle: creator.handle, followers: 'Instagram creator' },
        title: String(data.title), caption: String(data.caption || ''),
        poster: String(data.poster || reels[0]?.poster || ''), videoUrl: '', products: [],
      });
      store.logEvent('Reel created', reel.slug);
      return sendJson(res, 201, { ...reel, url: reelUrl(reel.slug) });
    }

    if (req.method === 'PATCH' && /^\/api\/reels\/[^/]+$/.test(url.pathname)) {
      if (!requireCreator(req, res)) return;
      const slug = url.pathname.split('/')[3];
      const data = parseJson((await readBody(req)).toString()) || {};
      const reel = updateReel(slug, data);
      if (!reel) return sendJson(res, 404, { error: 'Reel not found.' });
      store.logEvent('Reel updated', slug);
      return sendJson(res, 200, reel);
    }

    if (req.method === 'DELETE' && /^\/api\/reels\/[^/]+$/.test(url.pathname)) {
      if (!requireCreator(req, res)) return;
      const slug = url.pathname.split('/')[3];
      if (!deleteReel(slug)) return sendJson(res, 404, { error: 'Reel not found.' });
      store.logEvent('Reel deleted', slug);
      return sendJson(res, 200, { ok: true });
    }

    // ── Products ──────────────────────────────────────────────────────────────
    if (req.method === 'POST' && /^\/api\/reels\/[^/]+\/products$/.test(url.pathname)) {
      if (!requireCreator(req, res)) return;
      const slug = url.pathname.split('/')[3];
      const data = parseJson((await readBody(req)).toString()) || {};
      const id   = String(data.id || data.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id || !data.name || !data.category || !Number.isFinite(Number(data.price)) || !data.image)
        return sendJson(res, 400, { error: 'Product name, category, price, and image URL are required.' });
      const reel = getReel(slug);
      if (!reel) return sendJson(res, 404, { error: 'Reel not found.' });
      if (reel.products.some((p) => p.id === id))
        return sendJson(res, 409, { error: 'This product already exists on the reel.' });
      const product = addProduct(slug, { id, name: String(data.name), category: String(data.category), price: Number(data.price), image: String(data.image) });
      store.logEvent('Product tagged', `${slug} - ${product.name}`);
      return sendJson(res, 201, product);
    }

    if (req.method === 'PATCH' && /^\/api\/reels\/[^/]+\/products\/[^/]+$/.test(url.pathname)) {
      if (!requireCreator(req, res)) return;
      const parts     = url.pathname.split('/');
      const slug      = parts[3];
      const productId = parts[5];
      const data      = parseJson((await readBody(req)).toString()) || {};
      const product   = updateProduct(slug, productId, data);
      if (!product) return sendJson(res, 404, { error: 'Reel or product not found.' });
      store.logEvent('Product updated', `${slug} - ${product.name}`);
      return sendJson(res, 200, product);
    }

    if (req.method === 'DELETE' && /^\/api\/reels\/[^/]+\/products\/[^/]+$/.test(url.pathname)) {
      if (!requireCreator(req, res)) return;
      const parts     = url.pathname.split('/');
      const slug      = parts[3];
      const productId = parts[5];
      if (!deleteProduct(slug, productId)) return sendJson(res, 404, { error: 'Reel or product not found.' });
      store.logEvent('Product deleted', `${slug} - ${productId}`);
      return sendJson(res, 200, { ok: true });
    }

    // ── Offers / redirect / events / automation ───────────────────────────────
    if (req.method === 'GET' && url.pathname.startsWith('/api/offers/')) {
      const productId = url.pathname.split('/').pop();
      return sendJson(res, 200, offers[productId] || []);
    }

    if (req.method === 'GET' && url.pathname === '/api/redirect') {
      const target = url.searchParams.get('url') || '';
      if (!/^https?:\/\//i.test(target)) return sendJson(res, 400, { error: 'Invalid shopping URL' });
      store.logEvent('Shopping redirect', `${url.searchParams.get('platform') || 'Store'} → ${url.searchParams.get('product') || 'Product'}`);
      res.writeHead(302, { Location: target });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/click') {
      const data = parseJson((await readBody(req)).toString()) || {};
      store.logEvent('Shopping click', `${data.platform || 'Store'} → ${data.seller || ''} → ${data.product || 'Product'}`);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/api/events')
      return sendJson(res, 200, store.listEvents());

    if (req.method === 'GET' && url.pathname === '/api/automation')
      return sendJson(res, 200, publicSettings());

    if (req.method === 'POST' && url.pathname === '/api/automation') {
      const data = parseJson((await readBody(req)).toString()) || {};
      return sendJson(res, 200, { ...store.saveSettings(data), mappings: mappingRows() });
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    sendJson(res, 500, { error: e.message || 'Server error' });
  }
}).listen(PORT, () => {
  console.log(`Dream4Deals backend running at http://localhost:${PORT}`);
  console.log(`Sample reel: http://localhost:${PORT}/reel/dress-pink-edit`);
});
