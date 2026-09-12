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
  collectIncoming, sendPublicCommentReply, sendPrivateCommentReply, sendDirectMessage,
  isAlreadyProcessed, claimEvent, markProcessed, buildTestPayload,
} = require('./instagram');
const store = require('./store');
const { ensureInstagramSubscriptions } = require('./instagram-subscriptions');
const { startCommentRecovery } = require('./comment-recovery');
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
    ...meta,
    ...(meta.message ? { errorMessage: meta.message } : {}),
    message,
  });
}

function logError(message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    ...meta,
    ...(meta.message ? { errorMessage: meta.message } : {}),
    message,
  };
  appendLog(ERROR_FILE, entry);
  appendLog(LOG_FILE, entry);
}

// ── Rate limiting & security ────────────────────────────────────────────────
const rateLimitMap = new Map(); // { key: [timestamp, count] }
const accountLockoutMap = new Map(); // { email: lockedUntil }
const csrfTokens = new Map(); // { token: expiry }
const instagramOAuthStates = new Map(); // { state: expiry }
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
  logInfo('Instagram automation job received', {
    kind: job.kind,
    eventId: job.eventId,
    mediaId: job.mediaId,
    source: job.source || (job.testMode ? 'simulation' : 'webhook'),
    eventIdPresent: Boolean(job.eventId),
    mediaIdPresent: Boolean(job.mediaId),
    senderIdPresent: Boolean(job.senderId),
    textLength: String(job.text || '').length,
    testMode: Boolean(job.testMode),
  });
  // Idempotency — skip if already processed
  if (job.eventId && !(await claimEvent(job.eventId, job.testMode ? `test-${job.kind}` : job.kind))) {
    await store.logEvent('Duplicate skipped', job.eventId);
    logInfo('Instagram automation skipped: duplicate event', { kind: job.kind });
    return { status: 'duplicate' };
  }

  const reel = await resolveReel(job);
  if (!reel) { await store.logEvent('Reel not mapped', job.mediaId || 'No media ID'); return; }
  const reelRule = reel.creatorId
    ? await store.getReelAutomation(reel.creatorId, reel.slug)
    : null;
  const settings = reelRule || await store.getSettings();
  logInfo('Instagram automation rule selected', {
    reelSlug: reel.slug,
    perReelRule: Boolean(reelRule),
    enabled: Boolean(settings.enabled),
  });
  const creatorHandle = String(reel.creator?.handle || '').replace(/^@/, '').toLowerCase();
  const senderUsername = String(job.username || '').replace(/^@/, '').toLowerCase();
  const authoredByCreator =
    (reel.creatorInstagramUserId && String(job.senderId || '') === String(reel.creatorInstagramUserId)) ||
    (creatorHandle && senderUsername && creatorHandle === senderUsername);
  if (job.kind === 'comment' && authoredByCreator) {
    await store.logEvent('Creator comment ignored', reel.slug);
    logInfo('Instagram automation skipped: creator-authored comment', { reelSlug: reel.slug });
    return { status: 'creator_comment_ignored', reelSlug: reel.slug };
  }
  if (!settings.enabled)                                 { await store.logEvent('Automation off', job.kind); return { status: 'automation_off' }; }
  if (job.kind === 'comment' && !settings.replyComments) { await store.logEvent('Comment replies disabled', reel.slug); return { status: 'comments_disabled' }; }
  if (job.kind === 'dm'      && !settings.replyDms)      { await store.logEvent('DM replies disabled', reel.slug); return { status: 'dms_disabled' }; }
  if (!matchesTrigger(job.text, settings.triggers))      { await store.logEvent(`${job.kind} ignored`, 'Trigger not matched'); return { status: 'trigger_not_matched' }; }
  if (job.senderId) await store.rememberUserReel(job.senderId, reel.slug);

  const dmMessage = applyTemplate(settings.replyTemplate, {
    name: job.username, url: reelUrl(reel.slug), title: reel.title,
  });
  if (job.testMode) {
    await store.logEvent('Automation test passed', `${job.kind} -> ${reel.slug}`);
    logInfo('Instagram automation rule simulation passed', { kind: job.kind, reelSlug: reel.slug, deliveryTested: false });
    return { status: 'simulated', reelSlug: reel.slug };
  }
  const creatorToken = reel.creatorId ? await store.getInstagramToken(reel.creatorId) : null;
  const connection = { accountId: reel.creatorInstagramUserId, accessToken: creatorToken };
  if (!creatorToken || !reel.creatorInstagramUserId) {
    await store.logEvent('Automation connection missing', reel.slug);
    logInfo('Instagram automation skipped: creator connection missing', { reelSlug: reel.slug });
    return { status: 'creator_connection_missing', reelSlug: reel.slug };
  }

  if (job.kind === 'comment') {
    const context = { eventId: job.eventId, commentId: job.commentId, mediaId: job.mediaId, reelSlug: reel.slug, accountId: connection.accountId };
    if (!job.commentId) {
      logInfo('Instagram private reply skipped: missing comment ID', context);
      return { status: 'missing_comment_id', reelSlug: reel.slug };
    }

    const started = Date.now();
    logInfo('Instagram private reply requested', { ...context, textLength: dmMessage.length });

    let privateResult = null;
    try {
      privateResult = await sendPrivateCommentReply(job.commentId, dmMessage, connection);
      if (privateResult.sent) {
        logInfo('Instagram private reply accepted by Meta', { ...context, messageId: privateResult.data?.message_id, recipientId: privateResult.data?.recipient_id, durationMs: Date.now() - started });
        await store.logEvent('DM sent after comment', reel.slug);
      } else {
        logError('Instagram private reply not sent', { ...context, reason: privateResult.reason });
        await store.logEvent('DM after comment not sent', privateResult.reason);
      }
    } catch (e) {
      logError('Instagram private reply failed', { ...context, ...e.meta, errorMessage: e.message, durationMs: Date.now() - started });
      await store.logEvent('DM after comment failed', e.message);
    }

    // Always attempt the public comment reply so the commenter still receives a
    // visible confirmation even when Meta rejects the private DM for a non-follower.
    try {
      logInfo('Instagram public reply requested', context);
      const reply = await sendPublicCommentReply(job.commentId, 'Link sent! Check your DMs or Message Requests.', connection.accessToken);
      if (!reply.sent) throw new Error(reply.reason);
      logInfo('Instagram public reply accepted by Meta', { ...context, replyId: reply.data?.id });
      await store.logEvent('Comment public reply sent', reel.slug);
      return { status: 'sent', publicReply: 'sent', reelSlug: reel.slug };
    } catch (e) {
      logError('Instagram public reply failed', { ...context, ...e.meta, errorMessage: e.message });
      await store.logEvent('Comment public reply failed', e.message);
      return { status: privateResult?.sent ? 'sent' : 'dm_failed', publicReply: 'failed', reelSlug: reel.slug };
    }
  }

  if (!job.senderId) { await store.logEvent('DM skipped', 'No sender ID'); return; }
  try {
    const r = await sendDirectMessage(job.senderId, dmMessage, connection);
    await store.logEvent(r.sent ? 'Instagram DM sent' : 'DM queued (Meta not configured)', r.sent ? reel.slug : r.reason);
    return { status: r.sent ? 'sent' : 'not_sent', reelSlug: reel.slug };
  } catch (e) {
    logError('Instagram DM failed', { errorMessage: e.message, ...e.meta, eventId: job.eventId, reelSlug: reel.slug });
    await store.logEvent('Instagram DM failed', e.message);
    return { status: 'dm_failed', reelSlug: reel.slug };
  }
}

