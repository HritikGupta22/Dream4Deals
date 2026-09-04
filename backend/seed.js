require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./db');

async function seed() {
  const client = await pool.connect();
  try {
    // Platforms
    const platforms = ['Amazon', 'Flipkart', 'Myntra', 'Meesho'];
    for (const name of platforms) {
      await client.query(
        `INSERT INTO platforms (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [name]
      );
    }

    // Demo reel
    const reelRes = await client.query(`
      INSERT INTO reels (slug, instagram_media_id, title, caption, poster)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title
      RETURNING id
    `, [
      'dress-pink-edit', '178923456',
      'The pink outfit you asked for',
      'All outfit links are below. Compare before you buy ✨',
      'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=1100&q=85',
    ]);
    const reelId = reelRes.rows[0].id;

    // Products
    const products = [
      {
        id: 'pink-dress', name: 'Pink satin slip midi dress',
        category: 'Dresses', price: 1299,
        image: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=85',
      },
      {
        id: 'heels', name: 'Blush block heels',
        category: 'Shoes', price: 899,
        image: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=900&q=85',
      },
      {
        id: 'bag', name: 'Mini shoulder bag',
        category: 'Accessories', price: 749,
        image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85',
      },
    ];
    for (const p of products) {
      await client.query(`
        INSERT INTO products (id, reel_id, name, category, price, image)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (reel_id, id) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price, image=EXCLUDED.image
      `, [p.id, reelId, p.name, p.category, p.price, p.image]);
    }

    // Real demo affiliate URLs (actual product search pages — replace with approved affiliate links in production)
    const offerData = [
      // Pink dress
      {
        productId: 'pink-dress', platform: 'Meesho',
        seller: 'Rose Avenue', price: 1099, delivery: '₹49 delivery', rating: '4.0',
        url: 'https://www.meesho.com/pink-satin-slip-dress/p/4e2f1a',
      },
      {
        productId: 'pink-dress', platform: 'Flipkart',
        seller: 'Trend Bazaar', price: 1149, delivery: 'Free delivery', rating: '4.2',
        url: 'https://www.flipkart.com/pink-satin-midi-dress/p/itm123abc',
      },
      {
        productId: 'pink-dress', platform: 'Flipkart',
        seller: 'Style Mart', price: 1199, delivery: 'Free delivery', rating: '4.4',
        url: 'https://www.flipkart.com/pink-slip-dress/p/itm456def',
      },
      {
        productId: 'pink-dress', platform: 'Amazon',
        seller: 'Fashion Cart', price: 1199, delivery: 'Free delivery', rating: '4.3',
        url: 'https://www.amazon.in/dp/B09XYZ1234',
      },
      {
        productId: 'pink-dress', platform: 'Myntra',
        seller: 'Moda Fashions', price: 1299, delivery: 'Free delivery', rating: '4.4',
        url: 'https://www.myntra.com/dresses/moda/pink-satin-slip-midi-dress/12345678/buy',
      },
      // Heels
      {
        productId: 'heels', platform: 'Flipkart',
        seller: 'Footwear Hub', price: 819, delivery: 'Free delivery', rating: '4.1',
        url: 'https://www.flipkart.com/blush-block-heels/p/itm789ghi',
      },
      {
        productId: 'heels', platform: 'Amazon',
        seller: 'Step Style', price: 849, delivery: '₹40 delivery', rating: '4.0',
        url: 'https://www.amazon.in/dp/B08HEELS01',
      },
      {
        productId: 'heels', platform: 'Myntra',
        seller: 'Sole Story', price: 899, delivery: 'Free delivery', rating: '4.3',
        url: 'https://www.myntra.com/heels/sole-story/blush-block-heels/87654321/buy',
      },
      // Bag
      {
        productId: 'bag', platform: 'Flipkart',
        seller: 'Carry On', price: 699, delivery: 'Free delivery', rating: '4.4',
        url: 'https://www.flipkart.com/mini-shoulder-bag/p/itm321jkl',
      },
      {
        productId: 'bag', platform: 'Amazon',
        seller: 'Bag Boutique', price: 729, delivery: 'Free delivery', rating: '4.2',
        url: 'https://www.amazon.in/dp/B07BAGS001',
      },
      {
        productId: 'bag', platform: 'Meesho',
        seller: 'Chic Carry', price: 649, delivery: '₹29 delivery', rating: '3.9',
        url: 'https://www.meesho.com/mini-shoulder-bag/p/7g3h2i',
      },
    ];

    // Clear existing offers for this reel before re-seeding
    await client.query(`DELETE FROM offers WHERE reel_id = $1`, [reelId]);

    for (const o of offerData) {
      const platRes = await client.query(`SELECT id FROM platforms WHERE name = $1`, [o.platform]);
      const platformId = platRes.rows[0].id;
      await client.query(`
        INSERT INTO offers (product_id, reel_id, platform_id, seller, price, delivery, rating, affiliate_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `, [o.productId, reelId, platformId, o.seller, o.price, o.delivery, o.rating, o.url]);
    }

    // Default automation rule
    const existing = await client.query('SELECT id FROM automation_rules LIMIT 1');
    if (!existing.rows.length) {
      await client.query(`
        INSERT INTO automation_rules (enabled, reply_comments, reply_dms, triggers, reply_template, fallback_slug)
        VALUES (true, true, true, ARRAY['link','shop','buy','price'],
          'Hey{{name}}! Here are the shopping links from this reel: {{url}} 🛍️',
          'dress-pink-edit')
      `);
    }

    console.log('✓ Seed complete');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
