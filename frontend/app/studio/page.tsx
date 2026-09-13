'use client';

import { useState, useEffect, useCallback } from 'react';

import Image from 'next/image';

const API_URL = '';

type Stage = 'auth' | 'posts' | 'products' | 'automation';

interface Creator {
  id: string;
  name: string;
  handle: string;
  email: string;
}

interface SellerLink {
  platform: string;
  url: string;
  price?: number | null;
  status?: 'loading' | 'fetched' | 'unavailable' | 'unsupported';
}

interface StudioProduct {
  id: number | string;
  name: string;
  imageUrl: string;
  sellerLinks: SellerLink[];
}

interface InstagramPost {
  id: string;
  instagramMediaId: string;
  reelSlug?: string;
  caption: string;
  imageUrl: string;
  products?: StudioProduct[];
}

type ValidationErrors = Record<string, string[]>;

function messageFromError(error: unknown, fallback = 'Something went wrong.') {
  return error instanceof Error ? error.message : fallback;
}

// Validation functions
const validateProductName = (name: string) => name.trim().length > 0;
const validateImageUrl = (url: string) => {
  try {
    new URL(url);
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

const validateSellerUrl = (url: string) => {
  try {
    const u = new URL(url);
    const allowedDomains = ['amazon.in', 'amazon.com', 'flipkart.com', 'myntra.com', 'meesho.com', 'fktr.in', 'amzn.in', 'amzn.to'];
    const isHttps = u.protocol === 'https:';
    const isDomainAllowed = allowedDomains.some(domain => u.hostname === domain || u.hostname.endsWith('.' + domain));
    return isHttps && !u.username && !u.password && isDomainAllowed;
  } catch {
    return false;
  }
};

export default function StudioPage() {
  const [stage, setStage] = useState<Stage>('auth');
  const [user, setUser] = useState<Creator | null>(null);
  const [posts, setPosts] = useState<InstagramPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<InstagramPost | null>(null);
  const [products, setProducts] = useState<StudioProduct[]>([]);
  const [automation, setAutomation] = useState({ enabled: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});

  const handleInstagramOAuth = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await fetch(`${API_URL}/api/auth/instagram-oauth-url`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate Instagram OAuth URL');
      }

      window.location.href = data.oauth_url;
    } catch (e) {
      setError('Failed to start Instagram OAuth: ' + messageFromError(e));
    } finally {
      setLoading(false);
    }
  };



  const fetchPosts = useCallback(async (token: string | null) => {
    if (!token) throw new Error('Sign in required.');
    try {
      setLoading(true);
      setError('');
      
      // First, sync posts from Meta API
      const syncRes = await fetch(`${API_URL}/api/creator/sync-instagram-posts`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (syncRes.ok) {
        const syncData = await syncRes.json();
        setPosts(syncData.posts);
      } else {
        // If sync fails, try to fetch stored posts
        const res = await fetch(`${API_URL}/api/creator/instagram-posts`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setPosts(data.posts);
      }
    } catch (e) {
      setError(messageFromError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('dream4deals_token');
    if (!token) return;
    let active = true;
    fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        if (!response.ok) throw new Error('Not authenticated');
        const data = await response.json();
        if (!active) return;
        setUser(data.user);
        setStage('posts');
        void fetchPosts(token);
      })
      .catch(() => {
        if (!active) return;
        localStorage.removeItem('dream4deals_token');
        setUser(null);
        setStage('auth');
      });
    return () => { active = false; };
  }, [fetchPosts]);

  const handlePostSelect = (post: InstagramPost) => {
    setError('');
    setSuccess('');
    setSelectedPost(post);
    setStage('products');
    setProducts(post.products?.length ? post.products : [{ id: `draft-${post.id}`, name: '', imageUrl: '', sellerLinks: [{ platform: 'flipkart', url: '' }] }]);
    setValidationErrors({});
  };

  const handleAddProduct = () => {
    const newProduct = {
      id: Date.now(),
      name: '',
      imageUrl: '',
      sellerLinks: [{ platform: 'flipkart', url: '' }] as SellerLink[]
    };
    setProducts([...products, newProduct]);
  };

  const handleDeleteProduct = (id: StudioProduct['id']) => {
    if (confirm('Delete this product? This action cannot be undone.')) {
      setProducts(products.filter(p => p.id !== id));
      const newErrors = { ...validationErrors };
      delete newErrors[String(id)];
      setValidationErrors(newErrors);
    }
  };

  const handleUpdateProduct = (id: StudioProduct['id'], field: 'name' | 'imageUrl', value: string) => {
    setProducts(products.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
    // Clear validation error for this field
    if (validationErrors[String(id)]) {
      setValidationErrors({
        ...validationErrors,
        [id]: validationErrors[String(id)].filter((validationError: string) => !validationError.startsWith(field))
      });
    }
  };

  const handleAddSellerLink = (productId: StudioProduct['id']) => {
    setProducts(products.map(p => 
      p.id === productId 
        ? { ...p, sellerLinks: [...(p.sellerLinks || []), { platform: 'amazon', url: '' }] }
        : p
    ));
  };

  const handleDeleteSellerLink = (productId: StudioProduct['id'], linkIndex: number) => {
    setProducts(products.map(p => 
      p.id === productId 
        ? { ...p, sellerLinks: p.sellerLinks.filter((_, idx) => idx !== linkIndex) }
        : p
    ));
  };

  const handleUpdateSellerLink = (productId: StudioProduct['id'], linkIndex: number, field: keyof SellerLink, value: string) => {
    setValidationErrors(previous => ({ ...previous, [productId]: (previous[productId] || []).filter(error => !error.startsWith('sellerLink')) }));
    setError('');
    setProducts(products.map(p => 
      p.id === productId 
        ? {
            ...p,
            sellerLinks: p.sellerLinks.map((link, idx) =>
              idx === linkIndex ? { ...link, [field]: value, ...(field === 'url' ? { price: null, status: undefined } : {}) } : link
            )
          }
        : p
    ));
  };

  const lookupPrice = async (productId: StudioProduct['id'], index: number, url: string) => {
    if (!validateSellerUrl(url)) return;
    const update = (result: Partial<SellerLink>) => setProducts(previous => previous.map(product => product.id === productId
      ? { ...product, sellerLinks: product.sellerLinks.map((link, i) => i === index && link.url === url ? { ...link, ...result } : link) } : product));
    update({ status: 'loading', price: null });
    try {
      const response = await fetch('/api/creator/retailer-price', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('dream4deals_token')}` },
        body: JSON.stringify({ url }),
      });
      if (!response.ok) throw new Error('Price lookup unavailable');
      update(await response.json());
    } catch { update({ status: 'unavailable', price: null }); }
  };

  const validateProducts = () => {
    const errors: ValidationErrors = {};
    let hasErrors = false;

    products.forEach(product => {
      const productErrors = [];

      if (!validateProductName(product.name)) {
        productErrors.push('name: Product name is required');
        hasErrors = true;
      }

      if (!validateImageUrl(product.imageUrl)) {
        productErrors.push('imageUrl: Valid image URL (HTTP/HTTPS) is required');
        hasErrors = true;
      }

      if (!product.sellerLinks || product.sellerLinks.length === 0) {
        productErrors.push('sellerLinks: At least 1 seller link is required');
        hasErrors = true;
      } else if (product.sellerLinks.length > 10) {
        productErrors.push('sellerLinks: Maximum 10 seller links allowed');
        hasErrors = true;
      } else {
        product.sellerLinks.forEach((link, idx) => {
          if (!link.url) {
            productErrors.push(`sellerLink${idx}: Seller link URL is required`);
            hasErrors = true;
          } else if (!validateSellerUrl(link.url)) {
            productErrors.push(`sellerLink${idx}: URL must be HTTPS and from approved domains (Amazon, Flipkart, Meesho, Myntra)`);
            hasErrors = true;
          }
        });
      }

      if (productErrors.length > 0) {
        errors[product.id] = productErrors;
      }
    });

    setValidationErrors(errors);
    return !hasErrors;
  };

  const handleSaveProducts = async () => {
    if (!selectedPost) {
      setError('Select an Instagram post before adding products.');
      return;
    }
    if (!validateProducts()) {
      setError('Please fix validation errors before saving');
      return;
    }

    const token = localStorage.getItem('dream4deals_token');
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      // The backend attaches these products to the selected Instagram post and
      // creates/reuses its public Dream4Deals reel page.
      const productsData = products.map(p => ({
        name: p.name,
        imageUrl: p.imageUrl,
        sellerLinks: p.sellerLinks.map(link => ({ platform: link.platform, url: link.url.trim() })),
      }));

      const res = await fetch(`${API_URL}/api/creator/posts/${selectedPost.id}/products`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ products: productsData })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save products');
      if (data.reelSlug) {
        setSelectedPost({ ...selectedPost, reelSlug: data.reelSlug });
      }
      
      setPosts(previous => previous.map(post => post.id === selectedPost.id ? { ...post, products, reelSlug: data.reelSlug || post.reelSlug } : post));
      setSuccess('✅ Products saved successfully!');
      setTimeout(() => {
        setStage('automation');
      }, 1500);
    } catch (e) {
      setError(messageFromError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAutomation = async () => {
    if (!selectedPost?.reelSlug) {
      setError('Save the products first so Dream4Deals can create this post’s public reel page.');
      return;
    }
    const token = localStorage.getItem('dream4deals_token');
    try {
      setLoading(true);
      setError('');
      setSuccess('');

      const res = await fetch(`${API_URL}/api/reels/${selectedPost.reelSlug}/automation`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          enabled: automation.enabled,
          replyComments: true,
          replyDms: true,
          triggers: ['LINK', 'SHOP', 'BUY'],
          replyTemplate: 'Hi {name}! Check out this reel and shop the look: {url}'
        })
      });

      if (!res.ok) throw new Error('Failed to save automation settings');
      
      setSuccess('✅ Automation settings saved!');
      setTimeout(() => {
        setStage('posts');
        setPosts([]);
      }, 1500);
    } catch (e) {
      setError(messageFromError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleTestAutomation = async () => {
    if (!selectedPost?.instagramMediaId) {
      setError('Select an Instagram post before testing automation.');
      return;
    }
    const token = localStorage.getItem('dream4deals_token');
    try {
      setLoading(true);
      setError('');
      setSuccess('');
      const res = await fetch(`${API_URL}/api/webhooks/test`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'comment',
          text: 'LINK',
          mediaId: selectedPost.instagramMediaId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Automation test failed.');
      const result = data.results?.[0];
      if (result?.status !== 'simulated') {
        throw new Error(`Automation test result: ${result?.status || 'unknown'}`);
      }
      setSuccess(`Test passed: LINK matched the rule for ${result.reelSlug}. No Instagram message was sent.`);
    } catch (e) {
      setError(messageFromError(e, 'Automation test failed.'));
    } finally {
      setLoading(false);
    }
  };

  // Auth Stage - ONLY Instagram OAuth
  if (stage === 'auth') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-5xl font-bold mb-3">Dream4Deals</h1>
          <p className="text-gray-300 mb-12 text-lg">Creator Studio - Monetize Your Instagram</p>

          <div>
            <button
              onClick={handleInstagramOAuth}
              disabled={loading}
              className="w-full bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700 text-white font-bold py-4 rounded-lg transition disabled:opacity-50 transform hover:scale-105 duration-200 text-lg"
            >
              {loading ? '⏳ Connecting...' : '📱 Connect Instagram Account'}
            </button>

            <p className="text-gray-400 text-sm mt-6">
              Sign in with your Instagram account to manage products and earn through affiliate links
            </p>
          </div>

          {error && <p className="text-red-400 mt-6 bg-red-900 bg-opacity-30 p-3 rounded">{error}</p>}
        </div>
      </div>
    );
  }

  // Posts Grid Stage
  if (stage === 'posts') {
    return (
      <div className="studio-shell min-h-screen text-white p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold">{user?.name ? `${user.name}’s posts` : "Your Instagram Posts"}</h1>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setLoading(true);
                  fetchPosts(localStorage.getItem('dream4deals_token'));
                }}
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded disabled:opacity-50"
              >
                {loading ? 'Syncing...' : '🔄 Sync Posts'}
              </button>
              <button
                onClick={() => {
                  localStorage.removeItem('dream4deals_token');
                  setUser(null);
                  setStage('auth');
                }}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded"
              >
                Logout
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-400">Loading posts...</p>
          ) : posts.length === 0 ? (
            <p className="text-gray-400">No posts found. Make sure your Instagram account is connected.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {posts.map(post => (
                <div
                  key={post.id}
                  className="group"
                >
                  <div className="relative bg-gray-800 rounded-lg overflow-hidden aspect-square">
                    <Image src={post.imageUrl || "/window.svg"} alt={post.caption || "Instagram post"} fill sizes="(max-width: 768px) 45vw, 25vw" className="object-cover" />

                    <div className="post-actions absolute inset-0 grid grid-rows-[1fr_auto] bg-black/45 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <button type="button" onClick={() => handlePostSelect(post)} className="text-white font-semibold flex items-center justify-center">
                        <span className="rounded-xl border border-white/60 bg-black/25 px-4 py-3 backdrop-blur-sm">Add Products</span>
                      </button>
                      <a href={`/reel/${encodeURIComponent(post.reelSlug || `instagram-${post.instagramMediaId}`)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="min-h-11 flex items-center justify-center gap-2 border-t border-white/20 bg-white/95 text-gray-900 text-xs font-semibold px-3 py-2">
                        <span aria-hidden="true">&#8599;</span> Go to product link
                      </a>
                    </div>
                  </div>
                  <p className="text-sm text-gray-400 mt-2 truncate">{post.caption}</p>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-red-500 mt-4">{error}</p>}
        </div>
      </div>
    );
  }

  // Products Editor Stage
  if (stage === 'products') {
    return (
      <div className="studio-shell min-h-screen text-white p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          <button onClick={() => setStage('posts')} className="mb-6 text-blue-400 hover:text-blue-300">← Back to Posts</button>

          <div className="flex justify-between items-start gap-4 mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">Add Products to Reel</h1>
              <p className="text-sm text-gray-400 line-clamp-2 mt-2">{selectedPost?.caption}</p>
            </div>
            <div className="bg-blue-900 px-3 py-1 rounded-full text-xs whitespace-nowrap">
              {products.length} product{products.length !== 1 ? 's' : ''}
            </div>
          </div>

          {success && <div className="bg-green-900 text-green-200 p-3 rounded mb-4">{success}</div>}
          {error && <div className="bg-red-900 text-red-200 p-3 rounded mb-4">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-start">
            {products.map(product => (
              <details key={product.id} open className="product-editor-card bg-gray-800/80 rounded-2xl border border-gray-700 shadow-lg overflow-hidden">
                <summary className="cursor-pointer p-5 flex items-center gap-3 select-none">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/20 text-purple-200 font-semibold">{products.indexOf(product) + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{product.name || `Product ${products.indexOf(product) + 1}`}</span><span className="text-xs text-gray-400">{product.sellerLinks.length} store links{validationErrors[product.id]?.length ? ' - Needs attention' : ''}</span></span>
                  <span className="expand-indicator text-xl text-purple-200" aria-hidden="true">+</span>
                </summary>
                <div className="p-4 sm:p-5 border-t border-gray-700">
                <label htmlFor={`product-name-${product.id}`} className="block text-sm font-medium mb-2">Product name</label>
                <input
                  id={`product-name-${product.id}`}
                  type="text"
                  aria-label="Product name"
                  placeholder="Product Name *"
                  value={product.name}
                  onChange={(e) => handleUpdateProduct(product.id, 'name', e.target.value)}
                  className="w-full bg-gray-700 text-white p-3 rounded mb-4 border border-gray-600 focus:border-blue-500"
                />
                {validationErrors[product.id]?.find(e => e.startsWith('name')) && (
                  <p className="text-red-400 text-sm mb-3">{validationErrors[product.id].find(e => e.startsWith('name'))}</p>
                )}

                <label htmlFor={`product-image-${product.id}`} className="block text-sm font-medium mb-2">Product image URL</label>
                <input
                  id={`product-image-${product.id}`}
                  type="url"
                  aria-label="Product image URL"
                  placeholder="Product Image URL (HTTP/HTTPS) *"
                  value={product.imageUrl}
                  onChange={(e) => handleUpdateProduct(product.id, 'imageUrl', e.target.value)}
                  className="w-full bg-gray-700 text-white p-3 rounded mb-4 border border-gray-600 focus:border-blue-500"
                />
                {validationErrors[product.id]?.find(e => e.startsWith('image')) && (
                  <p className="text-red-400 text-sm mb-3">{validationErrors[product.id].find(e => e.startsWith('image'))}</p>
                )}

                <div className="mb-4">
                  <h3 className="text-lg font-semibold mb-3">Where to buy</h3>
                  {validationErrors[product.id]?.filter(e => e.startsWith('sellerLinks')).map((err, i) => (
                    <p key={i} className="text-red-400 text-sm mb-2">{err}</p>
                  ))}
                  <p className="text-sm text-gray-400 mb-3">Paste a store link. We look up its price automatically. If the store does not share a price, shoppers can check it at the store.</p>
                  <div className="space-y-3">
                    {product.sellerLinks?.map((link, idx) => (
                      <div key={idx} className="seller-editor grid grid-cols-[1fr_auto] sm:grid-cols-[110px_1fr_auto] gap-2 items-start rounded-xl border border-gray-700 p-3">
                        <select
                          value={link.platform}
                          onChange={(e) => handleUpdateSellerLink(product.id, idx, 'platform', e.target.value)}
                          aria-label="Retailer" className="bg-gray-700 text-white p-2 rounded w-full border border-gray-600"
                        >
                          <option value="amazon">Amazon</option>
                          <option value="flipkart">Flipkart</option>
                          <option value="meesho">Meesho</option>
                          <option value="myntra">Myntra</option>
                        </select>
                        <input
                          type="url"
                          placeholder="Affiliate Link (HTTPS)"
                          value={link.url}
                          onChange={(e) => handleUpdateSellerLink(product.id, idx, 'url', e.target.value)}
                          onBlur={e => { void lookupPrice(product.id, idx, e.target.value); }}
                          aria-label="Seller product URL" className="col-span-2 sm:col-span-1 row-start-2 sm:row-start-auto min-w-0 w-full bg-gray-700 text-white p-2 rounded border border-gray-600 focus:border-blue-500"
                        />
                        <p aria-live="polite" className="col-span-2 sm:col-span-3 text-xs text-purple-200">
                          {link.status === 'loading' ? 'Looking up price...' : link.price ? `Auto price: INR ${link.price.toLocaleString('en-IN')}` : link.status === 'unavailable' || link.status === 'unsupported' ? 'Price unavailable - shoppers can check at the store' : 'Price fetched automatically when you add a link'}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleDeleteSellerLink(product.id, idx)}
                          className="text-red-400 hover:text-red-300 px-2 py-2"
                          title="Delete seller link"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {validationErrors[product.id]?.filter(e => e.startsWith('sellerLink') && !e.startsWith('sellerLinks:')).map((err, i) => (
                    <p key={i} className="text-red-400 text-sm mt-2">{err}</p>
                  ))}
                  <button
                    type="button"
                    onClick={() => handleAddSellerLink(product.id)}
                    disabled={(product.sellerLinks?.length || 0) >= 10}
                    className="mt-3 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
                  >
                    + Add Seller Link
                  </button>
                </div>
                  <button type="button" onClick={() => handleDeleteProduct(product.id)} className="text-sm text-red-300 hover:text-red-200 py-2">Remove product</button>
                </div>
              </details>
            ))}

            <button
              type="button"
              onClick={handleAddProduct}
              className="md:col-span-2 w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded-lg"
            >
              + Add Another Product
            </button>

            <button
              type="button"
              onClick={handleSaveProducts}
              disabled={loading || products.length === 0}
              className="md:col-span-2 w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Saving...' : '📋 Save & Continue'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Automation Setup Stage
  if (stage === 'automation') {
    return (
      <div className="studio-shell min-h-screen text-white p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => setStage('products')} className="mb-6 text-blue-400 hover:text-blue-300">← Back to Products</button>

          <h1 className="text-3xl font-bold mb-2">Automation Setup</h1>
          <p className="text-gray-400 mb-6">Enable automatic replies when users mention trigger words in comments and DMs</p>

          {success && <div className="bg-green-900 text-green-200 p-3 rounded mb-4">{success}</div>}
          {error && <div className="bg-red-900 text-red-200 p-3 rounded mb-4">{error}</div>}

          <div className="bg-gray-800 p-6 rounded-lg space-y-6">
            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Enable Automation</h3>
                <p className="text-gray-400 text-sm">Turn on automatic replies</p>
              </div>
              <button
                onClick={() => setAutomation({ ...automation, enabled: !automation.enabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  automation.enabled ? 'bg-blue-600' : 'bg-gray-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    automation.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {automation.enabled && (
              <>
                {/* Trigger Words */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">Trigger Words (Read-only for MVP)</h3>
                  <div className="flex gap-2 flex-wrap">
                    {['LINK', 'SHOP', 'BUY'].map(word => (
                      <div key={word} className="bg-blue-900 px-3 py-1 rounded-full text-xs whitespace-nowrap">
                        {word}
                      </div>
                    ))}
                  </div>
                  <p className="text-gray-400 text-sm mt-2">Comments and DMs containing these words will trigger automatic replies</p>
                </div>

                {/* Reply Template */}
                <div>
                  <h3 className="text-lg font-semibold mb-3">Sample Reply Template</h3>
                  <div className="bg-gray-700 p-3 rounded text-sm border border-gray-600">
                    <p>Hi {'{name}'}! Check out this reel and shop the look: {'{url}'}</p>
                  </div>
                  <p className="text-gray-400 text-sm mt-2">Templates use {'{name}'} and {'{url}'} placeholders</p>
                </div>

                {/* Test Button */}
                <button
                  type="button"
                  onClick={handleTestAutomation}
                  disabled={loading}
                  className="w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 rounded-lg"
                >
                  🧪 Test Automation
                </button>
              </>
            )}

            {/* Save & Finish */}
            <button
              type="button"
              onClick={handleSaveAutomation}
              disabled={loading}
              className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 rounded-lg disabled:opacity-50"
            >
              {loading ? 'Saving...' : '✅ Save & Finish'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
