const { matchesTrigger, isAlreadyProcessed } = require('./instagram');
const pool = require('./db');
const store = require('./store');

async function loadRecoveryTargets() {
  const { rows } = await pool.query(`
    SELECT r.slug, r.instagram_media_id AS "mediaId", c.handle,
           c.instagram_user_id AS "accountId", c.instagram_access_token AS "accessToken",
           c.id AS "creatorId"
    FROM reels r JOIN creators c ON c.id=r.creator_id
    WHERE c.instagram_access_token IS NOT NULL AND c.instagram_user_id IS NOT NULL
    ORDER BY r.slug`);
  const targets = [];
  for (const row of rows) {
    const rule = await store.getReelAutomation(row.creatorId, row.slug) || await store.getSettings();
    if (rule.enabled && rule.replyComments) targets.push({ ...row, triggers: rule.triggers });
  }
  return targets;
}

// This supplements webhook delivery through the official comments API.
// Preview never calls the automation handler or claims a comment.
function createCommentRecovery({
  mode = 'preview', loadTargets = loadRecoveryTargets, wasProcessed = isAlreadyProcessed,
  handleJob, logInfo = () => {}, logError = () => {}, fetchFn = global.fetch,
  now = Date.now, lookbackMs = 60 * 60 * 1000, graceMs = 60000, maxPages = 3,
} = {}) {
  if (!['preview', 'live'].includes(mode)) throw new Error('Recovery mode must be preview or live');
  if (mode === 'live' && typeof handleJob !== 'function') throw new Error('Live recovery requires the automation handler');
  let running = false;

  return async function scan() {
    if (running) return { status: 'already_running' };
    running = true;
    const summary = { mode, postsChecked: 0, candidates: 0, dispatched: 0, errors: 0, truncatedPosts: 0 };
    const seen = new Set();
    try {
      for (const target of await loadTargets()) {
        const context = { reelSlug: target.slug, mediaId: target.mediaId, source: 'comment_recovery', mode };
        try {
          let after;
          let pages = 0;
          do {
            const version = process.env.META_GRAPH_API_VERSION || 'v25.0';
            const url = new URL(`https://graph.instagram.com/${version}/${encodeURIComponent(target.mediaId)}/comments`);
            url.searchParams.set('fields', 'id,text,from,timestamp,hidden');
            url.searchParams.set('limit', '50');
            if (after) url.searchParams.set('after', after);
            const response = await fetchFn(url, {
              headers: { Authorization: `Bearer ${target.accessToken}` }, signal: AbortSignal.timeout(15000),
            });
            const data = await response.json();
            if (!response.ok || data.error) {
              const error = new Error('Meta comment recovery read failed');
              error.meta = { httpStatus: response.status, code: data.error?.code,
                subcode: data.error?.error_subcode, traceId: data.error?.fbtrace_id };
              throw error;
            }
            if (!Array.isArray(data.data)) throw new Error('Meta comments response has no data array');
            for (const comment of data.data) {
              const age = now() - Date.parse(comment.timestamp);
              const owner = String(target.handle || '').replace(/^@/, '').toLowerCase();
              const username = String(comment.from?.username || '').toLowerCase();
              const minAgeForRecovery = mode === 'live' ? 0 : graceMs;
              if (!comment.id || seen.has(comment.id) || !Number.isFinite(age) || age < minAgeForRecovery || age > lookbackMs ||
                  comment.hidden !== false || (owner && username === owner) ||
                  (comment.from?.id && String(comment.from.id) === String(target.accountId)) ||
                  !matchesTrigger(comment.text, target.triggers)) continue;
              seen.add(comment.id);
              if (await wasProcessed(comment.id)) continue;
              summary.candidates++;
              logInfo('Instagram missed comment detected', { ...context, commentId: comment.id,
                username: comment.from?.username, ageSeconds: Math.floor(age / 1000), deliveryTested: false });
              if (mode === 'live') {
                // handleJob rechecks the current rule and atomically claims the SAME event ID
                // used by webhooks, so late webhooks and later scans do not send it twice.
                const result = await handleJob({ kind: 'comment', eventId: comment.id, commentId: comment.id,
                  mediaId: target.mediaId, senderId: comment.from?.id || null, username: comment.from?.username,
                  text: comment.text, source: 'comment_recovery' });
                summary.dispatched++;
                logInfo('Instagram comment recovery completed', { ...context, commentId: comment.id, ...result });
              }
            }
            pages++;
            // Rebuild the URL with a cursor; never follow a remote next URL carrying a token.
            after = data.paging?.next ? data.paging?.cursors?.after : null;
            if (data.paging?.next && (!after || pages >= maxPages)) {
              summary.truncatedPosts++;
              logInfo('Instagram comment recovery scan limited', { ...context, pages, moreComments: true });
              break;
            }
          } while (after);
          summary.postsChecked++;
        } catch (error) {
          summary.errors++;
          logError('Instagram comment recovery failed', { ...context, errorMessage: error.message, ...error.meta });
        }
      }
    } catch (error) {
      summary.errors++;
      logError('Instagram recovery targets unavailable', { errorMessage: error.message });
    } finally {
      running = false;
    }
    logInfo('Instagram comment recovery scan completed', summary);
    return summary;
  };
}

function startCommentRecovery({ mode = process.env.INSTAGRAM_COMMENT_RECOVERY_MODE || 'off', handleJob, logInfo, logError }) {
  if (mode === 'off') return null;
  if (!['preview', 'live'].includes(mode)) {
    logError('Instagram comment recovery disabled: invalid mode');
    return null;
  }
  const scan = createCommentRecovery({ mode, handleJob, logInfo, logError });
  const intervalMs = Number(process.env.INSTAGRAM_COMMENT_RECOVERY_INTERVAL_MS || 10000);
  logInfo('Instagram comment recovery started', { mode, intervalSeconds: intervalMs / 1000, lookbackMinutes: 60 });
  const timer = setInterval(scan, intervalMs);
  timer.unref();
  void scan();
  return timer;
}

module.exports = { createCommentRecovery, startCommentRecovery };
