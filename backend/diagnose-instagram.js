// Read-only: inspects comments/subscriptions without claiming events or sending replies.
require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function diagnose() {
  const handle = `@${(process.argv[2] || 'dream4deal').replace(/^@/, '')}`;
  const username = (process.argv[3] || '').replace(/^@/, '').toLowerCase();
  const { rows } = await pool.query(
    'SELECT id, instagram_user_id, instagram_access_token FROM creators WHERE handle=$1', [handle]
  );
  const creator = rows[0];
  if (!creator?.instagram_access_token) throw new Error('Connected creator not found');
  const version = process.env.META_GRAPH_API_VERSION || 'v25.0';
  async function get(edge) {
    const response = await fetch(`https://graph.instagram.com/${version}/${edge}`, {
      headers: { Authorization: `Bearer ${creator.instagram_access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      const error = new Error('Meta diagnostic request failed');
      error.meta = { httpStatus: response.status, code: data.error?.code, subcode: data.error?.error_subcode, traceId: data.error?.fbtrace_id };
      throw error;
    }
    return data;
  }
  const subscriptions = await get(`${creator.instagram_user_id}/subscribed_apps`);
  const media = await pool.query('SELECT slug, instagram_media_id FROM reels WHERE creator_id=$1', [creator.id]);
  const posts = [];
  for (const reel of media.rows) {
    const data = await get(`${reel.instagram_media_id}/comments?fields=id,from,timestamp,hidden&limit=50`);
    const comments = [];
    for (const comment of data.data || []) {
      if (username && comment.from?.username?.toLowerCase() !== username) continue;
      const processed = await pool.query('SELECT kind FROM processed_events WHERE event_id=$1', [comment.id]);
      comments.push({ commentId: comment.id, username: comment.from?.username,
        createdAt: comment.timestamp, hidden: comment.hidden, eventClaimed: processed.rows.length > 0 });
    }
    posts.push({ reelSlug: reel.slug, mediaId: reel.instagram_media_id, comments, hasMorePages: Boolean(data.paging?.next) });
  }
  const logFile = path.join(__dirname, 'storage', 'backend.log');
  const entries = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n').flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }) : [];
  const lastCommentWebhook = entries.filter(entry => entry.message === 'Instagram webhook accepted' && entry.fields?.includes('comments')).at(-1);
  const report = { checkedAt: new Date().toISOString(), creator: handle,
    subscriptions: (subscriptions.data || []).map(app => ({ id: app.id, fields: app.subscribed_fields })),
    lastLoggedCommentWebhookAt: lastCommentWebhook?.timestamp || null,
    note: 'Account subscriptions do not verify app mode, app-level webhook settings, or delivery. Claimed events do not prove a message was delivered. Comment search is limited to the first 50 comments per mapped post.',
    posts };
  const output = path.join(__dirname, 'storage', 'instagram-diagnostics.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

diagnose().catch(error => {
  console.error(JSON.stringify({ error: error.meta ? error.message : 'Instagram diagnostics could not complete', ...error.meta, cause: error.cause?.code }));
  process.exitCode = 1;
}).finally(() => pool.end());
