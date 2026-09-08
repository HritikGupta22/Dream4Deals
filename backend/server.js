require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const FormData = require('form-data');
const Mailgun = require('mailgun.js');

const mailgun = new Mailgun(FormData);
const mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY || 'mock-key' });

const {
  getReel, getReelByInstagramMediaId, reelUrl, mappingRows,
  addReel, updateReel, deleteReel,
  addProduct, updateProduct, deleteProduct,
  getPlatforms, addOffer, updateOffer, deleteOffer, getOffersRaw, getOffers,
} = require('./data');
const {
  validSignature, matchesTrigger, applyTemplate,
  collectIncoming, sendPublicCommentReply, sendDirectMessage,
  isAlreadyProcessed, markProcessed, buildTestPayload,
} = require('./instagram');
const store = require('./store');
const { getDashboard, getAnalytics } = store;

const PORT       = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const STORAGE_DIR = path.join(__dirname, 'storage');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

const LOG_FILE = path.join(STORAGE_DIR, 'backend.log');
const ERROR_FILE = path.join(STORAGE_DIR, 'backend-errors.log');

function appendLog(filePath, entry) {
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function logInfo(message, meta = {}) {
  appendLog(LOG_FILE, {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    message,
    ...meta,
  });
}

function logError(message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message,
    ...meta,
  };
  appendLog(ERROR_FILE, entry);
  appendLog(LOG_FILE, entry);
}

// ── Rate limiting & security ────────────────────────────────────────────────
const rateLimitMap = new Map(); // { key: [timestamp, count] }
const accountLockoutMap = new Map(); // { email: lockedUntil }
const csrfTokens = new Map(); // { token: expiry }
const AFFILIATE_DOMAINS = ['amazon.in', 'amazon.com', 'flipkart.com', 'myntra.com', 'meesho.com'];

function generateCsrfToken() {
  const token = crypto.randomBytes(32).toString('hex');
  csrfTokens.set(token, Date.now() + 60 * 60 * 1000); // 1 hour expiry
  return token;
}

function verifyCsrfToken(token) {
  const expiry = csrfTokens.get(token);
  if (!expiry || Date.now() > expiry) {
    csrfTokens.delete(token);
    return false;
  }
  csrfTokens.delete(token); // Tokens are single-use
  return true;
}

function rateLimit(key, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const entry = rateLimitMap.get(key) || [now, 0];
  const [windowStart, count] = entry;
  
  if (now - windowStart > windowMs) {
    rateLimitMap.set(key, [now, 1]);
    return true;
  }
  
  if (count >= maxAttempts) return false;
  rateLimitMap.set(key, [windowStart, count + 1]);
  return true;
}

function checkAccountLockout(email) {
  const lockedUntil = accountLockoutMap.get(email);
  if (!lockedUntil) return false;
  if (Date.now() > lockedUntil) {
    accountLockoutMap.delete(email);
    return false;
  }
  return true;
}

function lockAccount(email, durationMs = 30 * 60 * 1000) {
  accountLockoutMap.set(email, Date.now() + durationMs);
}

// ── Input validation & sanitization ────────────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return String(str)
    .replace(/[<>]/g, '')
    .trim()
    .substring(0, 500);
}

function validateEmail(email) {
  return /^\S+@\S+\.\S+$/.test(String(email || '').toLowerCase());
}

function validateUrl(url, allowedDomains = AFFILIATE_DOMAINS) {
  try {
    const u = new URL(url);
    return allowedDomains.some(domain => u.hostname.includes(domain));
  } catch {
    return false;
  }
}

