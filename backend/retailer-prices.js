const DOMAINS = ['amazon.in', 'amazon.com', 'amzn.in', 'amzn.to', 'flipkart.com', 'fktr.in', 'meesho.com', 'myntra.com'];
const cache = new Map();
const pending = new Map();
let active = 0;
const queue = [];
function allowedUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && DOMAINS.some(d => u.hostname === d || u.hostname.endsWith('.' + d));
  } catch { return false; }
}
function number(value) {
  const result = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(result) && result > 0 ? result : null;
}
function extractPrice(html) {
  const prices = [];
  function offer(value) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!item || typeof item !== 'object') continue;
      if (String(item.priceCurrency || '').toUpperCase() !== 'INR') continue;
      if (/OutOfStock|Discontinued|SoldOut/.test(item.availability || '')) continue;
      if (item.priceValidUntil && new Date(item.priceValidUntil).getTime() < Date.now() - 86400000) continue;
      const price = number(item.price ?? item.lowPrice);
      if (price) prices.push(price);
    }
  }
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const types = [].concat(value['@type'] || []).map(t => String(t).split('/').pop());
    if (types.includes('Product')) { offer(value.offers); return; }
    // Do not use prices from recommendations or a category ItemList.
    if (value['@graph']) visit(value['@graph']);
    if (value.mainEntity) visit(value.mainEntity);
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Invalid retailer metadata. */ }
  }
  if (prices.length) return Math.min(...prices);
  const meta = {};
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const attr of match[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) attrs[attr[1].toLowerCase()] = attr[3];
    meta[attrs.property || attrs.name || attrs.itemprop] = attrs.content;
  }
  if (String(meta['product:price:currency'] || meta['og:price:currency'] || meta.priceCurrency).toUpperCase() !== 'INR') return null;
  return number(meta['product:price:amount'] || meta['og:price:amount'] || meta.price);
}
async function retrieve(url, fetcher) {
  const signal = AbortSignal.timeout(8000);
  for (let hop = 0; hop < 6; hop++) {
    if (!allowedUrl(url)) throw new Error('Unsupported retailer redirect');
    const response = await fetcher(url, { redirect: 'manual', signal, headers: { Accept: 'text/html', 'User-Agent': 'Dream4Deals/1.0 (product price comparison)' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = new URL(response.headers.get('location'), url).href;
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Retailer unavailable'); }
    if (!response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('Not a product page'); }
    let html = '', bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2_000_000) throw new Error('Product page too large');
      html += decoder.decode(chunk, { stream: true });
    }
    html += decoder.decode();
    return extractPrice(html);
  }
  throw new Error('Too many redirects');
}
async function fetchRetailerPrice(url, fetcher = fetch) {
  url = String(url || '').trim();
  if (!allowedUrl(url)) return { price: null, status: 'unsupported' };
  const previous = cache.get(url);
  if (previous && previous.expires > Date.now()) return previous.result;
  if (pending.has(url)) return pending.get(url);
  if (queue.length > 100) return { price: null, status: 'unavailable' };
  const promise = (async () => {
    if (active >= 4) await new Promise(resolve => queue.push(resolve));
    else active++;
    let result;
    try {
      const price = await retrieve(url, fetcher);
      result = { price, currency: 'INR', status: price ? 'fetched' : 'unavailable', checkedAt: new Date().toISOString() };
    } catch {
      result = { price: null, status: 'unavailable', checkedAt: new Date().toISOString() };
    } finally { if (queue.length) queue.shift()(); else active--; }
    if (cache.size >= 1000) cache.delete(cache.keys().next().value);
    cache.set(url, { result, expires: Date.now() + (result.price ? 15 * 60_000 : 60_000) });
    return result;
  })();
  pending.set(url, promise);
  try { return await promise; } finally { pending.delete(url); }
}
async function enrichProducts(products) {
  return Promise.all(products.map(async product => {
    const sellerLinks = await Promise.all((product.sellerLinks || []).map(async link => ({ ...link, ...await fetchRetailerPrice(link.url) })));
    const prices = sellerLinks.map(link => link.price).filter(price => price > 0);
    return { ...product, sellerLinks, price: prices.length ? Math.min(...prices) : 0 };
  }));
}
module.exports = { allowedUrl, extractPrice, fetchRetailerPrice, enrichProducts };
