const DOMAINS = ['amazon.in', 'amazon.com', 'amzn.in', 'amzn.to', 'flipkart.com', 'fktr.in', 'meesho.com', 'myntra.com', 'myntr.it'];
const fs = require('node:fs');
const path = require('node:path');
const cacheFile = path.join(__dirname, 'storage', 'retailer-lookups.json');
// Persist the request budget as well as results so restarts do not retry links.
let cache = new Map();
try { cache = new Map(JSON.parse(fs.readFileSync(cacheFile, 'utf8'))); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const testCache = new Map();
function persist() {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile + '.tmp', JSON.stringify([...cache]));
  fs.renameSync(cacheFile + '.tmp', cacheFile);
}
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
// Lookup URLs are separate from the original links used for affiliate checkout.
function lookupUrl(value) {
  const url = new URL(value);
  if (/(^|\.)flipkart\.com$/.test(url.hostname) && url.pathname.includes('/p/')) {
    for (const key of [...url.searchParams.keys()]) {
      if (!['pid', 'lid', 'marketplace'].includes(key)) url.searchParams.delete(key);
    }
  }
  return url.href;
}
function redirectTarget(location, source) {
  const target = new URL(location, source);
  if (target.origin === 'https://meesho.onelink.me') {
    const webLink = target.searchParams.get('af_web_dp');
    if (allowedUrl(webLink) && /(^|\.)meesho\.com$/.test(new URL(webLink).hostname)) return webLink;
  }
  // These short links wrap a retailer deep link. Read it without fetching the
  // tracking intermediary, and retain the retailer-only network allowlist.
  if (target.origin === 'https://linkredirect.in' && /^\/visitretailer\/\d+$/.test(target.pathname)) {
    const deepLink = target.searchParams.get('dl');
    if (allowedUrl(deepLink)) return deepLink;
  }
  return target.href;
}
function extractDetails(html, url) {
  const sizes = new Set();
  let name;
  const addSize = value => {
    for (const size of [].concat(value || [])) {
      const label = typeof size === 'object' ? size.name : size;
      if (typeof label === 'string' && label.length <= 40) sizes.add(label);
    }
  };
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const types = [].concat(value['@type'] || []).map(t => String(t).split('/').pop());
    if (types.includes('Product') || types.includes('ProductGroup')) {
      if (!name && typeof value.name === 'string') name = value.name.replace(/\s+/g, ' ').trim().slice(0, 500) || undefined;
      const offers = [].concat(value.offers || []);
      if (!offers.length || offers.some(o => !/OutOfStock|Discontinued|SoldOut/.test(o.availability || ''))) addSize(value.size);
      if (value.hasVariant) visit(value.hasVariant);
      return;
    }
    if (value['@graph']) visit(value['@graph']);
    if (value.mainEntity) visit(value.mainEntity);
  }
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* Invalid metadata. */ }
  }
  // Flipkart publishes size options as links to variants of the same product.
  if (url && /(^|\.)flipkart\.com$/.test(new URL(url).hostname)) {
    for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
      try {
        const variant = new URL(match[2].replace(/&amp;/g, '&'), url);
        if (variant.origin !== new URL(url).origin || variant.pathname !== new URL(url).pathname || variant.searchParams.get('swatchAttr') !== 'size') continue;
        const label = match[3].replace(/<[^>]*>/g, '').trim();
        if (/^(?:[2-6]?X{0,3}[SML]|[0-9]{1,3}(?:\.[05])?|Free Size)$/i.test(label)) addSize(label);
      } catch { /* Invalid variant link. */ }
    }
  }
  const price = extractPrice(html);
  const blocked = /sec-if-cpt-container|captcha|Access Denied|cf-chl-/i.test(html);
  return { price, ...(name && !blocked ? { name } : {}), sizes: [...sizes], reason: price ? undefined : blocked ? 'blocked' : 'metadata_missing' };
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
async function retrieve(url, fetcher, entry, reserve) {
  const signal = AbortSignal.timeout(8000);
  while (entry.requests < 2) {
    if (!allowedUrl(url)) throw new Error('unsupported_redirect');
    url = lookupUrl(url);
    entry.requests++;
    reserve();
    const response = await fetcher(url, { redirect: 'manual', signal, headers: { Accept: 'text/html', 'User-Agent': 'Dream4Deals/1.0 (product price comparison)' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = redirectTarget(response.headers.get('location'), url);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error([403, 429].includes(response.status) ? 'blocked' : 'retailer_unavailable'); }
    if (!response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('Not a product page'); }
    let html = '', bytes = 0;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2_000_000) throw new Error('Product page too large');
      html += decoder.decode(chunk, { stream: true });
    }
    html += decoder.decode();
    const details = extractDetails(html, url);
    if (details.price || details.reason === 'blocked' || entry.requests >= 2) return details;
  }
  throw new Error('request_limit');
}
async function fetchRetailerPrice(url, fetcher = fetch) {
  url = String(url || '').trim();
  if (!allowedUrl(url)) return { price: null, status: 'unsupported' };
  url = lookupUrl(url);
  const entries = fetcher === fetch ? cache : testCache;
  const previous = entries.get(url);
  if (previous?.result) return previous.result;
  if (previous?.requests >= 2) return { price: null, sizes: [], status: 'unavailable', reason: 'request_limit' };
  if (pending.has(url)) return pending.get(url);
  if (queue.length > 100) return { price: null, status: 'unavailable' };
  const promise = (async () => {
    if (active >= 4) await new Promise(resolve => queue.push(resolve));
    else active++;
    let result;
    const entry = previous || { requests: 0 };
    entries.set(url, entry);
    const save = () => { if (fetcher === fetch) persist(); };
    try {
      const details = await retrieve(url, fetcher, entry, save);
      result = { ...details, currency: 'INR', status: details.price ? 'fetched' : 'unavailable', checkedAt: new Date().toISOString() };
    } catch (error) {
      const reason = ['blocked', 'unsupported_redirect', 'retailer_unavailable', 'request_limit'].includes(error.message) ? error.message : error.name === 'TimeoutError' ? 'timeout' : 'lookup_failed';
      result = { price: null, sizes: [], status: 'unavailable', reason, checkedAt: new Date().toISOString() };
    } finally { if (queue.length) queue.shift()(); else active--; }
    entry.result = { ...result, requests: entry.requests };
    save();
    return entry.result;
  })();
  pending.set(url, promise);
  try { return await promise; } finally { pending.delete(url); }
}
async function enrichProducts(products) {
  return Promise.all(products.map(async product => {
    const sellerLinks = await Promise.all((product.sellerLinks || []).map(async link => Number(link.price) > 0 ? link : ({ ...link, ...await fetchRetailerPrice(link.url) })));
    const prices = sellerLinks.map(link => link.price).filter(price => price > 0);
    return { ...product, sellerLinks, price: prices.length ? Math.min(...prices) : 0 };
  }));
}
module.exports = { allowedUrl, lookupUrl, extractPrice, extractDetails, fetchRetailerPrice, enrichProducts };