// ── Email sending (Mailgun) ────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  try {
    if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) {
      console.log(`[MAIL] Demo mode: Email would be sent to ${to}: ${subject}`);
      return { success: true, mock: true };
    }
    
    const messageData = {
      from: process.env.MAILGUN_FROM_EMAIL || `noreply@${process.env.MAILGUN_DOMAIN}`,
      to: to,
      subject: subject,
      html: html,
    };
    
    const result = await mg.messages.create(process.env.MAILGUN_DOMAIN, messageData);
    console.log(`[MAIL] Email sent: ${to} - ${subject}`);
    return { success: true, id: result.id };
  } catch (error) {
    console.error(`[MAIL] Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

function sendJsonWithHeaders(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  res.end(JSON.stringify(data));
}

function sendJson(res, status, data) {
  sendJsonWithHeaders(res, status, data);
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

async function requireCreator(req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user  = await store.userForToken(token);
  if (!user) { sendJson(res, 401, { error: 'Creator sign-in required.' }); return null; }
  return user;
}

async function publicSettings() {
  const settings = await store.getSettings();
  return {
    ...settings,
    metaConfigured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_INSTAGRAM_ACCOUNT_ID),
    mappings: await mappingRows(),
  };
}

function parseMultipart(body, boundary) {
  const parts = body.toString('binary').split('--' + boundary);
  for (const part of parts) {
    const match = part.match(/Content-Disposition:[^\r\n]*filename="([^"]+)"[\s\S]*?\r\n\r\n([\s\S]*)\r\n$/);
    if (!match) continue;
    const filename = `${Date.now()}-${match[1].replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, filename), Buffer.from(match[2], 'binary'));
    return filename;
  }
  return null;
}

async function resolveReel(job) {
  const settings = await store.getSettings();
  const byMedia  = await getReelByInstagramMediaId(job.mediaId);
  if (byMedia) return byMedia;
  const remembered = await store.lastReelForUser(job.senderId);
  if (remembered) return getReel(remembered);
  return getReel(settings.fallbackSlug);
}

async function handleJob(job) {
  // Idempotency — skip if already processed
  if (job.eventId && await isAlreadyProcessed(job.eventId)) {
    await store.logEvent('Duplicate skipped', job.eventId);
    return;
  }

  const settings = await store.getSettings();
  if (!settings.enabled)                                 { await store.logEvent('Automation off', job.text || job.kind); return; }
  if (job.kind === 'comment' && !settings.replyComments) { await store.logEvent('Comment replies disabled', job.text || ''); return; }
  if (job.kind === 'dm'      && !settings.replyDms)      { await store.logEvent('DM replies disabled', job.text || ''); return; }
  if (!matchesTrigger(job.text, settings.triggers))      { await store.logEvent(`${job.kind} ignored`, job.text || 'No text'); return; }

  const reel = await resolveReel(job);
  if (!reel) { await store.logEvent('Reel not mapped', job.mediaId || 'No media ID'); return; }
  if (job.senderId) await store.rememberUserReel(job.senderId, reel.slug);

  const dmMessage = applyTemplate(settings.replyTemplate, {
    name: job.username, url: reelUrl(reel.slug), title: reel.title,
  });

  if (job.kind === 'comment') {
    if (!job.commentId) { await store.logEvent('Reply skipped', 'No comment ID'); return; }
    try {
      await sendPublicCommentReply(job.commentId, 'Link has been sent to your DM! 📩');
      await store.logEvent('Comment public reply sent', reel.slug);
    } catch (e) { await store.logEvent('Comment public reply failed', e.message); }
    if (!job.senderId) { await store.logEvent('DM skipped', 'No sender ID'); return; }
    const r = await sendDirectMessage(job.senderId, dmMessage);
    await store.logEvent(r.sent ? 'DM sent after comment' : 'DM queued (Meta not configured)', r.sent ? reel.slug : r.reason);
    await markProcessed(job.eventId, 'comment');
    return;
  }

  if (!job.senderId) { await store.logEvent('DM skipped', 'No sender ID'); return; }
  const r = await sendDirectMessage(job.senderId, dmMessage);
  await store.logEvent(r.sent ? 'Instagram DM sent' : 'DM queued (Meta not configured)', r.sent ? reel.slug : r.reason);
  await markProcessed(job.eventId, 'dm');
}

