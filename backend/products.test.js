const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness(fail = false) {
  const calls = [];
  const client = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('FROM creator_posts')) return { rows: [{ id: 'post', instagram_media_id: 'media', caption: 'Look', image_url: 'https://example.com/post.jpg' }] };
      if (sql.includes('SELECT id, slug FROM reels')) return { rows: [{ id: 'reel-id', slug: 'instagram-media' }] };
      if (fail && sql.includes('INSERT INTO seller_links')) throw new Error('insert failed');
      return { rows: [] };
    },
    release: () => calls.push({ sql: 'RELEASE' }),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8'), {
    module, require: name => name === './db' ? { connect: async () => client } : require(name),
  });
  return { api: module.exports, calls };
}
const product = { name: 'Dress', imageUrl: 'https://example.com/dress.jpg', sellerLinks: [
  { platform: 'flipkart', url: 'https://fktr.in/example', price: 799 },
  { platform: 'meesho', url: 'https://meesho.com/example', price: 599 },
  { platform: 'amazon', url: 'https://amzn.in/example', price: null },
] };
test('saving products persists individual prices and ignores missing prices for the minimum', async () => {
  const h = harness();
  const result = await h.api.saveProductsForPost('creator', 'post', [product]);
  assert.equal(result.reelSlug, 'instagram-media');
  assert.equal(h.calls.find(call => call.sql.includes('INSERT INTO products')).values[6], 599);
  assert.deepEqual(h.calls.filter(call => call.sql.includes('INSERT INTO seller_links')).map(call => call.values[3]), [799, 599, null]);
  assert.deepEqual(h.calls.slice(-2).map(call => call.sql), ['COMMIT', 'RELEASE']);
});
test('failed product replacement rolls back instead of deleting the saved products', async () => {
  const h = harness(true);
  await assert.rejects(h.api.saveProductsForPost('creator', 'post', [product]), /insert failed/);
  assert.deepEqual(h.calls.slice(-2).map(call => call.sql), ['ROLLBACK', 'RELEASE']);
  assert.ok(!h.calls.some(call => call.sql === 'COMMIT'));
});
test('retailer validation accepts short links and rejects lookalike domains and non-HTTPS URLs', () => {
  const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.match(/const AFFILIATE_DOMAINS = .*;/)[0] + '\n' + source.slice(source.indexOf('function validateUrl('), source.indexOf('//', source.indexOf('function validateUrl('))), Object.assign(context, { URL }));
  for (const url of ['https://fktr.in/LLfJWun', 'https://www.flipkart.com/product', 'https://amzn.in/example', 'https://www.meesho.com/af_invite/example']) assert.equal(context.validateUrl(url), true, url);
  for (const url of ['https://flipkart.com.evil.test/product', 'https://notamazon.in/', 'http://fktr.in/example', 'https://user:pass@flipkart.com/']) assert.equal(context.validateUrl(url), false, url);
});
