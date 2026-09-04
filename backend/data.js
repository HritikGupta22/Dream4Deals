const reels = [
  {
    slug: 'anaya-pink-edit', instagramMediaId: '178923456',
    creator: { name: 'Dream4Deals', handle: '@dream4deal', followers: 'Instagram creator' },
    title: 'The pink outfit you asked for', caption: 'All outfit links are below. Compare before you buy âœ¨',
    poster: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1100&q=85', videoUrl: '',
    products: [
      { id: 'pink-dress', name: 'Pink satin slip midi dress', category: 'Dresses', price: 1299, image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85' },
      { id: 'heels', name: 'Blush block heels', category: 'Shoes', price: 899, image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=900&q=85' },
      { id: 'bag', name: 'Mini shoulder bag', category: 'Accessories', price: 749, image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85' }
    ]
  }
];
const offers = {
  'pink-dress': [{ platform: 'Meesho', sellers: [{ seller: 'Rose Avenue', price: 1099, rating: '4.0', delivery: 'â‚¹49 delivery', link: 'https://www.meesho.com/' }] }, { platform: 'Flipkart', sellers: [{ seller: 'Trend Bazaar', price: 1149, rating: '4.2', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }, { seller: 'Style Mart', price: 1199, rating: '4.4', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }] }, { platform: 'Amazon', sellers: [{ seller: 'Fashion Cart', price: 1199, rating: '4.3', delivery: 'Free delivery', link: 'https://www.amazon.in/' }] }, { platform: 'Myntra', sellers: [{ seller: 'Moda Fashions', price: 1299, rating: '4.4', delivery: 'Free delivery', link: 'https://www.myntra.com/' }] }],
  heels: [{ platform: 'Flipkart', sellers: [{ seller: 'Footwear Hub', price: 819, rating: '4.1', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }] }],
  bag: [{ platform: 'Flipkart', sellers: [{ seller: 'Carry On', price: 699, rating: '4.4', delivery: 'Free delivery', link: 'https://www.flipkart.com/' }] }]
};
function getReel(slug) { return reels.find((item) => item.slug === slug) || null; }
function getReelByInstagramMediaId(mediaId) { return reels.find((item) => item.instagramMediaId === String(mediaId)) || null; }
function reelUrl(slug) { return `${process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/reel/${slug}`; }
function mappingRows() { return reels.map((item) => ({ instagramMediaId: item.instagramMediaId, slug: item.slug, title: item.title, url: reelUrl(item.slug) })); }
function addReel(item) { reels.push(item); return item; }
function addProduct(slug, product) { const reel = getReel(slug); if (!reel) return null; reel.products.push(product); return product; }
function deleteReel(slug) { const idx = reels.findIndex((r) => r.slug === slug); if (idx === -1) return false; reels.splice(idx, 1); return true; }
function deleteProduct(slug, productId) { const reel = getReel(slug); if (!reel) return false; const idx = reel.products.findIndex((p) => p.id === productId); if (idx === -1) return false; reel.products.splice(idx, 1); return true; }
function updateReel(slug, patch) { const reel = getReel(slug); if (!reel) return null; const allowed = ['title', 'caption', 'poster', 'videoUrl']; for (const key of allowed) { if (patch[key] !== undefined) reel[key] = String(patch[key]); } return reel; }
module.exports = { reels, offers, getReel, getReelByInstagramMediaId, reelUrl, mappingRows, addReel, addProduct, deleteReel, deleteProduct, updateReel };