const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPrice, extractDetails, lookupUrl, allowedUrl, fetchRetailerPrice } = require('./retailer-prices');
const markup = offer => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', offers: offer })}</script>`;

test('extracts the main product name without requiring a price or taking recommendation names', () => {
  const html = value => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
  assert.equal(extractDetails(html({ '@type': 'Product', name: '  Pink   dress  ' })).name, 'Pink dress');
  assert.equal(extractDetails(html({ '@graph': [{ '@type': 'ProductGroup', name: 'Dress', hasVariant: [{ '@type': 'Product', name: 'Dress M' }] }] })).name, 'Dress');
  assert.equal(extractDetails(html({ '@type': 'ItemList', itemListElement: [{ '@type': 'Product', name: 'Recommendation' }] })).name, undefined);
  assert.equal(extractDetails('<title>Access Denied</title>' + html({ '@type': 'Product', name: 'Verification' })).name, undefined);
});

test('lookup returns and caches the product name together with its price', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response('<script type="application/ld+json">{"@type":"Product","name":"Pink Dress","offers":{"price":967,"priceCurrency":"INR"}}</script>', { headers: { 'content-type': 'text/html' } });
  };
  const url = 'https://www.myntra.com/name-extraction-test';
  assert.equal((await fetchRetailerPrice(url, fetcher)).name, 'Pink Dress');
  assert.equal((await fetchRetailerPrice(url, fetcher)).price, 967);
  assert.equal(calls, 1);
});
test('missing metadata uses at most two requests and later visitors do not retry', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('<html>No price</html>', { headers: { 'content-type': 'text/html' } }); };
  const url = 'https://www.meesho.com/s/p/budget-test';
  await Promise.all([fetchRetailerPrice(url, fetcher), fetchRetailerPrice(url, fetcher)]);
  await fetchRetailerPrice(url, fetcher);
  assert.equal(calls, 2);
});
test('stops immediately when price arrives on first or second request', async () => {
  for (const successAt of [1, 2]) {
    let calls = 0;
    const fetcher = async () => new Response(++calls === successAt ? markup({ price: 400, priceCurrency: 'INR' }) : '<html></html>', { headers: { 'content-type': 'text/html' } });
    const url = 'https://www.meesho.com/s/p/success-budget-' + successAt;
    assert.equal((await fetchRetailerPrice(url, fetcher)).price, 400);
    await fetchRetailerPrice(url, fetcher);
    assert.equal(calls, successAt);
  }
});
test('redirects consume the same two-request budget', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://www.flipkart.com/another-redirect' } }); };
  const url = 'https://fktr.in/redirect-budget';
  assert.equal((await fetchRetailerPrice(url, fetcher)).reason, 'request_limit');
  await fetchRetailerPrice(url, fetcher);
  assert.equal(calls, 2);
});
test('saved prices skip retailer requests during enrichment', async () => {
  const { enrichProducts } = require('./retailer-prices');
  const link = { url: 'https://www.flipkart.com/saved-price', price: 450, sizes: ['M'] };
  const [result] = await enrichProducts([{ sellerLinks: [link] }]);
  assert.equal(result.price, 450);
  assert.equal(result.sellerLinks[0], link);
});
test('lookup results and consumed budgets survive a backend restart', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const files = new Map();
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(markup({ price: 650, priceCurrency: 'INR' }), { headers: { 'content-type': 'text/html' } }); };
  const fakeFs = {
    readFileSync: file => { if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(file); },
    mkdirSync: () => {},
    writeFileSync: (file, data) => files.set(file, data),
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from); },
  };
  function restart() {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('./retailer-prices'), 'utf8'), {
      module, __dirname, URL, AbortSignal, TextDecoder, fetch: fetcher,
      require: name => name === 'node:fs' ? fakeFs : require(name),
    });
    return module.exports;
  }
  const url = 'https://www.flipkart.com/restart-test';
  assert.equal((await restart().fetchRetailerPrice(url)).price, 650);
  assert.equal((await restart().fetchRetailerPrice(url)).price, 650);
  assert.equal(calls, 1);
  const ledger = require('node:path').join(__dirname, 'storage', 'retailer-lookups.json');
  files.set(ledger, JSON.stringify([[url, { requests: 2 }]]));
  assert.equal((await restart().fetchRetailerPrice(url)).reason, 'request_limit');
  assert.equal(calls, 1);
});

