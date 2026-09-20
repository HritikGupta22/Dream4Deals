const test = require('node:test');
const assert = require('node:assert/strict');
const { automationError } = require('./studio-inputs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

test('custom triggers and templates require both placeholders even when disabled', () => {
  const rule = { enabled: false, triggers: ['PRICE', 'send details'], replyTemplate: 'Hello {name}, here is your item: {url}' };
  assert.equal(automationError(rule), null);
  for (const replyTemplate of ['Hi {name}', 'Visit {url}', '', null, 'x'.repeat(2001) + '{name}{url}']) {
    assert.ok(automationError({ ...rule, replyTemplate }));
  }
  for (const triggers of [[], [' '], [123], null, Array(51).fill('BUY'), ['x'.repeat(81)]]) {
    assert.ok(automationError({ ...rule, triggers }));
  }
});

test('image upload signature route authenticates and keeps the Cloudinary secret private', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf("    if (req.method === 'POST' && url.pathname === '/api/product-images/signature')");
  const end = source.indexOf('    //', start + 1);
  for (const scenario of ['unauthorized', 'unconfigured', 'valid']) {
    const context = {
      req: { method: 'POST' }, url: { pathname: '/api/product-images/signature' }, res: {},
      requireCreator: async () => scenario !== 'unauthorized',
      process: { env: scenario === 'unconfigured' ? {} : {
        CLOUDINARY_CLOUD_NAME: 'demo-cloud',
        CLOUDINARY_API_KEY: 'public-key',
        CLOUDINARY_API_SECRET: 'private-secret',
      } },
      crypto,
      sendJson: (_res, status, data) => ({ status, data }),
    };
    const result = await vm.runInNewContext(`(async () => {${source.slice(start, end)}})()`, context);
    if (scenario === 'unauthorized') assert.equal(result, undefined);
    else assert.equal(result.status, scenario === 'unconfigured' ? 503 : 200);
    if (scenario === 'valid') {
      assert.equal(result.data.cloudName, 'demo-cloud');
      assert.equal(result.data.apiKey, 'public-key');
      assert.equal(result.data.folder, 'dream4deals/products');
      assert.ok(result.data.signature);
      assert.equal(JSON.stringify(result.data).includes('private-secret'), false);
    }
  }
});

test('Cloudinary cleanup deletes only managed product assets and invalidates the CDN', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf('async function deleteCloudinaryImages(');
  const end = source.indexOf('async function publicSettings(', start);
  const calls = [];
  const context = {
    process: { env: { CLOUDINARY_CLOUD_NAME: 'demo-cloud', CLOUDINARY_API_KEY: 'public-key', CLOUDINARY_API_SECRET: 'private-secret' } },
    crypto,
    URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, body: Object.fromEntries(options.body.entries()) });
      return { ok: true, json: async () => ({ result: 'ok' }) };
    },
  };
  await vm.runInNewContext(`${source.slice(start, end)}; deleteCloudinaryImages([
    'dream4deals/products/managed-image',
    'external/products/not-managed',
    'dream4deals/products/managed-image'
  ])`, context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.cloudinary.com/v1_1/demo-cloud/image/destroy');
  assert.equal(calls[0].body.public_id, 'dream4deals/products/managed-image');
  assert.equal(calls[0].body.invalidate, 'true');
  assert.equal(JSON.stringify(calls[0]).includes('private-secret'), false);
});

test('automation API rejects missing placeholders before saving and accepts custom rules', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf("      if (req.method === 'POST' || req.method === 'PATCH') {", source.indexOf('const reelAutomationMatch'));
  const end = source.indexOf("      if (req.method === 'DELETE')", start);
  for (const replyTemplate of ['Hi {name}', 'Hi {name}: {url}']) {
    let saves = 0;
    const context = {
      req: { method: 'POST' }, res: {}, reelSlug: 'test',
      requireCreator: async () => ({ id: 'creator' }),
      readBody: async () => JSON.stringify({ triggers: ['details'], replyTemplate }), parseJson: JSON.parse,
      automationError, store: { saveReelAutomation: async () => { saves++; return {}; } },
      sendJson: (_res, status) => status,
    };
    const result = await vm.runInNewContext(`(async () => {${source.slice(start, end)}})()`, context);
    assert.equal(result, replyTemplate.includes('{url}') ? 200 : 400);
    assert.equal(saves, replyTemplate.includes('{url}') ? 1 : 0);
  }
});
