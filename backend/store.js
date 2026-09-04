const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const storePath = path.join(__dirname, 'local-store.json');

const defaultSettings = {
  enabled: true,
  replyComments: true,
  replyDms: true,
  triggers: ['link', 'link please', 'price', 'details', 'buy'],
  replyTemplate: 'Hey{{name}}! Here are the shopping links from this reel: {{url}} 🛍️',
  fallbackSlug: 'dress-pink-edit',
};

function readStore() {
  if (!fs.existsSync(storePath)) {
    return { events: [], settings: { ...defaultSettings }, lastReelByUser: {}, users: [], sessions: {}, creator: null };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return {
      events: parsed.events || [],
      settings: { ...defaultSettings, ...(parsed.settings || {}) },
      lastReelByUser: parsed.lastReelByUser || {},
      users: parsed.users || [],
      sessions: parsed.sessions || {},
      creator: parsed.creator || null,
    };
  } catch {
    return { events: [], settings: { ...defaultSettings }, lastReelByUser: {}, users: [], sessions: {}, creator: null };
  }
}

function writeStore(data) {
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

function getSettings() {
  return readStore().settings;
}

function saveSettings(patch) {
  const store = readStore();
  store.settings = { ...store.settings, ...patch };
  if (Array.isArray(patch.triggers)) {
    store.settings.triggers = patch.triggers
      .map((word) => String(word).trim().toLowerCase())
      .filter(Boolean);
  }
  writeStore(store);
  return store.settings;
}

function logEvent(type, detail) {
  const store = readStore();
  store.events.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    type,
    detail,
    at: new Date().toISOString(),
  });
  store.events = store.events.slice(0, 200);
  writeStore(store);
  return store.events[0];
}

function listEvents() {
  return readStore().events;
}

function rememberUserReel(userId, slug) {
  if (!userId || !slug) return;
  const store = readStore();
  store.lastReelByUser[userId] = slug;
  writeStore(store);
}

function lastReelForUser(userId) {
  if (!userId) return null;
  return readStore().lastReelByUser[userId] || null;
}

function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function publicUser(user) { return { id: user.id, name: user.name, handle: user.handle, email: user.email }; }
function createUser({ name, handle, email, password }) {
  const store = readStore();
  store.users = store.users || [];
  if (store.users.some((user) => user.email === email.toLowerCase())) throw new Error('An account already uses this email.');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { id: crypto.randomUUID(), name, handle, email: email.toLowerCase(), salt, passwordHash: hashPassword(password, salt) };
  store.users.push(user); writeStore(store); return publicUser(user);
}
function authenticate(email, password) {
  const user = (readStore().users || []).find((item) => item.email === String(email).toLowerCase());
  if (!user || hashPassword(password, user.salt) !== user.passwordHash) return null;
  return publicUser(user);
}
function createSession(userId) {
  const store = readStore(); store.sessions = store.sessions || {}; const token = crypto.randomBytes(32).toString('hex');
  store.sessions[token] = { userId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 }; writeStore(store); return token;
}
function userForToken(token) {
  const store = readStore(); const session = store.sessions?.[token]; if (!session || session.expiresAt < Date.now()) return null;
  const user = (store.users || []).find((item) => item.id === session.userId); return user ? publicUser(user) : null;
}
function getCreator() {
  return readStore().creator || { name: 'Dream4Deals', handle: '@dream4deal', bio: 'Creator shopping links and price comparison.' };
}

function saveCreator(profile) {
  const store = readStore();
  store.creator = { ...getCreator(), ...profile };
  writeStore(store);
  return store.creator;
}

module.exports = {
  defaultSettings,
  getSettings,
  saveSettings,
  logEvent,
  listEvents,
  rememberUserReel,
  lastReelForUser,
  getCreator,
  saveCreator,
  createUser,
  authenticate,
  createSession,
  userForToken,
};
