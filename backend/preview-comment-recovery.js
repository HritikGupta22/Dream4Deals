require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });
const fs = require('fs');
const path = require('path');
const { createCommentRecovery } = require('./comment-recovery');
const pool = require('./db');
const directory = path.join(__dirname, 'storage');
fs.mkdirSync(directory, { recursive: true });
function log(level, message, metadata) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...metadata };
  fs.appendFileSync(path.join(directory, 'backend.log'), `${JSON.stringify(entry)}\n`, 'utf8');
  console.log(JSON.stringify(entry));
}
// Intentionally no live flag or handler: this command cannot send messages.
createCommentRecovery({ mode: 'preview',
  logInfo: (message, metadata) => log('INFO', message, metadata),
  logError: (message, metadata) => log('ERROR', message, metadata),
})().then(result => { if (result.errors) process.exitCode = 1; }).finally(() => pool.end());
