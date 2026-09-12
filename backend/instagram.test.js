const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(failPrivate = false, failPublic = false) {
  const calls = [], logs = [];
  const claimed = new Set();
  const instagram = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'instagram.js'), 'utf8'), {
    module: instagram, require: name => name === './db' ? {} : require(name), process: { env: {} }, Buffer,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, body, token: options.headers.Authorization });
      const failed = body.recipient ? failPrivate : failPublic;
      return { ok: !failed, status: failed ? 400 : 200, json: async () => failed
        ? { error: { message: 'Window closed', code: 10, error_subcode: 2534022, fbtrace_id: 'trace-123' } }
        : body.recipient ? { message_id: 'message-123', recipient_id: 'recipient-456' } : { id: 'reply-123' } };
    },
  });
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const settings = { enabled: true, replyComments: true, triggers: ['link'], replyTemplate: '{{url}}' };
  const context = {
    ...instagram.exports,
    logInfo: (message, data) => logs.push({ message, ...data }),
    logError: (message, data) => logs.push({ message, ...data }),
    claimEvent: async id => { if (claimed.has(id)) return false; claimed.add(id); return true; },
    resolveReel: async () => ({ slug: 'reel', creatorId: 'creator', creatorInstagramUserId: 'account' }),
    reelUrl: () => 'https://example.com/reel',
    store: { getReelAutomation: async () => settings, rememberUserReel: async () => {}, getInstagramToken: async () => 'creator-token', logEvent: async () => {} },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function handleJob('), source.indexOf('async function handleInstagramWebhook(')), context);
  return { calls, logs, api: instagram.exports, run: (job = {}) => context.handleJob({ kind: 'comment', eventId: 'comment', commentId: 'comment', text: 'link', ...job }) };
}

test('comment private reply uses comment ID without sender/follower dependency, then confirms using creator token', async () => {
  const h = harness();
  assert.equal((await h.run()).status, 'sent');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://graph.instagram.com/v25.0/account/messages');
  assert.deepEqual(h.calls[0].body.recipient, { comment_id: 'comment' });
  assert.equal(h.calls[0].body.message.text, 'https://example.com/reel');
  assert.equal(h.calls[1].url, 'https://graph.instagram.com/v25.0/comment/replies');
  assert.ok(h.calls.every(call => call.token === 'Bearer creator-token'));
  assert.ok(h.logs.some(log => log.messageId === 'message-123'));
});
test('private reply rejection still sends a public comment reply and preserves diagnostics', async () => {
  const h = harness(true);
  const result = await h.run();
  assert.equal(result.status, 'sent');
  assert.equal(result.publicReply, 'sent');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].url, 'https://graph.instagram.com/v25.0/account/messages');
  assert.equal(h.calls[1].url, 'https://graph.instagram.com/v25.0/comment/replies');
  const failure = h.logs.find(log => log.message === 'Instagram private reply failed');
  assert.equal(failure.code, 10);
  assert.equal(failure.subcode, 2534022);
  assert.equal(failure.traceId, 'trace-123');
  assert.equal(failure.httpStatus, 400);
  assert.ok(!JSON.stringify(h.logs).includes('creator-token'));
});
test('public reply failure preserves successful private delivery', async () => {
  const h = harness(false, true);
  const result = await h.run();
  assert.equal(result.status, 'sent');
  assert.equal(result.publicReply, 'failed');
});
test('read receipts and echoes do not become empty DM jobs', () => {
  const h = harness();
  const jobs = h.api.collectIncoming({ entry: [{ messaging: [
    { sender: { id: 'user' }, read: { mid: 'read' } },
    { message: { is_echo: true, mid: 'echo' } },
    { sender: { id: 'user' }, message: { mid: 'real', text: 'link' } },
  ] }] });
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].eventId, 'real');
});

test('direct DMs use the connected account endpoint, not the generic me endpoint', async () => {
  const h = harness();
  await h.api.sendDirectMessage('sender-1', 'hello', { accountId: 'account', accessToken: 'token' });
  assert.equal(h.calls[0].url, 'https://graph.instagram.com/v25.0/account/messages');
  assert.deepEqual(h.calls[0].body.recipient, { id: 'sender-1' });
});

test('renders the single-brace template saved by Studio with a real shopping URL', () => {
  const h = harness();
  assert.equal(h.api.applyTemplate('Hi {name}! Check out this reel and shop the look: {url}', {
    name: 'moon.litfeelss', url: 'https://example.com/reel',
  }), 'Hi moon.litfeelss! Check out this reel and shop the look: https://example.com/reel');
});

test('retains legacy template spacing and handles absent names', () => {
  const h = harness();
  assert.equal(h.api.applyTemplate('Hey{{name}}! {{title}}: {{url}}', {
    name: 'viewer', title: 'Fashion', url: 'https://example.com/reel',
  }), 'Hey viewer! Fashion: https://example.com/reel');
  assert.equal(h.api.applyTemplate('Hey{{name}}! {{url}}', { url: 'https://example.com/reel' }), 'Hey! https://example.com/reel');
});

test('late webhook after recovery cannot send the same comment twice', async () => {
  const h = harness();
  assert.equal((await h.run({ source: 'comment_recovery' })).status, 'sent');
  assert.equal((await h.run({ source: 'webhook' })).status, 'duplicate');
  assert.equal(h.calls.length, 2); // one private message and its public confirmation
});
