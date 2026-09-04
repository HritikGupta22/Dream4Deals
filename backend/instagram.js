const crypto = require('crypto');
const pool   = require('./db');

// ── Signature validation ──────────────────────────────────────────────────────
function validSignature(raw, signature, secret) {
  if (!secret) return true;
  if (!signature) return false;
  const expected       = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const sigBuffer      = Buffer.from(signature);
  if (expectedBuffer.length !== sigBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, sigBuffer);
}

// ── Trigger matching ──────────────────────────────────────────────────────────
function matchesTrigger(text, triggers) {
  const lower = String(text || '').toLowerCase().trim();
  if (!lower) return false;
  return (triggers || []).some((w) => lower.includes(String(w).toLowerCase()));
}

// ── Reply template ────────────────────────────────────────────────────────────
function applyTemplate(template, { name, url, title }) {
  return String(template || 'Here is the link: {{url}}')
    .replaceAll('{{name}}', name ? ` ${name}` : '')
    .replaceAll('{{url}}', url)
    .replaceAll('{{title}}', title || '');
}

// ── Idempotency ───────────────────────────────────────────────────────────────
async function isAlreadyProcessed(eventId) {
  if (!eventId) return false;
  const res = await pool.query('SELECT 1 FROM processed_events WHERE event_id=$1', [eventId]);
  return res.rows.length > 0;
}

async function markProcessed(eventId, kind) {
  if (!eventId) return;
  await pool.query(
    `INSERT INTO processed_events (event_id, kind) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [eventId, kind]
  );
}

// ── Parse incoming Meta webhook payload into jobs ─────────────────────────────
function attachmentMediaId(message) {
  const attachments = message?.attachments || message?.share || [];
  const list = Array.isArray(attachments) ? attachments : [attachments];
  for (const item of list) {
    const payload = item?.payload || item || {};
    const id = payload.ig_post_id || payload.reel_video_id || payload.media?.id || payload.id || item?.id;
    if (id) return String(id);
  }
  return null;
}

function collectIncoming(payload) {
  const jobs = [];

  for (const entry of payload.entry || []) {
    // Comments
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const field = change.field || '';
      const text  = value.text || value.comment_text || value.message?.text || '';

      if (field === 'comments' || value.comment_id || (value.media && (value.id || value.text))) {
        jobs.push({
          kind:      'comment',
          eventId:   value.id || value.comment_id,
          text,
          commentId: value.id || value.comment_id,
          mediaId:   value.media?.id || value.media_id || null,
          username:  value.from?.username || null,
          senderId:  value.from?.id || null,
        });
        continue;
      }

      // DMs via changes
      if (field === 'messages' || value.sender || value.message) {
        const message = value.message || value;
        if (message.is_echo) continue;
        jobs.push({
          kind:     'dm',
          eventId:  message.mid || null,
          text:     message.text || text,
          senderId: value.sender?.id || value.from?.id || null,
          mediaId:  attachmentMediaId(message) || value.media?.id || null,
        });
      }
    }

    // DMs via messaging array
    for (const item of entry.messaging || []) {
      const message = item.message || {};
      if (message.is_echo) continue;
      jobs.push({
        kind:     'dm',
        eventId:  message.mid || null,
        text:     message.text || '',
        senderId: item.sender?.id || null,
        mediaId:  attachmentMediaId(message),
      });
    }
  }

  return jobs;
}

// ── Meta Graph API calls ──────────────────────────────────────────────────────
async function graphPost(path, body) {
  const token   = process.env.META_ACCESS_TOKEN;
  const version = process.env.META_GRAPH_API_VERSION || 'v22.0';
  if (!token) return { sent: false, reason: 'META_ACCESS_TOKEN not configured' };

  const res  = await fetch(`https://graph.facebook.com/${version}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ...body, access_token: token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Meta API error');
  return { sent: true, data };
}

// Public reply on the comment (visible to everyone — no link, just teaser)
function sendPublicCommentReply(commentId, message) {
  return graphPost(`/${commentId}/replies`, { message });
}

// Private DM with the actual shopping link
function sendDirectMessage(senderId, message) {
  const account = process.env.META_INSTAGRAM_ACCOUNT_ID;
  if (!account) return Promise.resolve({ sent: false, reason: 'META_INSTAGRAM_ACCOUNT_ID not configured' });
  return graphPost(`/${account}/messages`, { recipient: { id: senderId }, message: { text: message } });
}

// ── Local test simulator ──────────────────────────────────────────────────────
// Builds a fake Meta webhook payload for local testing without a real Meta app
function buildTestPayload({ kind, text, mediaId, commentId, senderId, username }) {
  const timestamp = Math.floor(Date.now() / 1000);

  if (kind === 'comment') {
    return {
      object: 'instagram',
      entry: [{
        id: 'test-page-id',
        time: timestamp,
        changes: [{
          field: 'comments',
          value: {
            id:       commentId || `test-comment-${Date.now()}`,
            text:     text || 'link',
            media:    { id: mediaId || '178923456' },
            from:     { id: senderId || 'test-sender-001', username: username || 'testuser' },
          },
        }],
      }],
    };
  }

  // DM
  return {
    object: 'instagram',
    entry: [{
      id: 'test-page-id',
      time: timestamp,
      messaging: [{
        sender:    { id: senderId || 'test-sender-001' },
        recipient: { id: process.env.META_INSTAGRAM_ACCOUNT_ID || 'test-account' },
        timestamp,
        message:   { mid: `test-mid-${Date.now()}`, text: text || 'link' },
      }],
    }],
  };
}

module.exports = {
  validSignature,
  matchesTrigger,
  applyTemplate,
  isAlreadyProcessed,
  markProcessed,
  collectIncoming,
  sendPublicCommentReply,
  sendDirectMessage,
  buildTestPayload,
};
