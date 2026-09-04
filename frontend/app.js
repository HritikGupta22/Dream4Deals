const money = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

let reel;
let creatorToken = localStorage.getItem('dream4deals_token') || '';

// ── helpers ──────────────────────────────────────────────────────────────────

async function api(url, options = {}) {
  if (creatorToken && !options.noAuth) {
    options.headers = { ...(options.headers || {}), Authorization: `Bearer ${creatorToken}` };
  }
  const res = await fetch(url, options);
  return res.json();
}

function post(url, body) {
  return api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(url) {
  return api(url, { method: 'DELETE' });
}

function patch(url, body) {
  return api(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function esc(v) {
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function setStatus(id, msg, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#c0392b' : '';
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait…' : btn.dataset.label;
}

function initBtn(id, label) {
  const btn = document.getElementById(id);
  if (btn) btn.dataset.label = label;
}

function currentSlug() {
  const parts = location.pathname.split('/').filter(Boolean);
  return parts[0] === 'reel' && parts[1] ? parts[1] : 'anaya-pink-edit';
}

// ── reel page ─────────────────────────────────────────────────────────────────

function fillHero() {
  document.getElementById('creator-name').textContent = reel.creator.name;
  document.getElementById('creator-meta').textContent = `${reel.creator.handle} · ${reel.creator.followers}`;
  document.getElementById('reel-title').textContent = reel.title;
  document.getElementById('reel-caption').textContent = `"${reel.caption}"`;
  document.title = `Dream4Deals | ${reel.title}`;

  const poster = document.getElementById('reel-poster');
  const video = document.getElementById('reel-video');
  poster.src = reel.poster;
  poster.alt = reel.title;

  if (reel.videoUrl) {
    video.src = reel.videoUrl;
    video.poster = reel.poster;
    video.hidden = false;
    poster.hidden = true;
    video.play().catch(() => {});
  } else {
    video.hidden = true;
    poster.hidden = false;
  }
}

function showProducts() {
  document.getElementById('products').innerHTML = reel.products
    .map(
      (p) => `
      <article class="product" data-id="${esc(p.id)}">
        <img src="${esc(p.image)}" alt="${esc(p.name)}">
        <div>
          <h3>${esc(p.name)}</h3>
          <p>${esc(p.category)}</p>
          <b>from ${money(p.price)}</b>
          <span>Compare →</span>
        </div>
      </article>`
    )
    .join('');

  document.querySelectorAll('.product').forEach((card) => {
    card.onclick = () => compare(card.dataset.id);
  });
}

function flattenOffers(platforms) {
  return platforms.flatMap((g) => (g.sellers || []).map((s) => ({ platform: g.platform, ...s })));
}

function lowestKey(offers) {
  const lowest = flattenOffers(offers).sort((a, b) => a.price - b.price)[0];
  return lowest ? `${lowest.platform}|${lowest.seller}|${lowest.price}` : '';
}

async function compare(id) {
  const product = reel.products.find((p) => p.id === id);
  const platforms = await api(`/api/offers/${id}`, { noAuth: true });
  const best = lowestKey(platforms);

  document.getElementById('comparison-title').textContent = product.name;
  document.getElementById('comparison-image').src = product.image;
  document.getElementById('offers').innerHTML = platforms
    .map((group) => {
      const rows = (group.sellers || [])
        .slice()
        .sort((a, b) => a.price - b.price)
        .map((offer) => {
          const key = `${group.platform}|${offer.seller}|${offer.price}`;
          const redirect = `/api/redirect?platform=${encodeURIComponent(group.platform)}&product=${encodeURIComponent(product.name)}&url=${encodeURIComponent(offer.link)}`;
          return `
            <div class="offer ${key === best ? 'best' : ''}">
              <div>
                <b>${esc(offer.seller)}${key === best ? ' · Lowest price' : ''}</b>
                <small>☆ ${esc(offer.rating)}</small>
              </div>
              <small>${esc(offer.delivery)}</small>
              <div>
                <strong>${money(offer.price)}</strong>
                <a class="buy" href="${esc(redirect)}" target="_blank" rel="noreferrer"
                  data-product="${esc(product.name)}" data-platform="${esc(group.platform)}" data-seller="${esc(offer.seller)}">Buy now</a>
              </div>
            </div>`;
        })
        .join('');
      return `<article class="platform"><h3>${esc(group.platform)}</h3>${rows}</article>`;
    })
    .join('');

  const section = document.getElementById('comparison');
  section.classList.remove('hidden');
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });

  document.querySelectorAll('.buy').forEach((link) => {
    link.addEventListener('click', () => {
      post('/api/click', link.dataset);
    });
  });
}

document.getElementById('close').onclick = () => {
  document.getElementById('comparison').classList.add('hidden');
};

// ── automation / studio ───────────────────────────────────────────────────────

function fillStudio(automation) {
  document.getElementById('auto-enabled').checked = automation.enabled;
  document.getElementById('auto-comments').checked = automation.replyComments;
  document.getElementById('auto-dms').checked = automation.replyDms;
  document.getElementById('auto-triggers').value = (automation.triggers || []).join(', ');
  document.getElementById('auto-template').value = automation.replyTemplate;
  document.getElementById('meta-status').innerHTML = automation.metaConfigured
    ? '<strong class="ready">● Meta connected</strong><br>Live comment and DM replies can send when Meta approves the app.'
    : '<strong>● Setup required</strong><br>Add Meta credentials in backend/.env and subscribe to comments + messages.';

  renderMappings(automation.mappings || []);
  populateReelSelect(automation.mappings || []);
}

function renderMappings(mappings) {
  document.getElementById('mappings').innerHTML = mappings
    .map(
      (row) => `
      <div class="map-row" data-slug="${esc(row.slug)}">
        <span>IG ${esc(row.instagramMediaId)}</span>
        <span>→</span>
        <a href="${esc(row.url)}">${esc(row.url)}</a>
        <button class="del-reel icon-btn" data-slug="${esc(row.slug)}" title="Delete reel">🗑</button>
      </div>`
    )
    .join('');

  document.querySelectorAll('.del-reel').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm(`Delete reel "${btn.dataset.slug}"? This cannot be undone.`)) return;
      const result = await del(`/api/reels/${btn.dataset.slug}`);
      if (result.error) { alert(result.error); return; }
      const automation = await api('/api/automation', { noAuth: true });
      fillStudio(automation);
    };
  });
}

