const test = require('node:test');
const assert = require('node:assert/strict');
const { extractPrice, allowedUrl, fetchRetailerPrice } = require('./retailer-prices');
const markup = offer => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', offers: offer })}</script>`;
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
});
