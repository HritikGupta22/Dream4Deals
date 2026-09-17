const test = require('node:test');
const assert = require('node:assert/strict');
const { automationError, imageExtension } = require('./studio-inputs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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

test('image uploads recognize raster signatures rather than trusting file names or MIME types', () => {
  assert.equal(imageExtension(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])), 'png');
  assert.equal(imageExtension(Buffer.from([255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpg');
  assert.equal(imageExtension(Buffer.from('GIF89a1234567890')), 'gif');
  assert.equal(imageExtension(Buffer.from('RIFF1234WEBP1234')), 'webp');
  assert.equal(imageExtension(Buffer.from('<svg onload="alert(1)">')), null);
  assert.equal(imageExtension(Buffer.from('<html>not an image</html>')), null);
  assert.equal(imageExtension(Buffer.alloc(0)), null);
});

test('image upload route authenticates, rejects bad bytes, and stores a generated file URL', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const start = source.indexOf("    if (req.method === 'POST' && url.pathname === '/api/product-images')");
  const end = source.indexOf("    if (req.method === 'GET' && url.pathname.startsWith('/api/product-images/'))", start);
  for (const scenario of ['unauthorized', 'invalid', 'large', 'valid']) {
    const writes = [];
    const context = {
      req: { method: 'POST' }, url: { pathname: '/api/product-images' }, res: {},
      requireCreator: async () => scenario !== 'unauthorized',
      readBody: async (_req, limit) => {
        assert.equal(limit, 10 * 1024 * 1024);
        if (scenario === 'large') throw new Error('Image must be 10 MB or smaller.');
        return Buffer.from(scenario === 'invalid' ? '<html>invalid file</html>' : 'GIF89a1234567890');
      },
      imageExtension, crypto: { randomUUID: () => 'generated-id' }, path, UPLOAD_DIR: '/uploads',
      fs: { promises: { writeFile: async (...args) => writes.push(args) } },
      sendJson: (_res, status, data) => ({ status, data }),
    };
    const result = await vm.runInNewContext(`(async () => {${source.slice(start, end)}})()`, context);
    if (scenario === 'unauthorized') assert.equal(result, undefined);
    else assert.equal(result.status, { invalid: 400, large: 413, valid: 201 }[scenario]);
    assert.equal(writes.length, scenario === 'valid' ? 1 : 0);
    if (scenario === 'valid') assert.equal(result.data.url, '/api/product-images/generated-id.gif');
  }
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