function populateReelSelect(mappings) {
  const select = document.getElementById('product-reel-slug');
  const current = select.value;
  select.innerHTML = '<option value="">— select reel —</option>' +
    mappings.map((r) => `<option value="${esc(r.slug)}">${esc(r.title || r.slug)}</option>`).join('');
  if (current) select.value = current;
}

async function loadEvents() {
  const events = await api('/api/events', { noAuth: true });
  const log = document.getElementById('event-log');
  if (!events.length) {
    log.innerHTML = '<p class="muted">No events yet. Clicks, comments, and DMs will appear here.</p>';
    return;
  }
  log.innerHTML = events
    .slice(0, 12)
    .map(
      (e) => `
      <div class="event">
        <b>${esc(e.type)}</b>
        <small>${esc(e.detail)}</small>
      </div>`
    )
    .join('');
}

document.getElementById('save-automation').onclick = async () => {
  setStatus('save-status', 'Saving…');
  const saved = await post('/api/automation', {
    enabled: document.getElementById('auto-enabled').checked,
    replyComments: document.getElementById('auto-comments').checked,
    replyDms: document.getElementById('auto-dms').checked,
    triggers: document.getElementById('auto-triggers').value.split(','),
    replyTemplate: document.getElementById('auto-template').value,
  });
  fillStudio(saved);
  setStatus('save-status', 'Automation settings saved.');
};

// ── auth ──────────────────────────────────────────────────────────────────────

function showSignedIn(user) {
  document.getElementById('creator-auth').classList.add('hidden');
  document.getElementById('creator-login').classList.add('hidden');
  document.querySelector('.auth-tabs').classList.add('hidden');
  document.getElementById('edit-profile').classList.remove('hidden');
  document.getElementById('signed-in-as').textContent = `(${user.name})`;
  document.getElementById('profile-name').value = user.name || '';
  document.getElementById('profile-handle').value = user.handle || '';
}

function showSignedOut() {
  document.getElementById('edit-profile').classList.add('hidden');
  document.querySelector('.auth-tabs').classList.remove('hidden');
  switchTab('register');
}

async function checkSession() {
  if (!creatorToken) { showSignedOut(); return; }
  const result = await api('/api/auth/me');
  if (result.user) {
    showSignedIn(result.user);
    const profile = await api('/api/creator/profile');
    if (!profile.error) document.getElementById('profile-bio').value = profile.bio || '';
  } else {
    creatorToken = '';
    localStorage.removeItem('dream4deals_token');
    showSignedOut();
  }
}

// Auth tabs
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('creator-auth').classList.toggle('hidden', tab !== 'register');
  document.getElementById('creator-login').classList.toggle('hidden', tab !== 'login');
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.onclick = () => switchTab(btn.dataset.tab);
});

