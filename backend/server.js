const http = require('http');
const fs = require('fs');
const path = require('path');

loadEnv(path.join(__dirname, '.env'));

const { offers, getReel, getReelByInstagramMediaId, reelUrl, mappingRows, reels, addReel, addProduct, deleteReel, deleteProduct, updateReel } = require('./data');
const {
  validSignature,
  matchesTrigger,
  applyTemplate,
  collectIncoming,
  sendPublicCommentReply,
  sendDirectMessage,
} = require('./instagram');
const store = require('./store');

const PORT = Number(process.env.PORT) || 3000;
const frontendDir = path.resolve(__dirname, '..', 'frontend');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

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
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseJson(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

function serveFrontend(res, pathname) {
  const requested =
    pathname === '/' || pathname.startsWith('/reel/') ? 'index.html' : pathname.slice(1);

  const file = path.normalize(path.join(frontendDir, requested));
  if (!file.startsWith(frontendDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendJson(res, 404, { error: 'Not found' });
  }

  const mime = mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(file).pipe(res);
}

function resolveReel(job) {
  const settings = store.getSettings();
  const byMedia = getReelByInstagramMediaId(job.mediaId);
  if (byMedia) return byMedia;

  const remembered = store.lastReelForUser(job.senderId);
  if (remembered) return getReel(remembered);

  return getReel(settings.fallbackSlug) || reels[0] || null;
}

async function handleJob(job) {
  const settings = store.getSettings();
  if (!settings.enabled) {
    store.logEvent('Automation off', job.text || job.kind);
    return;
  }

  if (job.kind === 'comment' && !settings.replyComments) {
    store.logEvent('Comment replies disabled', job.text || '');
    return;
  }

  if (job.kind === 'dm' && !settings.replyDms) {
    store.logEvent('DM replies disabled', job.text || '');
    return;
  }

  if (!matchesTrigger(job.text, settings.triggers)) {
    store.logEvent(`${job.kind} ignored`, job.text || 'No text');
    return;
  }

  const reel = resolveReel(job);
  if (!reel) {
    store.logEvent('Reel not mapped', job.mediaId || 'No Instagram media ID');
    return;
  }

  if (job.senderId) store.rememberUserReel(job.senderId, reel.slug);

  const dmMessage = applyTemplate(settings.replyTemplate, {
    name: job.username,
    url: reelUrl(reel.slug),
    title: reel.title,
  });

  if (job.kind === 'comment') {
    if (!job.commentId) {
      store.logEvent('Reply skipped', 'Meta event did not include a comment ID');
      return;
    }
    // Step 1 — public comment reply (visible to everyone, no link)
    try {
      await sendPublicCommentReply(job.commentId, 'Link has been sent to your DM! 📩');
      store.logEvent('Comment public reply sent', reel.slug);
    } catch (err) {
      store.logEvent('Comment public reply failed', err.message);
    }
    // Step 2 — send the actual link privately via DM
    if (!job.senderId) {
      store.logEvent('DM skipped', 'No sender ID on comment event');
      return;
    }
    const dmResult = await sendDirectMessage(job.senderId, dmMessage);
    store.logEvent(
      dmResult.sent ? 'DM sent after comment' : 'DM queued for setup',
      dmResult.sent ? reel.slug : dmResult.reason
    );
    return;
  }

  // Plain DM trigger — send the link directly
  if (!job.senderId) {
    store.logEvent('DM skipped', 'Meta event did not include a sender ID');
    return;
  }

  const dmResult = await sendDirectMessage(job.senderId, dmMessage);
  store.logEvent(
    dmResult.sent ? 'Instagram DM sent' : 'DM queued for setup',
    dmResult.sent ? reel.slug : dmResult.reason
  );
}

async function handleInstagramWebhook(req, res) {
  const raw = await readBody(req);
  if (!validSignature(raw, req.headers['x-hub-signature-256'], process.env.META_APP_SECRET)) {
    return sendJson(res, 403, { error: 'Invalid webhook signature' });
  }

  const payload = parseJson(raw);
  if (!payload) return sendJson(res, 400, { error: 'Invalid JSON' });

  sendJson(res, 200, { received: true });

  for (const job of collectIncoming(payload)) {
    try {
      await handleJob(job);
    } catch (error) {
      store.logEvent('Instagram reply failed', error.message);
    }
  }
}

function requireCreator(req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = store.userForToken(token);
  if (!user) { sendJson(res, 401, { error: 'Creator sign-in required.' }); return null; }
  return user;
}

function publicSettings() {
  const settings = store.getSettings();
  return {
    ...settings,
    metaConfigured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_INSTAGRAM_ACCOUNT_ID),
    mappings: mappingRows(),
  };
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/webhooks/instagram') {
        const valid =
          url.searchParams.get('hub.mode') === 'subscribe' &&
          url.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN;

        if (!valid) {
          return sendJson(res, 403, { error: 'Webhook verification failed' });
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end(url.searchParams.get('hub.challenge') || '');
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/instagram') {
        return handleInstagramWebhook(req, res);
      }

      if (req.method === 'GET' && url.pathname === '/api/reels') {
        return sendJson(res, 200, mappingRows());
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/register') {
        const data = parseJson(await readBody(req)) || {};
        if (!data.name || !data.handle || !/^\S+@\S+\.\S+$/.test(data.email || '') || String(data.password || '').length < 8) return sendJson(res, 400, { error: 'Name, handle, valid email, and an 8-character password are required.' });
        try { const user = store.createUser(data); return sendJson(res, 201, { user, token: store.createSession(user.id) }); } catch (error) { return sendJson(res, 409, { error: error.message }); }
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        const data = parseJson(await readBody(req)) || {}; const user = store.authenticate(data.email, data.password);
        if (!user) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
        return sendJson(res, 200, { user, token: store.createSession(user.id) });
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/me') {
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const user = store.userForToken(token);
        return user ? sendJson(res, 200, { user }) : sendJson(res, 401, { error: 'Sign in required.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/creator/profile') {
        if (!requireCreator(req, res)) return;
        return sendJson(res, 200, store.getCreator());
      }

      if (req.method === 'POST' && url.pathname === '/api/creator/profile') {
        if (!requireCreator(req, res)) return;
        const data = parseJson(await readBody(req)) || {};
        return sendJson(res, 200, store.saveCreator({ name: String(data.name || '').trim(), handle: String(data.handle || '').trim(), bio: String(data.bio || '').trim() }));
      }

      if (req.method === 'POST' && url.pathname === '/api/reels') {
        if (!requireCreator(req, res)) return;
        const data = parseJson(await readBody(req)) || {};
        const slug = String(data.slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug || !data.title || !data.instagramMediaId) return sendJson(res, 400, { error: 'Instagram media ID, title, and slug are required.' });
        if (getReel(slug) || getReelByInstagramMediaId(data.instagramMediaId)) return sendJson(res, 409, { error: 'That reel URL or Instagram media ID already exists.' });
        const creator = store.getCreator();
        const reel = addReel({ slug, instagramMediaId: String(data.instagramMediaId), creator: { name: creator.name, handle: creator.handle, followers: 'Instagram creator' }, title: String(data.title), caption: String(data.caption || ''), poster: String(data.poster || reels[0].poster), videoUrl: '', products: [] });
        store.logEvent('Reel created', reel.slug);
        return sendJson(res, 201, { ...reel, url: reelUrl(reel.slug) });
      }
      if (req.method === 'POST' && /^\/api\/reels\/[^/]+\/products$/.test(url.pathname)) {
        if (!requireCreator(req, res)) return;
        const slug = url.pathname.split('/')[3]; const data = parseJson(await readBody(req)) || {};
        const id = String(data.id || data.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!id || !data.name || !data.category || !Number.isFinite(Number(data.price)) || !data.image) return sendJson(res, 400, { error: 'Product name, category, price, and image URL are required.' });
        const reel = getReel(slug); if (!reel) return sendJson(res, 404, { error: 'Reel not found.' });
        if (reel.products.some((product) => product.id === id)) return sendJson(res, 409, { error: 'This product already exists on the reel.' });
        const product = addProduct(slug, { id, name: String(data.name), category: String(data.category), price: Number(data.price), image: String(data.image) });
        store.logEvent('Product tagged', slug + ' - ' + product.name); return sendJson(res, 201, product);
      }

      if (req.method === 'DELETE' && /^\/api\/reels\/[^/]+\/products\/[^/]+$/.test(url.pathname)) {
        if (!requireCreator(req, res)) return;
        const parts = url.pathname.split('/');
        const slug = parts[3]; const productId = parts[5];
        const ok = deleteProduct(slug, productId);
        if (!ok) return sendJson(res, 404, { error: 'Reel or product not found.' });
        store.logEvent('Product deleted', slug + ' - ' + productId);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'DELETE' && /^\/api\/reels\/[^/]+$/.test(url.pathname)) {
        if (!requireCreator(req, res)) return;
        const slug = url.pathname.split('/').pop();
        const ok = deleteReel(slug);
        if (!ok) return sendJson(res, 404, { error: 'Reel not found.' });
        store.logEvent('Reel deleted', slug);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'PATCH' && /^\/api\/reels\/[^/]+$/.test(url.pathname)) {
        if (!requireCreator(req, res)) return;
        const slug = url.pathname.split('/').pop();
        const data = parseJson(await readBody(req)) || {};
        const reel = updateReel(slug, data);
        if (!reel) return sendJson(res, 404, { error: 'Reel not found.' });
        store.logEvent('Reel updated', slug);
        return sendJson(res, 200, reel);
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/login') {
        return sendJson(res, 405, { error: 'Use POST.' });
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/reels/')) {
        const slug = url.pathname.split('/').pop();
        const reel = getReel(slug);
        if (!reel) return sendJson(res, 404, { error: 'Reel not found' });
        return sendJson(res, 200, reel);
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/offers/')) {
        const productId = url.pathname.split('/').pop();
        return sendJson(res, 200, offers[productId] || []);
      }

      if (req.method === 'GET' && url.pathname === '/api/events') {
        return sendJson(res, 200, store.listEvents());
      }

      if (req.method === 'GET' && url.pathname === '/api/automation') {
        return sendJson(res, 200, publicSettings());
      }

      if (req.method === 'POST' && url.pathname === '/api/automation') {
        const data = parseJson(await readBody(req)) || {};
        return sendJson(res, 200, { ...store.saveSettings(data), mappings: mappingRows() });
      }

      if (req.method === 'POST' && url.pathname === '/api/click') {
        const data = parseJson(await readBody(req)) || {};
        store.logEvent(
          'Shopping click',
          `${data.platform || 'Store'} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${data.seller || ''} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${data.product || 'Product'}`
        );
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/redirect') {
        const target = url.searchParams.get('url') || '';
        if (!/^https?:\/\//i.test(target)) {
          return sendJson(res, 400, { error: 'Invalid shopping URL' });
        }
        store.logEvent(
          'Shopping redirect',
          `${url.searchParams.get('platform') || 'Store'} ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Â ÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${url.searchParams.get('product') || 'Product'}`
        );
        res.writeHead(302, { Location: target });
        return res.end();
      }

      if (req.method === 'GET') {
        return serveFrontend(res, url.pathname);
      }

      sendJson(res, 405, { error: 'Method not allowed' });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Server error' });
    }
  })
  .listen(PORT, () => {
    console.log(`Dream4Deals running at http://localhost:${PORT}`);
    console.log(`Sample reel: http://localhost:${PORT}/reel/dress-pink-edit`);
  });
