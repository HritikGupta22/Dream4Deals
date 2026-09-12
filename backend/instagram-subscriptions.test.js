const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureInstagramSubscriptions } = require('./instagram-subscriptions');
const connection = { accountId: 'account', accessToken: 'secret', appId: 'our-app' };

function mockApi(t, responses) {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, ...options });
    const next = responses.shift();
    assert.ok(next, 'Unexpected API request');
    return { ok: !next.error, status: next.error ? 400 : 200, json: async () => next };
  });
  return calls;
}
const subscribed = fields => ({ data: [{ id: 'our-app', subscribed_fields: fields }] });

test('repairs missing comments while preserving existing messaging fields and verifies result', async t => {
  const calls = mockApi(t, [subscribed(['messages', 'messaging_seen']), { success: true }, subscribed(['messages', 'messaging_seen', 'comments'])]);
  const result = await ensureInstagramSubscriptions(connection);
  assert.equal(result.updated, true);
  assert.deepEqual(result.previousFields, ['messages', 'messaging_seen']);
  assert.equal(JSON.parse(calls[1].body).subscribed_fields, 'messages,messaging_seen,comments');
  assert.deepEqual(calls.map(call => call.method), ['GET', 'POST', 'GET']);
  assert.ok(calls.every(call => !call.url.includes('secret')));
});

test('does not mutate a complete subscription', async t => {
  const calls = mockApi(t, [subscribed(['comments', 'messages'])]);
  assert.equal((await ensureInstagramSubscriptions(connection)).updated, false);
  assert.equal(calls.length, 1);
});

test('handles Instagram subscription app IDs differing from the OAuth client ID', async t => {
  mockApi(t, [{ data: [{ id: 'instagram-app-id', subscribed_fields: ['comments', 'messages'] }] }]);
  assert.equal((await ensureInstagramSubscriptions(connection)).subscriptionAppId, 'instagram-app-id');
});

test('does not guess when multiple unfamiliar apps are returned', async t => {
  const calls = mockApi(t, [{ data: [{ id: 'other-app', subscribed_fields: ['comments', 'messages'] }, { id: 'another-app', subscribed_fields: ['messages'] }] }]);
  await assert.rejects(ensureInstagramSubscriptions(connection), /META_WEBHOOK_APP_ID/);
  assert.equal(calls.length, 1);
});

test('permission failure retains diagnostics and prevents a success result', async t => {
  mockApi(t, [subscribed(['messages']), { error: { message: 'Permission denied', code: 10, fbtrace_id: 'trace' } }]);
  await assert.rejects(ensureInstagramSubscriptions(connection), error => error.meta.code === 10 && error.meta.traceId === 'trace');
});

test('requires readback confirmation even when POST reports success', async t => {
  mockApi(t, [subscribed(['messages']), { success: true }, subscribed(['messages'])]);
  await assert.rejects(ensureInstagramSubscriptions(connection), /verification failed/);
});