test('all four platforms resolve short or shared links and affiliate wrappers', async () => {
  const routes = [
    ['https://amzn.in/all-platform-test', 'https://www.amazon.in/dp/test'],
    ['https://amzn.to/all-platform-test', 'https://www.amazon.in/dp/test'],
    ['https://fktr.in/all-platform-test', 'https://www.flipkart.com/product/p/test'],
    ['https://myntr.it/4Uh5K87', 'https://www.myntra.com/dresses/123/buy'],
    ['https://www.meesho.com/af_invite/all-platform-test', 'https://www.meesho.com/dress/p/test'],
  ];
  for (const [short, destination] of routes) {
    for (const wrapped of [false, true]) {
      const input = short + (wrapped ? '?wrapped=1' : '');
      const calls = [];
      const result = await fetchRetailerPrice(input, async url => {
        calls.push(url);
        return url === input
          ? new Response(null, { status: 302, headers: { location: wrapped ? 'https://linkredirect.in/visitretailer/123?dl=' + encodeURIComponent(destination) : destination } })
          : new Response(markup({ price: 799, priceCurrency: 'INR' }), { headers: { 'content-type': 'text/html' } });
      });
      assert.equal(result.status, 'fetched', input);
      assert.equal(result.price, 799, input);
      assert.deepEqual(calls, [input, destination]);
    }
  }
});
test('extracts INR sale prices and ignores out of stock offers', () => {
  assert.equal(extractPrice(markup([{ price: '1,299.50', priceCurrency: 'INR' }, { price: 99, priceCurrency: 'INR', availability: 'https://schema.org/OutOfStock' }])), 1299.5);
});
test('does not mislabel foreign currency, recommendations, or missing prices as INR', () => {
  assert.equal(extractPrice(markup({ price: 10, priceCurrency: 'USD' })), null);
  assert.equal(extractPrice('<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Product","offers":{"price":1,"priceCurrency":"INR"}}]}</script>'), null);
  assert.equal(extractPrice('<html>captcha</html>'), null);
});
test('supports product price meta attributes in either order', () => {
  assert.equal(extractPrice('<meta content="599" property="product:price:amount"><meta property="product:price:currency" content="INR">'), 599);
});
test('rejects credentials, local URLs, custom ports, and retailer lookalikes', () => {
  for (const url of ['http://flipkart.com/', 'https://127.0.0.1/', 'https://flipkart.com.evil.test/', 'https://flipkart.com:4000/', 'https://u:p@flipkart.com/']) assert.equal(allowedUrl(url), false);
});
test('follows short links and reuses the successful lookup', async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    return url.includes('fktr.in') ? new Response(null, { status: 302, headers: { location: 'https://www.flipkart.com/test-product' } }) : new Response(markup({ price: 749, priceCurrency: 'INR' }), { headers: { 'content-type': 'text/html' } });
  };
  assert.equal((await fetchRetailerPrice('https://fktr.in/unit-test', fetcher)).price, 749);
  assert.equal((await fetchRetailerPrice('https://fktr.in/unit-test', fetcher)).price, 749);
  assert.equal(calls.length, 2);
});
test('does not follow short links to unapproved destinations', async () => {
  let calls = 0;
  const result = await fetchRetailerPrice('https://fktr.in/bad-test', async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  });
  assert.equal(result.price, null);
  assert.equal(calls, 1);
});
test('retailer rejection fails gracefully without inventing a price', async () => {
  const result = await fetchRetailerPrice('https://www.meesho.com/test-blocked', async () => new Response('Forbidden', { status: 403 }));
  assert.equal(result.price, null);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'blocked');
});
test('Flipkart lookup removes campaign parameters but preserves product and seller selection', async () => {
  const original = 'https://www.flipkart.com/top/p/item?pid=TOP1&lid=SELLER1&affid=creator&affExtParam1=campaign';
  const canonical = 'https://www.flipkart.com/top/p/item?pid=TOP1&lid=SELLER1';
  assert.equal(lookupUrl(original), canonical);
  const result = await fetchRetailerPrice(original, async url => {
    assert.equal(url, canonical);
    return new Response(markup({ price: 300, priceCurrency: 'INR' }), { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(result.price, 300);
  assert.equal(lookupUrl('https://www.meesho.com/s/p/abc?pid=affiliate'), 'https://www.meesho.com/s/p/abc?pid=affiliate');
});
test('HTTP 200 verification pages report blocked rather than missing product metadata', async () => {
  const result = await fetchRetailerPrice('https://www.meesho.com/s/p/challenge', async () => new Response('<div id="sec-if-cpt-container">Verification</div>', { headers: { 'content-type': 'text/html' } }));
  assert.equal(result.reason, 'blocked');
  assert.equal(result.price, null);
});
test('extracts structured sizes, excluding sold-out variants and recommendations', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ProductGroup', hasVariant: [
    { '@type': 'Product', size: 'M', offers: { availability: 'https://schema.org/InStock', shippingDetails: { shippingRate: { currency: 'INR', value: 0 } } } },
    { '@type': 'Product', size: 'L', offers: { availability: 'https://schema.org/OutOfStock' } }
  ] })}</script>`;
  const result = extractDetails(html);
  assert.deepEqual(result.sizes, ['M']);
  assert.equal(result.delivery, undefined);
  assert.deepEqual(extractDetails('<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Product","size":"XL"}]}</script>').sizes, []);
});
test('size links must belong to the same Flipkart product, not recommendations or another store', () => {
  const html = '<a href="/top/p/item?pid=M&amp;swatchAttr=size"><span>M</span></a><a href="/other/p/item?swatchAttr=size">S</a><a href="https://evil.test/top/p/item?swatchAttr=size">XL</a>';
  assert.deepEqual(extractDetails(html, 'https://www.flipkart.com/top/p/item?pid=L').sizes, ['M']);
  assert.deepEqual(extractDetails(html, 'https://www.meesho.com/top/p/item').sizes, []);
});
test('unwraps affiliate intermediary deep links without contacting the tracking host', async () => {
  const calls = [];
  const result = await fetchRetailerPrice('https://fktr.in/wrapped-test', async url => {
    calls.push(url);
    return url.includes('fktr.in')
      ? new Response(null, { status: 301, headers: { location: 'https://linkredirect.in/visitretailer/2276?dl=https%3A%2F%2Fdl.flipkart.com%2Fs%2Ftest' } })
      : new Response(markup({ price: 499, priceCurrency: 'INR' }), { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(result.price, 499);
  assert.deepEqual(calls, ['https://fktr.in/wrapped-test', 'https://dl.flipkart.com/s/test']);
});
test('rejects private or lookalike destinations hidden inside affiliate wrappers', async () => {
  for (const target of ['https://127.0.0.1/private', 'https://flipkart.com.evil.test/product']) {
    let calls = 0;
    const result = await fetchRetailerPrice('https://fktr.in/wrapped-bad-' + encodeURIComponent(target), async () => {
      calls++;
      return new Response(null, { status: 301, headers: { location: 'https://linkredirect.in/visitretailer/2276?dl=' + encodeURIComponent(target) } });
    });
    assert.equal(result.reason, 'unsupported_redirect');
    assert.equal(calls, 1);
  }
});
test('resolves Meesho invite web destinations without fetching the app-link host', async () => {
  const calls = [];
  const result = await fetchRetailerPrice('https://www.meesho.com/af_invite/unit-test', async url => {
    calls.push(url);
    return url.includes('af_invite')
      ? new Response(null, { status: 302, headers: { location: 'https://meesho.onelink.me/2yoV?af_web_dp=https%3A%2F%2Fwww.meesho.com%2Fs%2Fp%2Ftest' } })
      : new Response(markup({ price: 349, priceCurrency: 'INR' }), { headers: { 'content-type': 'text/html' } });
  });
  assert.equal(result.price, 349);
  assert.deepEqual(calls, ['https://www.meesho.com/af_invite/unit-test', 'https://www.meesho.com/s/p/test']);
});
test('rejects unsafe Meesho app-link web destinations', async () => {
  for (const target of ['https://127.0.0.1/', 'https://meesho.com.evil.test/', 'http://www.meesho.com/product']) {
    let calls = 0;
    const result = await fetchRetailerPrice('https://www.meesho.com/af_invite/' + encodeURIComponent(target), async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: 'https://meesho.onelink.me/2yoV?af_web_dp=' + encodeURIComponent(target) } });
    });
    assert.equal(result.reason, 'unsupported_redirect');
    assert.equal(calls, 1);
  }
});