// Register
initBtn('register-btn', 'Create account');
document.getElementById('creator-auth').onsubmit = async (e) => {
  e.preventDefault();
  setStatus('auth-status', '');
  setLoading('register-btn', true);
  const result = await post('/api/auth/register', {
    name: document.getElementById('auth-name').value,
    handle: document.getElementById('auth-handle').value,
    email: document.getElementById('auth-email').value,
    password: document.getElementById('auth-password').value,
  });
  setLoading('register-btn', false);
  if (result.error) { setStatus('auth-status', result.error, true); return; }
  creatorToken = result.token;
  localStorage.setItem('dream4deals_token', creatorToken);
  showSignedIn(result.user);
};

// Login
initBtn('login-btn', 'Sign in');
document.getElementById('creator-login').onsubmit = async (e) => {
  e.preventDefault();
  setStatus('login-status', '');
  setLoading('login-btn', true);
  const result = await post('/api/auth/login', {
    email: document.getElementById('login-email').value,
    password: document.getElementById('login-password').value,
  });
  setLoading('login-btn', false);
  if (result.error) { setStatus('login-status', result.error, true); return; }
  creatorToken = result.token;
  localStorage.setItem('dream4deals_token', creatorToken);
  showSignedIn(result.user);
};

// Profile edit
initBtn('profile-btn', 'Save profile');
document.getElementById('edit-profile').onsubmit = async (e) => {
  e.preventDefault();
  setStatus('profile-status', '');
  setLoading('profile-btn', true);
  const result = await post('/api/creator/profile', {
    name: document.getElementById('profile-name').value,
    handle: document.getElementById('profile-handle').value,
    bio: document.getElementById('profile-bio').value,
  });
  setLoading('profile-btn', false);
  if (result.error) { setStatus('profile-status', result.error, true); return; }
  setStatus('profile-status', 'Profile saved.');
  document.getElementById('signed-in-as').textContent = `(${result.name})`;
};

// Logout
document.getElementById('logout-btn').onclick = () => {
  creatorToken = '';
  localStorage.removeItem('dream4deals_token');
  showSignedOut();
};

// ── create reel ───────────────────────────────────────────────────────────────

initBtn('create-reel-btn', 'Create reel URL');
document.getElementById('create-reel').onsubmit = async (e) => {
  e.preventDefault();
  setStatus('reel-status', '');
  if (!creatorToken) { setStatus('reel-status', 'Sign in first.', true); return; }
  setLoading('create-reel-btn', true);
  const result = await post('/api/reels', {
    instagramMediaId: document.getElementById('new-media-id').value,
    title: document.getElementById('new-title').value,
    slug: document.getElementById('new-slug').value,
    poster: document.getElementById('new-poster').value,
    caption: document.getElementById('new-caption').value,
  });
  setLoading('create-reel-btn', false);
  if (result.error) { setStatus('reel-status', result.error, true); return; }
  setStatus('reel-status', `✓ Created: ${result.url}`);
  document.getElementById('create-reel').reset();
  const automation = await api('/api/automation', { noAuth: true });
  fillStudio(automation);
};

// ── tag product ───────────────────────────────────────────────────────────────

initBtn('tag-product-btn', 'Tag product');
document.getElementById('tag-product').onsubmit = async (e) => {
  e.preventDefault();
  setStatus('product-status', '');
  if (!creatorToken) { setStatus('product-status', 'Sign in first.', true); return; }
  const slug = document.getElementById('product-reel-slug').value;
  if (!slug) { setStatus('product-status', 'Select a reel first.', true); return; }
  setLoading('tag-product-btn', true);
  const result = await post(`/api/reels/${slug}/products`, {
    name: document.getElementById('product-name').value,
    category: document.getElementById('product-category').value,
    price: document.getElementById('product-price').value,
    image: document.getElementById('product-image').value,
  });
  setLoading('tag-product-btn', false);
  if (result.error) { setStatus('product-status', result.error, true); return; }
  setStatus('product-status', `✓ "${result.name}" tagged.`);
  document.getElementById('tag-product').reset();
  // refresh products if on same reel
  if (slug === currentSlug()) {
    reel = await api(`/api/reels/${currentSlug()}`, { noAuth: true });
    showProducts();
  }
};

// ── boot ──────────────────────────────────────────────────────────────────────

(async () => {
  reel = await api(`/api/reels/${currentSlug()}`, { noAuth: true });
  if (reel.error) {
    document.getElementById('reel-title').textContent = 'Reel not found';
    return;
  }
  fillHero();
  showProducts();
  fillStudio(await api('/api/automation', { noAuth: true }));
  await loadEvents();
  setInterval(loadEvents, 8000);
  await checkSession();
})();