async function handleInstagramWebhook(req, res) {
  const raw = (await readBody(req)).toString('utf8');
  if (!validSignature(raw, req.headers['x-hub-signature-256'], process.env.META_APP_SECRET))
    return sendJson(res, 403, { error: 'Invalid webhook signature' });
  const payload = parseJson(raw);
  if (!payload) return sendJson(res, 400, { error: 'Invalid JSON' });
  sendJson(res, 200, { received: true });
  for (const job of collectIncoming(payload)) {
    try { await handleJob(job); } catch (e) { await store.logEvent('Instagram reply failed', e.message); }
  }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      });
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
      if (!await requireCreator(req, res)) return;
      const body     = await readBody(req);
      const boundary = (req.headers['content-type'] || '').split('boundary=')[1];
      if (!boundary) return sendJson(res, 400, { error: 'Missing multipart boundary' });
      const filename = parseMultipart(body, boundary);
      if (!filename)  return sendJson(res, 400, { error: 'No file found in upload' });
      return sendJson(res, 200, {
        url: `${process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`}/uploads/${filename}`,
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
      const file = path.normalize(path.join(UPLOAD_DIR, url.pathname.replace('/uploads/', '')));
      if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200);
      return fs.createReadStream(file).pipe(res);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const data = parseJson((await readBody(req)).toString()) || {};
      const email = String(data.email || '').toLowerCase();
      
      // Rate limit registrations (3 per hour per IP)
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      if (!rateLimit(`register:${clientIp}`, 3, 60 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many registration attempts. Try again later.' });
      }
      
      if (!data.name || !data.handle || !/^\S+@\S+\.\S+$/.test(email) || String(data.password || '').length < 8)
        return sendJson(res, 400, { error: 'Name, handle, valid email, and 8-character password are required.' });
      try {
        const user  = await store.createUser(data);
        const token = await store.createSession(user.id);
        
        // Send verification email via Mailgun
        const verifyLink = `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/verify-email?token=${user.email_verification_token || 'demo'}`;
        const emailHtml = `
          <h2>Verify Your Email</h2>
          <p>Welcome to Dream4Deals, ${data.name}!</p>
          <p>Click the link below to verify your email:</p>
          <a href="${verifyLink}">Verify Email</a>
          <p>This link expires in 24 hours.</p>
        `;
        
        await sendEmail(email, 'Dream4Deals - Verify Your Email', emailHtml);
        
        return sendJson(res, 201, { user, token });
      } catch (e) { return sendJson(res, 409, { error: e.message }); }
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const data = parseJson((await readBody(req)).toString()) || {};
      const email = String(data.email || '').toLowerCase();
      
      // Check rate limit (5 attempts per 15 min)
      if (!rateLimit(`login:${email}`, 5, 15 * 60 * 1000)) {
        lockAccount(email, 30 * 60 * 1000);
        return sendJson(res, 429, { error: 'Too many failed attempts. Account locked for 30 minutes.' });
      }
      
      // Check account lockout
      if (checkAccountLockout(email)) {
        return sendJson(res, 429, { error: 'Account locked. Try again in 30 minutes.' });
      }
      
      const user = await store.authenticate(email, data.password);
      if (!user) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
      
      // Clear rate limit on successful login
      rateLimitMap.delete(`login:${email}`);
      return sendJson(res, 200, { user, token: await store.createSession(user.id) });
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user  = await store.userForToken(token);
      return user ? sendJson(res, 200, { user }) : sendJson(res, 401, { error: 'Sign in required.' });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (token) await store.logout(token);
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/password-reset-request') {
      const data = parseJson((await readBody(req)).toString()) || {};
      if (!data.email) return sendJson(res, 400, { error: 'Email required.' });
      
      // Rate limit password reset requests (3 per hour per email)
      if (!rateLimit(`reset:${data.email}`, 3, 60 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many password reset attempts. Try again later.' });
      }
      
      const token = await store.requestPasswordReset(data.email);
      if (!token) return sendJson(res, 404, { error: 'Email not found.' });
      
      // Send reset email via Mailgun
      const resetLink = `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/reset-password?token=${token}`;
      const emailHtml = `
        <h2>Password Reset Request</h2>
        <p>Click the link below to reset your password:</p>
        <a href="${resetLink}">Reset Password</a>
        <p>This link expires in 1 hour.</p>
        <p>If you didn't request this, ignore this email.</p>
      `;
      
      await sendEmail(data.email, 'Dream4Deals - Password Reset', emailHtml);
      return sendJson(res, 200, { message: 'Password reset email sent.' });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/password-reset') {
      const data = parseJson((await readBody(req)).toString()) || {};
      if (!data.token || !data.password) return sendJson(res, 400, { error: 'Token and password required.' });
      const userId = await store.resetPassword(data.token, data.password);
      if (!userId) return sendJson(res, 400, { error: 'Invalid or expired reset token.' });
      return sendJson(res, 200, { message: 'Password reset successfully.' });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') {
      const data = parseJson((await readBody(req)).toString()) || {};
      if (!data.token) return sendJson(res, 400, { error: 'Verification token required.' });
      const ok = await store.verifyEmail(data.token);
      if (!ok) return sendJson(res, 400, { error: 'Invalid or expired verification token.' });
      return sendJson(res, 200, { message: 'Email verified successfully.' });
    }

    // ── Instagram OAuth (New) ──────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/auth/instagram-oauth-url') {
      const appId = process.env.META_APP_ID;
      const frontendBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
      const redirectUri = `${frontendBaseUrl.replace(/\/$/, '')}/auth/instagram-callback`;
      const scope = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
      
      const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code`;
      logInfo('Instagram OAuth URL generated', { redirectUri, appIdPresent: Boolean(appId) });
      
      return sendJson(res, 200, { oauth_url: oauthUrl });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/instagram-callback') {
      const data = parseJson((await readBody(req)).toString()) || {};
      if (!data.code) {
        logError('Instagram callback missing authorization code', { headers: req.headers, body: data });
        return sendJson(res, 400, { error: 'Authorization code required.' });
      }
      
      try {
        // Get user from bearer token (creator must be signed in)
        const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        const user = await store.userForToken(token);
        if (!user) {
          logError('Instagram callback called without valid session', { tokenPresent: Boolean(token) });
          return sendJson(res, 401, { error: 'Please sign in first.' });
        }
        
        // Exchange authorization code for Instagram access token
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        const frontendBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
        const redirectUri = `${frontendBaseUrl.replace(/\/$/, '')}/auth/instagram-callback`;
        logInfo('Instagram callback start', { userId: user.id, redirectUri, appIdPresent: Boolean(appId), appSecretPresent: Boolean(appSecret) });
        
        const response = await fetch('https://graph.instagram.com/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: appId,
            client_secret: appSecret,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code: data.code
          }).toString()
        });
        
        const tokenData = await response.json();
        if (!response.ok || !tokenData.access_token) {
          logError('Instagram token exchange failed', {
            status: response.status,
            tokenData,
            redirectUri,
            userId: user.id,
          });
          throw new Error(tokenData.error_description || 'Failed to exchange authorization code');
        }
        
        // Save Instagram token for this creator
        await store.createInstagramToken(user.id, tokenData.access_token);
        logInfo('Instagram token saved successfully', { userId: user.id });
        
        return sendJson(res, 200, { message: 'Instagram connected successfully.' });
      } catch (e) {
        logError('Instagram callback error', {
          message: e.message,
          stack: e.stack,
          userId: (await store.userForToken(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')))?.id,
        });
        return sendJson(res, 400, { error: e.message });
      }
    }

    if (req.method === 'GET' && url.pathname === '/api/creator/instagram-posts') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = await store.userForToken(token);
      if (!user) return sendJson(res, 401, { error: 'Sign in required.' });
      
      try {
        // Fetch creator's Instagram posts from Meta API
        const igToken = await store.getInstagramToken(user.id);
        if (!igToken) return sendJson(res, 400, { error: 'Instagram not connected. Please connect your account.' });
        
        // Using demo data for now (will integrate with Meta API)
        const posts = await store.getCreatorInstagramPosts(user.id);
        return sendJson(res, 200, { posts });
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }

    // ── Sync Instagram posts from Meta API ──────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/creator/sync-instagram-posts') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = await store.userForToken(token);
      if (!user) return sendJson(res, 401, { error: 'Sign in required.' });
      
      try {
        const igToken = await store.getInstagramToken(user.id);
        if (!igToken) return sendJson(res, 400, { error: 'Instagram not connected.' });
        
        const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID;
        const metaAccessToken = process.env.META_ACCESS_TOKEN;
        
        // Fetch posts from Meta API
        const response = await fetch(
          `https://graph.instagram.com/${accountId}/media?fields=id,caption,media_type,media_url&access_token=${metaAccessToken}`
        );
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error?.message || 'Failed to fetch Instagram posts');
        }
        
        const data = await response.json();
        if (!data.data) return sendJson(res, 400, { error: 'No posts found.' });
        
        // Save posts to database
        await store.syncInstagramPosts(user.id, data.data);
        
        const posts = await store.getCreatorInstagramPosts(user.id);
        return sendJson(res, 200, { synced: data.data.length, posts });
      } catch (e) {
        logError('Instagram sync error', {
          message: e.message,
          stack: e.stack,
          userId: user.id,
        });
        return sendJson(res, 400, { error: e.message });
      }
    }

    // ── Dashboard ──────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/dashboard') {
      const user = await requireCreator(req, res); if (!user) return;
      return sendJson(res, 200, await getDashboard(user.id));
    }

    if (req.method === 'GET' && url.pathname === '/api/analytics') {
      const user = await requireCreator(req, res); if (!user) return;
      return sendJson(res, 200, await getAnalytics(user.id));
    }

    if (req.method === 'GET' && url.pathname === '/api/activity') {
      const user = await requireCreator(req, res); if (!user) return;
      return sendJson(res, 200, await store.getActivityFeed(user.id));
    }

    // ── Creator profile ───────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/creator/profile') {
      const user = await requireCreator(req, res); if (!user) return;
      return sendJson(res, 200, await store.getCreator(user.id));
    }
    if (req.method === 'POST' && url.pathname === '/api/creator/profile') {
      const user = await requireCreator(req, res); if (!user) return;
      const data = parseJson((await readBody(req)).toString()) || {};
      return sendJson(res, 200, await store.saveCreator(user.id, {
        name: String(data.name || '').trim(),
        handle: String(data.handle || '').trim(),
        bio: String(data.bio || '').trim(),
      }));
    }

    // ── Reels ─────────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/reels')
      return sendJson(res, 200, await mappingRows());

    if (req.method === 'GET' && /^\/api\/reels\/[^/]+$/.test(url.pathname)) {
      const slug = url.pathname.split('/')[3];
      const reel = await getReel(slug);
      if (!reel) return sendJson(res, 404, { error: 'Reel not found' });
      return sendJson(res, 200, reel);
    }

    if (req.method === 'POST' && url.pathname === '/api/reels') {
      const user = await requireCreator(req, res); if (!user) return;
      const data = parseJson((await readBody(req)).toString()) || {};
      const slug = String(data.slug || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!slug || !data.title || !data.instagramMediaId)
        return sendJson(res, 400, { error: 'Instagram media ID, title, and slug are required.' });
      if (await getReel(slug) || await getReelByInstagramMediaId(data.instagramMediaId))
        return sendJson(res, 409, { error: 'That reel URL or Instagram media ID already exists.' });
      const reel = await addReel({
        slug, instagramMediaId: String(data.instagramMediaId),
        title: String(data.title), caption: String(data.caption || ''),
        poster: String(data.poster || ''), videoUrl: '', creatorId: user.id,
      });
      await store.logEvent('Reel created', reel.slug);
      return sendJson(res, 201, { ...reel, url: reelUrl(reel.slug) });
    }

    if (req.method === 'PATCH' && /^\/api\/reels\/[^/]+$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const slug = url.pathname.split('/')[3];
      const data = parseJson((await readBody(req)).toString()) || {};
      const reel = await updateReel(slug, data);
      if (!reel) return sendJson(res, 404, { error: 'Reel not found.' });
      await store.logEvent('Reel updated', slug);
      return sendJson(res, 200, reel);
    }

    if (req.method === 'DELETE' && /^\/api\/reels\/[^/]+$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const slug = url.pathname.split('/')[3];
      if (!await deleteReel(slug)) return sendJson(res, 404, { error: 'Reel not found.' });
      await store.logEvent('Reel deleted', slug);
      return sendJson(res, 200, { ok: true });
    }

    // ── Products ──────────────────────────────────────────────────────────────
    if (req.method === 'POST' && /^\/api\/reels\/[^/]+\/products$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const slug = url.pathname.split('/')[3];
      const body = await readBody(req);
      const data = parseJson(body.toString()) || {};
      
      // Handle new format with products array and seller_links
      if (Array.isArray(data.products)) {
        // Validate all products
        for (const product of data.products) {
          // Validate product fields
          if (!product.name || !product.imageUrl) {
            return sendJson(res, 400, { error: 'Product name and image URL are required.' });
          }
          
          // Validate seller links
          if (!product.sellerLinks || product.sellerLinks.length === 0) {
            return sendJson(res, 400, { error: 'At least 1 seller link is required per product.' });
          }
          
          if (product.sellerLinks.length > 10) {
            return sendJson(res, 400, { error: 'Maximum 10 seller links allowed per product.' });
          }
          
          // Validate each seller link
          for (const link of product.sellerLinks) {
            if (!link.url) {
              return sendJson(res, 400, { error: 'Seller link URL is required.' });
            }
            
            // Validate URL format and domain
            if (!validateUrl(link.url)) {
              return sendJson(res, 400, { error: 'Seller link must be HTTPS and from approved domains (Amazon, Flipkart, Meesho, Myntra).' });
            }
            
            // Ensure HTTPS
            try {
              const u = new URL(link.url);
              if (u.protocol !== 'https:') {
                return sendJson(res, 400, { error: 'All seller links must use HTTPS protocol.' });
              }
            } catch {
              return sendJson(res, 400, { error: 'Invalid seller link URL.' });
            }
          }
        }
        
        // All validation passed - save products
        // For now, just acknowledge the save
        await store.logEvent('Products saved', `${slug} - ${data.products.length} products`);
        return sendJson(res, 201, { ok: true, saved: data.products.length });
      }
      
      // Handle old format for backward compatibility
      const id   = String(data.id || data.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id || !data.name || !data.category || !Number.isFinite(Number(data.price)) || !data.image)
        return sendJson(res, 400, { error: 'Product name, category, price, and image URL are required.' });
      const product = await addProduct(slug, { id, name: String(data.name), category: String(data.category), price: Number(data.price), image: String(data.image) });
      if (!product) return sendJson(res, 404, { error: 'Reel not found.' });
      await store.logEvent('Product tagged', `${slug} - ${product.name}`);
      return sendJson(res, 201, product);
    }

    if (req.method === 'PATCH' && /^\/api\/reels\/[^/]+\/products\/[^/]+$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const parts = url.pathname.split('/');
      const slug = parts[3]; const productId = parts[5];
      const data = parseJson((await readBody(req)).toString()) || {};
      const product = await updateProduct(slug, productId, data);
      if (!product) return sendJson(res, 404, { error: 'Reel or product not found.' });
      await store.logEvent('Product updated', `${slug} - ${product.name}`);
      return sendJson(res, 200, product);
    }

    if (req.method === 'DELETE' && /^\/api\/reels\/[^/]+\/products\/[^/]+$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const parts = url.pathname.split('/');
      const slug = parts[3]; const productId = parts[5];
      if (!await deleteProduct(slug, productId)) return sendJson(res, 404, { error: 'Reel or product not found.' });
      await store.logEvent('Product deleted', `${slug} - ${productId}`);
      return sendJson(res, 200, { ok: true });
    }

    // ── Platforms ─────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/platforms')
      return sendJson(res, 200, await getPlatforms());

    // ── Offers ────────────────────────────────────────────────────────────────
    if (req.method === 'GET' && /^\/api\/offers\/product\/[^/]+$/.test(url.pathname)) {
      const productId = url.pathname.split('/').pop();
      return sendJson(res, 200, await getOffersRaw(productId));
    }

    if (req.method === 'POST' && /^\/api\/offers\/product\/[^/]+$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const productId = url.pathname.split('/').pop();
      const data = parseJson((await readBody(req)).toString()) || {};
      if (!data.platformId || !data.seller || !Number.isFinite(Number(data.price)))
        return sendJson(res, 400, { error: 'Platform, seller, and price are required.' });
      const offer = await addOffer(productId, { ...data, price: Number(data.price) });
      await store.logEvent('Offer added', `${productId} - ${data.seller}`);
      return sendJson(res, 201, offer);
    }

    if (req.method === 'PATCH' && /^\/api\/offers\/[^/]+$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const offerId = url.pathname.split('/').pop();
      const data = parseJson((await readBody(req)).toString()) || {};
      const offer = await updateOffer(offerId, data);
      if (!offer) return sendJson(res, 404, { error: 'Offer not found.' });
      return sendJson(res, 200, offer);
    }

    if (req.method === 'DELETE' && /^\/api\/offers\/[^/]+$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const offerId = url.pathname.split('/').pop();
      if (!await deleteOffer(offerId)) return sendJson(res, 404, { error: 'Offer not found.' });
      return sendJson(res, 200, { ok: true });
    }

    // ── Redirect / click ──────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/redirect') {
      const target = url.searchParams.get('url') || '';
      if (!/^https?:\/\//i.test(target)) return sendJson(res, 400, { error: 'Invalid shopping URL' });
      
      // Validate redirect domain against allowlist
      if (!validateUrl(target, AFFILIATE_DOMAINS)) {
        return sendJson(res, 400, { error: 'Redirect destination not allowed. Only approved retailers are supported.' });
      }
      
      await store.logEvent('Shopping redirect', `${url.searchParams.get('platform') || 'Store'} → ${url.searchParams.get('product') || 'Product'}`);
      res.writeHead(302, { Location: target });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/api/click') {
      const data = parseJson((await readBody(req)).toString()) || {};
      await store.logClick({ reelSlug: data.reelSlug, productId: data.product, platform: data.platform, seller: data.seller });
      await store.logEvent('Shopping click', `${data.platform || 'Store'} → ${data.seller || ''} → ${data.product || 'Product'}`);
      return sendJson(res, 200, { ok: true });
    }

    // ── Events / automation ───────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/events')
      return sendJson(res, 200, await store.listEvents());

    if (req.method === 'GET' && url.pathname === '/api/automation')
      return sendJson(res, 200, await publicSettings());

    if (req.method === 'POST' && url.pathname === '/api/automation') {
      const data = parseJson((await readBody(req)).toString()) || {};
      const saved = await store.saveSettings(data);
      return sendJson(res, 200, { ...saved, mappings: await mappingRows() });
    }

    // ── Per-reel automation rules ──────────────────────────────────────────────
    const reelAutomationMatch = url.pathname.match(/^\/api\/reels\/([^/]+)\/automation$/);
    if (reelAutomationMatch) {
      const reelSlug = decodeURIComponent(reelAutomationMatch[1]);
      if (req.method === 'GET') {
        const user = await requireCreator(req, res); if (!user) return;
        const rule = await store.getReelAutomation(user.id, reelSlug);
        return sendJson(res, 200, rule || {});
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const user = await requireCreator(req, res); if (!user) return;
        const data = parseJson((await readBody(req)).toString()) || {};
        const saved = await store.saveReelAutomation(user.id, reelSlug, data);
        return sendJson(res, 200, saved);
      }
      if (req.method === 'DELETE') {
        const user = await requireCreator(req, res); if (!user) return;
        await store.deleteReelAutomation(user.id, reelSlug);
        return sendJson(res, 200, { ok: true });
      }
    }

    // ── Local webhook test simulator (dev only) ──────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/webhooks/test') {
      const data = parseJson((await readBody(req)).toString()) || {};
      const payload = buildTestPayload({
        kind:      data.kind || 'comment',
        text:      data.text || 'link',
        mediaId:   data.mediaId || '178923456',
        commentId: data.commentId || `sim-${Date.now()}`,
        senderId:  data.senderId || 'sim-sender-001',
        username:  data.username || 'testuser',
      });
      for (const job of collectIncoming(payload)) {
        try { await handleJob(job); } catch (e) { await store.logEvent('Test sim failed', e.message); }
      }
      return sendJson(res, 200, { simulated: true, payload });
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (e) {
    logError('Unhandled server error', {
      message: e.message,
      stack: e.stack,
      method: req.method,
      url: req.url,
    });
    sendJson(res, 500, { error: e.message || 'Server error' });
  }
}).listen(PORT, () => {
  logInfo('Dream4Deals backend running', {
    port: PORT,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    frontendBaseUrl: process.env.FRONTEND_BASE_URL,
  });
  console.log(`Dream4Deals backend running at http://localhost:${PORT}`);
});
