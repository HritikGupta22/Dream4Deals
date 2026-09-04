const reels = [
  {
    slug: 'dress-pink-edit', instagramMediaId: '178923456',
    creator: { name: 'Dream4Deals', handle: '@dream4deal', followers: 'Instagram creator' },
    title: 'The pink outfit you asked for', caption: 'All outfit links are below. Compare before you buy ✨',
    poster: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1100&q=85', videoUrl: '',
    products: [
      { id: 'pink-dress', name: 'Pink satin slip midi dress', category: 'Dresses', price: 1299, image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85' },
      { id: 'heels', name: 'Blush block heels', category: 'Shoes', price: 899, image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=900&q=85' },
      { id: 'bag', name: 'Mini shoulder bag', category: 'Accessories', price: 749, image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85' },
    ],
  },
];

const offers = {
  'pink-dress': [
    { platform: 'Meesho', sellers: [{ seller: 'Rose Avenue', price: 1099, rating: '4.0', delivery: '₹49 delivery', link: 'https://www.meesho.com/' }] },
    { platform: 'Flipkart', sellers: [{ seller: 'Trend Bazaar', price: 1149, rating: '4.2', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }, { seller: 'Style Mart', price: 1199, rating: '4.4', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }] },
    { platform: 'Amazon', sellers: [{ seller: 'Fashion Cart', price: 1199, rating: '4.3', delivery: 'Free delivery', link: 'https://www.amazon.in/' }] },
    { platform: 'Myntra', sellers: [{ seller: 'Moda Fashions', price: 1299, rating: '4.4', delivery: 'Free delivery', link: 'https://www.myntra.com/' }] },
  ],
  heels: [{ platform: 'Flipkart', sellers: [{ seller: 'Footwear Hub', price: 819, rating: '4.1', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }] }],
  bag:   [{ platform: 'Flipkart', sellers: [{ seller: 'Carry On',     price: 699, rating: '4.4', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }] }],
};

function getReel(slug) { return reels.find((r) => r.slug === slug) || null; }
function getReelByInstagramMediaId(mediaId) { return reels.find((r) => r.instagramMediaId === String(mediaId)) || null; }
function reelUrl(slug) { return `${process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/reel/${slug}`; }
function mappingRows() { return reels.map((r) => ({ instagramMediaId: r.instagramMediaId, slug: r.slug, title: r.title, url: reelUrl(r.slug) })); }

function addReel(item) { reels.push(item); return item; }

function deleteReel(slug) {
  const idx = reels.findIndex((r) => r.slug === slug);
  if (idx === -1) return false;
  reels.splice(idx, 1);
  return true;
}

function updateReel(slug, patch) {
  const reel = getReel(slug);
  if (!reel) return null;
  for (const key of ['title', 'caption', 'poster', 'videoUrl']) {
    if (patch[key] !== undefined) reel[key] = String(patch[key]);
  }
  return reel;
}

function addProduct(slug, product) {
  const reel = getReel(slug);
  if (!reel) return null;
  reel.products.push(product);
  return product;
}

function updateProduct(slug, productId, patch) {
  const reel = getReel(slug);
  if (!reel) return null;
  const product = reel.products.find((p) => p.id === productId);
  if (!product) return null;
  if (patch.name)              product.name     = String(patch.name);
  if (patch.category)          product.category = String(patch.category);
  if (patch.price !== undefined) product.price  = Number(patch.price);
  if (patch.image)             product.image    = String(patch.image);
  return product;
}

function deleteProduct(slug, productId) {
  const reel = getReel(slug);
  if (!reel) return false;
  const idx = reel.products.findIndex((p) => p.id === productId);
  if (idx === -1) return false;
  reel.products.splice(idx, 1);
  return true;
}

module.exports = { reels, offers, getReel, getReelByInstagramMediaId, reelUrl, mappingRows, addReel, deleteReel, updateReel, addProduct, updateProduct, deleteProduct };