async function handleInstagramWebhook(req, res) {
  const raw = (await readBody(req)).toString('utf8');
  logInfo('Instagram webhook received', { bytes: Buffer.byteLength(raw), signaturePresent: Boolean(req.headers['x-hub-signature-256']) });
  if (!validSignature(raw, req.headers['x-hub-signature-256'], process.env.META_APP_SECRET)) {
    logError('Instagram webhook rejected: invalid signature');
    return sendJson(res, 403, { error: 'Invalid webhook signature' });
  }
  const payload = parseJson(raw);
  if (!payload || !Array.isArray(payload.entry)) {
    logError('Instagram webhook rejected: invalid payload');
    return sendJson(res, 400, { error: 'Invalid webhook payload' });
  }
  sendJson(res, 200, { received: true });
  const jobs = collectIncoming(payload);
  logInfo('Instagram webhook accepted', { jobs: jobs.length, object: payload.object,
    accountIds: payload.entry.map(entry => entry.id),
    fields: [...new Set(payload.entry.flatMap(entry => (entry.changes || []).map(change => change.field)))],
    messagingEvents: payload.entry.reduce((count, entry) => count + (entry.messaging || []).length, 0),
  });
  for (const job of jobs) {
    try {
      const result = await handleJob(job);
      logInfo('Instagram automation job completed', { kind: job.kind, eventId: job.eventId, ...result });
    } catch (e) {
      logError('Instagram automation job failed', { errorMessage: e.message, ...e.meta, kind: job.kind, eventId: job.eventId });
      await store.logEvent('Instagram reply failed', e.message);
    }
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
      logInfo('Instagram webhook verification', { accepted: valid });
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
      if (!appId) return sendJson(res, 503, { error: 'Instagram OAuth is not configured.' });
      const frontendBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
      const redirectUri = `${frontendBaseUrl.replace(/\/$/, '')}/auth/instagram-callback`;
      const scope = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
      const state = crypto.randomBytes(32).toString('hex');
      const now = Date.now();
      for (const [key, expiresAt] of instagramOAuthStates) {
        if (expiresAt <= now) instagramOAuthStates.delete(key);
      }
      instagramOAuthStates.set(state, now + 10 * 60 * 1000);
      
      const oauthUrl = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&response_type=code&state=${state}`;
      logInfo('Instagram OAuth URL generated', { redirectUri, appIdPresent: Boolean(appId) });
      
      return sendJson(res, 200, { oauth_url: oauthUrl });
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/instagram-callback') {
      const data = parseJson((await readBody(req)).toString()) || {};
      logInfo('Instagram callback request received', {
        codePresent: Boolean(data.code),
        statePresent: Boolean(data.state),
        originPresent: Boolean(req.headers.origin),
      });
      if (!data.code) {
        logError('Instagram callback missing authorization code');
        return sendJson(res, 400, { error: 'Authorization code required.' });
      }
      const state = String(data.state || '');
      const expiresAt = instagramOAuthStates.get(state);
      instagramOAuthStates.delete(state);
      if (!expiresAt || expiresAt < Date.now()) {
        logInfo('Instagram callback rejected: invalid or expired state');
        return sendJson(res, 400, { error: 'This Instagram connection request expired. Please try again.' });
      }
      
      try {
        // Exchange authorization code for Instagram access token
        const appId = process.env.META_APP_ID;
        const appSecret = process.env.META_APP_SECRET;
        const frontendBaseUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
        const redirectUri = `${frontendBaseUrl.replace(/\/$/, '')}/auth/instagram-callback`;
        logInfo('Instagram callback start', { redirectUri, appIdPresent: Boolean(appId), appSecretPresent: Boolean(appSecret) });
        
        // Instagram Login authorization codes are exchanged on api.instagram.com.
        // graph.instagram.com is used only after an Instagram User token is issued.
        const response = await fetch('https://api.instagram.com/oauth/access_token', {
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
          });
          throw new Error(tokenData.error_description || 'Failed to exchange authorization code');
        }
        logInfo('Instagram authorization code exchanged successfully');

        const longLivedTokenResponse = await fetch(
          `https://graph.instagram.com/v25.0/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(tokenData.access_token)}`
        );
        const longLivedTokenData = await longLivedTokenResponse.json();

        if (!longLivedTokenResponse.ok || !longLivedTokenData.access_token) {
          throw new Error(longLivedTokenData.error?.message || 'Failed to upgrade Instagram access token.');
        }

        const finalAccessToken = longLivedTokenData.access_token;
        logInfo('Instagram long-lived token acquired successfully', {
          expiresIn: longLivedTokenData.expires_in,
          tokenExpiresInSeconds: longLivedTokenData.expires_in,
        });

        const profileResponse = await fetch(
          `https://graph.instagram.com/v25.0/me?fields=id,username&access_token=${encodeURIComponent(finalAccessToken)}`
        );
        const profile = await profileResponse.json();
        if (!profileResponse.ok || !(profile.id || profile.user_id)) {
          throw new Error(profile.error?.message || 'Unable to identify the connected Instagram account.');
        }
        logInfo('Instagram profile retrieved successfully', { usernamePresent: Boolean(profile.username) });

        const user = await store.createOrUpdateInstagramCreator({
          instagramUserId: profile.id || profile.user_id,
          username: profile.username,
        });
        await store.createInstagramToken(user.id, finalAccessToken);
        logInfo('Instagram token saved successfully', { userId: user.id });
        logInfo('Instagram webhook subscription check started', { userId: user.id });
        try {
          const subscription = await ensureInstagramSubscriptions({
            accountId: profile.id || profile.user_id, accessToken: tokenData.access_token,
          });
          logInfo('Instagram webhook subscriptions verified', { userId: user.id, ...subscription });
        } catch (e) {
          logError('Instagram webhook subscription setup failed', { userId: user.id, ...e.meta, errorMessage: e.message });
          throw new Error('Instagram authorization was saved, but webhook setup failed. Reconnect Instagram to retry.');
        }
        
        return sendJson(res, 200, {
          message: 'Instagram connected successfully.',
          user,
          token: await store.createSession(user.id),
        });
      } catch (e) {
        logError('Instagram callback error', {
          message: e.message,
          stack: e.stack,
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
        
        // Fetch posts from Meta API
        const response = await fetch(
          `https://graph.instagram.com/v25.0/me/media?fields=id,caption,media_type,media_url&access_token=${encodeURIComponent(igToken)}`
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
    if (req.method === 'POST' && /^\/api\/creator\/posts\/[^/]+\/products$/.test(url.pathname)) {
      const user = await requireCreator(req, res); if (!user) return;
      const postId = url.pathname.split('/')[4];
      const data = parseJson((await readBody(req)).toString()) || {};
      if (!Array.isArray(data.products) || data.products.length === 0) {
        return sendJson(res, 400, { error: 'Add at least one product before saving.' });
      }
      for (const product of data.products) {
        if (!String(product.name || '').trim() || !String(product.imageUrl || '').trim()) {
          return sendJson(res, 400, { error: 'Product name and image URL are required.' });
        }
        if (!Array.isArray(product.sellerLinks) || product.sellerLinks.length === 0) {
          return sendJson(res, 400, { error: 'At least one affiliate link is required per product.' });
        }
        if (product.sellerLinks.length > 10) {
          return sendJson(res, 400, { error: 'A product can have at most 10 affiliate links.' });
        }
        for (const link of product.sellerLinks) {
          const affiliateUrl = String(link.url || '');
          if (!affiliateUrl.startsWith('https://') || !validateUrl(affiliateUrl)) {
            return sendJson(res, 400, { error: 'Each affiliate link must be HTTPS and use an approved retailer domain.' });
          }
        }
      }
      try {
        const result = await store.saveProductsForPost(user.id, postId, data.products);
        await store.logEvent('Products saved', `${result.reelSlug} - ${result.saved} products`);
        return sendJson(res, 201, { ok: true, ...result });
      } catch (e) {
        logError('Creator post product save failed', { message: e.message, userId: user.id });
        return sendJson(res, 400, { error: e.message });
      }
    }

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
      const user = await requireCreator(req, res); if (!user) return;
      const data = parseJson((await readBody(req)).toString()) || {};
      const payload = buildTestPayload({
        kind:      data.kind || 'comment',
        text:      data.text || 'link',
        mediaId:   data.mediaId || '178923456',
        commentId: data.commentId || `sim-${Date.now()}`,
        senderId:  data.senderId || 'sim-sender-001',
        username:  data.username || 'testuser',
      });
      const results = [];
      for (const job of collectIncoming(payload)) {
        try {
          results.push(await handleJob({ ...job, testMode: true }));
        } catch (e) {
          logError('Automation test failed', { message: e.message, kind: job.kind, userId: user.id });
          await store.logEvent('Test sim failed', e.message);
          results.push({ status: 'failed', error: e.message });
        }
      }
      return sendJson(res, 200, { simulated: true, results });
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
  startCommentRecovery({
    mode: process.env.INSTAGRAM_COMMENT_RECOVERY_MODE || 'live',
    handleJob,
    logInfo,
    logError,
  });
});
