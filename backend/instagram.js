const crypto = require('crypto');

function validSignature(raw, signature, secret) {
  if (!secret) return true;
  if (!signature) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

function matchesTrigger(text, triggers) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return false;
  return (triggers || []).some((word) => lower.includes(String(word).toLowerCase()));
}

function applyTemplate(template, { name, url, title }) {
  return String(template || 'Sure ❤️ Here is the link: {{url}}')
    .replaceAll('{{name}}', name ? ` ${name}` : '')
    .replaceAll('{{url}}', url)
    .replaceAll('{{title}}', title || '');
}

function attachmentMediaId(message) {
  const attachments = message?.attachments || message?.share || [];
  const list = Array.isArray(attachments) ? attachments : [attachments];
  for (const item of list) {
    const payload = item?.payload || item || {};
    const id =
      payload.ig_post_id ||
      payload.reel_video_id ||
      payload.media?.id ||
      payload.id ||
      item?.id;
    if (id) return String(id);
  }
  return null;
}

function collectIncoming(payload) {
  const jobs = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const field = change.field || '';
      const text = value.text || value.comment_text || value.message?.text || '';

      if (field === 'comments' || value.comment_id || (value.media && (value.id || value.text))) {
        jobs.push({
          kind: 'comment',
          text,
          commentId: value.id || value.comment_id,
          mediaId: value.media?.id || value.media_id || null,
          username: value.from?.username,
          senderId: value.from?.id,
        });
        continue;
      }

      if (field === 'messages' || value.sender || value.message) {
        const message = value.message || value;
        if (message.is_echo) continue;
        jobs.push({
          kind: 'dm',
          text: message.text || text,
          senderId: value.sender?.id || value.from?.id,
          mediaId: attachmentMediaId(message) || value.media?.id || null,
        });
      }
    }

    for (const item of entry.messaging || []) {
      const message = item.message || {};
      if (message.is_echo) continue;
      jobs.push({
        kind: 'dm',
        text: message.text || '',
        senderId: item.sender?.id,
        mediaId: attachmentMediaId(message),
      });
    }
  }

  return jobs;
}

async function graphMessage(recipient, message) {
  const account = process.env.META_INSTAGRAM_ACCOUNT_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!account || !token) {
    return { sent: false, reason: 'Meta credentials are not configured' };
  }

  const version = process.env.META_GRAPH_API_VERSION || 'v22.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${account}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient,
      message: { text: message },
      access_token: token,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Meta rejected the reply');
  }

  return { sent: true, data };
}

function sendCommentReply(commentId, message) {
  return graphMessage({ comment_id: commentId }, message);
}

function sendDirectMessage(senderId, message) {
  return graphMessage({ id: senderId }, message);
}

module.exports = {
  validSignature,
  matchesTrigger,
  applyTemplate,
  collectIncoming,
  sendCommentReply,
  sendDirectMessage,
};
