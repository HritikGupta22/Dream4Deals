const REQUIRED_FIELDS = ['comments', 'messages', 'messaging_postbacks'];

async function subscriptionRequest(accountId, accessToken, method = 'GET', fields) {
  const version = process.env.META_GRAPH_API_VERSION || 'v25.0';
  const endpoint = `/${accountId}/subscribed_apps`;
  const response = await fetch(`https://graph.instagram.com/${version}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    ...(fields ? { body: JSON.stringify({ subscribed_fields: fields.join(',') }) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || 'Instagram webhook subscription request failed');
    error.meta = { endpoint, httpStatus: response.status, code: data.error?.code,
      subcode: data.error?.error_subcode, traceId: data.error?.fbtrace_id };
    throw error;
  }
  return data;
}

async function ensureInstagramSubscriptions({ accountId, accessToken, appId = process.env.META_APP_ID, subscriptionAppId = process.env.META_WEBHOOK_APP_ID }) {
  if (!accountId || !accessToken || !appId) throw new Error('Instagram account, token and app ID are required for webhook setup');
  // Instagram can return an app ID different from the OAuth client ID.
  // Use an explicit subscription ID when supplied; never guess among multiple apps.
  const selectApp = data => {
    const apps = data.data || [];
    const matching = apps.find(app => String(app.id) === String(subscriptionAppId || appId));
    if (matching) return matching;
    if (!subscriptionAppId && apps.length === 1) return apps[0];
    if (apps.length) throw new Error('Unable to identify webhook app; configure META_WEBHOOK_APP_ID from subscribed_apps');
    return null;
  };
  const beforeApp = selectApp(await subscriptionRequest(accountId, accessToken));
  const before = beforeApp?.subscribed_fields || [];
  const missing = REQUIRED_FIELDS.filter(field => !before.includes(field));
  if (!missing.length) return { accountId, subscriptionAppId: beforeApp.id, fields: before, updated: false };
  // Meta replaces this app's field list. Preserve other existing subscriptions.
  const result = await subscriptionRequest(accountId, accessToken, 'POST', [...new Set([...before, ...REQUIRED_FIELDS])]);
  if (result.success !== true) throw new Error('Instagram did not confirm webhook subscription setup');
  const afterApp = selectApp(await subscriptionRequest(accountId, accessToken));
  const after = afterApp?.subscribed_fields || [];
  if (REQUIRED_FIELDS.some(field => !after.includes(field))) {
    throw new Error('Instagram webhook verification failed: comments/messages/messaging_postbacks subscription is missing');
  }
  return { accountId, subscriptionAppId: afterApp.id, fields: after, previousFields: before, updated: true };
}

module.exports = { ensureInstagramSubscriptions };
