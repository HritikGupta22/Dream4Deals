const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommentRecovery } = require('./comment-recovery');

const clock = Date.parse('2026-09-13T00:00:00Z');
const target = { slug: 'reel', mediaId: 'media', accountId: 'owner-id', handle: '@owner', accessToken: 'secret', triggers: ['link'] };
function comment(id, overrides = {}) {
  return { id, text: 'LINK', from: { username: 'moon.litfeelss' }, hidden: false,
    timestamp: new Date(clock - 120000).toISOString(), ...overrides };
}
function harness({ mode = 'preview', pages = [{ data: [comment('missed')] }], processed = [], ...options } = {}) {
  const requests = [], jobs = [], logs = [];
  let index = 0;
  const scan = createCommentRecovery({ mode, now: () => clock, loadTargets: async () => [target],
    wasProcessed: async id => processed.includes(id),
    handleJob: async job => { jobs.push(job); return { status: 'sent' }; },
    fetchFn: async (url, init) => { requests.push({ url: String(url), ...init }); return { ok: true, json: async () => pages[index++] }; },
    logInfo: (message, meta) => logs.push({ message, ...meta }),
    logError: (message, meta) => logs.push({ message, ...meta }), ...options,
  });
  return { scan, requests, jobs, logs };
}

test('preview discovers a missed non-follower comment without sending or claiming it', async () => {
  const h = harness();
  const result = await h.scan();
  assert.equal(result.candidates, 1);
  assert.equal(result.dispatched, 0);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.logs.find(log => log.commentId === 'missed').username, 'moon.litfeelss');
  assert.equal(h.requests[0].method, undefined); // GET only
  assert.ok(!h.requests[0].url.includes('secret'));
  assert.ok(!JSON.stringify(h.logs).includes('secret'));
});

test('ignores handled, hidden, old, too recent, creator-authored, and nonmatching comments', async () => {
  const h = harness({ processed: ['handled'], pages: [{ data: [
    comment('handled'), comment('hidden', { hidden: true }), comment('unknown-visibility', { hidden: undefined }),
    comment('old', { timestamp: new Date(clock - 3600001).toISOString() }),
    comment('recent', { timestamp: new Date(clock - 10000).toISOString() }),
    comment('self', { from: { username: 'OWNER' } }), comment('self-id', { from: { id: 'owner-id' } }),
    comment('no-trigger', { text: 'hello' }), comment('bad-date', { timestamp: 'bad' }),
  ] }] });
  assert.equal((await h.scan()).candidates, 0);
});

test('live recovery shares the webhook comment/event ID and normal automation handler', async () => {
  const h = harness({ mode: 'live' });
  assert.equal((await h.scan()).dispatched, 1);
  assert.equal(h.jobs[0].eventId, 'missed');
  assert.equal(h.jobs[0].commentId, 'missed');
  assert.equal(h.jobs[0].source, 'comment_recovery');
  assert.equal(h.jobs[0].testMode, undefined);
});

test('live recovery processes recent missed comments immediately instead of waiting for the 60s grace window', async () => {
  const recent = comment('recent-missed', { timestamp: new Date(clock - 15000).toISOString() });
  const h = harness({ mode: 'live', pages: [{ data: [recent] }] });
  const result = await h.scan();
  assert.equal(result.dispatched, 1);
  assert.equal(h.jobs[0].commentId, 'recent-missed');
});

test('follows cursors on the Meta host and ignores repeated comments across pages', async () => {
  const h = harness({ pages: [
    { data: [comment('one')], paging: { next: 'https://untrusted.example?access_token=secret', cursors: { after: 'cursor' } } },
    { data: [comment('one'), comment('two')] },
  ] });
  assert.equal((await h.scan()).candidates, 2);
  assert.equal(h.requests.length, 2);
  assert.equal(new URL(h.requests[1].url).hostname, 'graph.instagram.com');
  assert.equal(new URL(h.requests[1].url).searchParams.get('after'), 'cursor');
});

test('page limit is visible in logs and result', async () => {
  const h = harness({ maxPages: 1, pages: [{ data: [], paging: { next: 'next', cursors: { after: 'cursor' } } }] });
  assert.equal((await h.scan()).truncatedPosts, 1);
  assert.equal(h.requests.length, 1);
});

test('Meta read failure records error details and never dispatches a reply', async () => {
  const h = harness({ mode: 'live', fetchFn: async () => ({ ok: false, status: 403,
    json: async () => ({ error: { code: 10, fbtrace_id: 'trace' } }),
  }) });
  assert.equal((await h.scan()).errors, 1);
  assert.equal(h.jobs.length, 0);
  assert.ok(h.logs.some(log => log.code === 10 && log.traceId === 'trace'));
});

test('overlapping scans cannot start parallel recovery passes', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = harness({ loadTargets: async () => { await pending; return []; } });
  const first = h.scan();
  assert.equal((await h.scan()).status, 'already_running');
  release();
  await first;
});
