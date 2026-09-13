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
  const values = { name: name || '', url: url || '', title: title || '' };
  // Studio uses {name}/{url}; retain support for legacy Hey{{name}} templates.
  // A single pass also leaves any braces in replacement values untouched.
  return String(template || 'Here is the link: {{url}}').replace(
    /\{\{(name|url|title)\}\}|\{(name|url|title)\}/g,
    (_, legacyKey, key) => legacyKey === 'name' && name ? ` ${name}` : values[legacyKey || key]
  );
}

// ── Idempotency ───────────────────────────────────────────────────────────────
async function isAlreadyProcessed(eventId) {
  if (!eventId) return false;
  const res = await pool.query('SELECT 1 FROM processed_events WHERE event_id=$1', [eventId]);
  return res.rows.length > 0;
}

async function claimEvent(eventId, kind) {
  if (!eventId) return true;
  const res = await pool.query(
    `INSERT INTO processed_events (event_id, kind) VALUES ($1,$2)
     ON CONFLICT DO NOTHING RETURNING event_id`,
    [eventId, kind]
  );
  return res.rows.length === 1;
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
      if (field === 'messages' || field === 'messaging_postbacks' || value.sender || value.message) {
        const message = value.message || value;
        if (message.is_echo) continue;
        jobs.push({
          kind:     'dm',
          eventId:  message.mid || value.postback?.mid || null,
          text:     message.text || text,
          senderId: value.sender?.id || value.from?.id || null,
          mediaId:  attachmentMediaId(message) || value.media?.id || null,
          quickReplyPayload: message.quick_reply?.payload || value.postback?.payload || null,
        });
      }
    }

    // DMs via messaging array
    for (const item of entry.messaging || []) {
      const message = item.message || {};
      if ((!item.message && !item.postback) || message.is_echo) continue;
      jobs.push({
        kind:     'dm',
        eventId:  message.mid || item.postback?.mid || null,
        text:     message.text || '',
        senderId: item.sender?.id || null,
        mediaId:  attachmentMediaId(message),
        quickReplyPayload: message.quick_reply?.payload || item.postback?.payload || null,
      });
    }
  }

  return jobs;
}

// ── Meta Graph API calls ──────────────────────────────────────────────────────
async function graphPost(path, body, accessToken) {
  const token   = accessToken || process.env.META_ACCESS_TOKEN;
  const version = process.env.META_GRAPH_API_VERSION || 'v25.0';
  if (!token) return { sent: false, reason: 'META_ACCESS_TOKEN not configured' };

  const res  = await fetch(`https://graph.instagram.com/${version}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data?.error) {
    const error = new Error(data?.error?.message || 'Meta API error');
    error.meta = {
      endpoint: path, httpStatus: res.status, code: data?.error?.code,
      subcode: data?.error?.error_subcode, type: data?.error?.type,
      traceId: data?.error?.fbtrace_id, transient: data?.error?.is_transient,
    };
    throw error;
  }
  return { sent: true, data };
}

// Public reply on the comment (visible to everyone — no link, just teaser)
function sendPublicCommentReply(commentId, message, accessToken) {
  return graphPost(`/${commentId}/replies`, { message }, accessToken);
}

// A comment author need not have opened a DM conversation or follow the creator.
function sendPrivateCommentReply(commentId, message, { accountId, accessToken } = {}, options = {}) {
  if (!commentId || !accountId || !accessToken) {
    return Promise.resolve({ sent: false, reason: 'Private reply requires comment ID and creator connection' });
  }

  const payload = {
    recipient: { comment_id: commentId },
    message: options.buttons?.length
      ? { attachment: { type: 'template', payload: { template_type: 'button', text: message, buttons: options.buttons } } }
      : { text: message },
  };

  if (Array.isArray(options.quickReplies) && options.quickReplies.length) {
    payload.message.quick_replies = options.quickReplies;
  }

  return graphPost(`/${accountId}/messages`, payload, accessToken);
}

// Private DM with the actual shopping link
function sendDirectMessage(senderId, message, { accountId, accessToken } = {}, options = {}) {
  const account = accountId || process.env.META_INSTAGRAM_ACCOUNT_ID;
  if (!account) return Promise.resolve({ sent: false, reason: 'META_INSTAGRAM_ACCOUNT_ID not configured' });

  const payload = {
    recipient: { id: senderId },
    message: options.buttons?.length
      ? { attachment: { type: 'template', payload: { template_type: 'button', text: message, buttons: options.buttons } } }
      : { text: message },
  };

  if (Array.isArray(options.quickReplies) && options.quickReplies.length) {
    payload.message.quick_replies = options.quickReplies;
  }

  // Always target the connected Instagram account. The access token is carried
  // in the Authorization header and already identifies the sender.
  return graphPost(`/${account}/messages`, payload, accessToken);
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
  claimEvent,
  markProcessed,
  collectIncoming,
  sendPublicCommentReply,
  sendPrivateCommentReply,
  sendDirectMessage,
  buildTestPayload,
};
