import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 4010);
const state = {
  clients: new Map(),
  codes: new Map(),
  refreshTokens: new Map(),
  accessTokens: new Map(),
  messages: new Map(),
  subscriptions: new Map(),
  faults: new Map(),
  accessTokenTtlSeconds: 3600,
  rotateRefreshTokens: true,
};

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function text(res, status, value, contentType = 'text/plain') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(value);
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] || '').includes('application/json')) return raw ? JSON.parse(raw) : {};
  return Object.fromEntries(new URLSearchParams(raw));
}

function injectedFault(operation) {
  const fault = state.faults.get(operation);
  if (!fault) return null;
  if (fault.remaining !== undefined) {
    fault.remaining -= 1;
    if (fault.remaining <= 0) state.faults.delete(operation);
  }
  return fault;
}

function requireAccess(req, res) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const record = state.accessTokens.get(token);
  if (!record || record.expiresAt <= Date.now()) {
    json(res, 401, { error: { code: 'InvalidAuthenticationToken', message: 'Access token is expired or invalid' } });
    return null;
  }
  return record;
}

function issueTokens(clientId, existingRefreshToken) {
  const accessToken = `access-${randomUUID()}`;
  const refreshToken = existingRefreshToken && !state.rotateRefreshTokens
    ? existingRefreshToken
    : `refresh-${randomUUID()}`;
  state.accessTokens.set(accessToken, {
    clientId,
    expiresAt: Date.now() + state.accessTokenTtlSeconds * 1000,
  });
  state.refreshTokens.set(refreshToken, { clientId, revoked: false });
  if (existingRefreshToken && existingRefreshToken !== refreshToken) state.refreshTokens.delete(existingRefreshToken);
  return { access_token: accessToken, refresh_token: refreshToken, expires_in: state.accessTokenTtlSeconds, token_type: 'Bearer' };
}

function messageMime(message) {
  return [
    `Message-ID: <${message.id}@graph-emulator>`,
    `Date: ${new Date(message.receivedDateTime).toUTCString()}`,
    `From: ${message.from?.emailAddress?.address || 'sender@example.test'}`,
    `To: ${(message.toRecipients || []).map((r) => r.emailAddress.address).join(', ') || 'support@example.test'}`,
    `Subject: ${message.subject || 'Emulated message'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    message.body?.content || message.bodyPreview || '',
  ].join('\r\n');
}

async function deliverNotifications(message) {
  for (const subscription of state.subscriptions.values()) {
    if (new Date(subscription.expirationDateTime).getTime() <= Date.now()) continue;
    try {
      await fetch(subscription.notificationUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          value: [{
            subscriptionId: subscription.id,
            clientState: subscription.clientState,
            changeType: 'created',
            resource: `${subscription.resource}/${message.id}`,
            resourceData: { id: message.id },
          }],
        }),
      });
    } catch (error) {
      console.warn('[graph-emulator] notification delivery failed', error?.message || error);
    }
  }
}

async function handleControl(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/__control/reset') {
    state.clients.clear(); state.codes.clear(); state.refreshTokens.clear();
    state.accessTokens.clear(); state.messages.clear(); state.subscriptions.clear(); state.faults.clear();
    state.accessTokenTtlSeconds = 3600; state.rotateRefreshTokens = true;
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/__control/clients') {
    const input = await body(req);
    state.clients.set(String(input.clientId), String(input.clientSecret));
    return json(res, 201, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/__control/messages') {
    const input = await body(req);
    const id = String(input.id || randomUUID());
    const message = {
      id,
      receivedDateTime: input.receivedDateTime || new Date().toISOString(),
      subject: input.subject || 'Emulated support email',
      bodyPreview: input.body || 'Hello from the Graph emulator',
      body: { contentType: 'text', content: input.body || 'Hello from the Graph emulator' },
      from: { emailAddress: { address: input.from || 'sender@example.test', name: 'Emulated Sender' } },
      toRecipients: [{ emailAddress: { address: input.to || 'support@example.test' } }],
      attachments: [],
    };
    state.messages.set(id, message);
    await deliverNotifications(message);
    return json(res, 201, message);
  }
  if (req.method === 'POST' && url.pathname === '/__control/expire-access-tokens') {
    for (const token of state.accessTokens.values()) token.expiresAt = 0;
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/__control/revoke-refresh-token') {
    const input = await body(req);
    const token = state.refreshTokens.get(String(input.refreshToken));
    if (token) token.revoked = true;
    return json(res, 200, { ok: Boolean(token) });
  }
  if (req.method === 'POST' && url.pathname === '/__control/faults') {
    const input = await body(req);
    state.faults.set(String(input.operation), {
      status: Number(input.status || 500),
      body: input.body || { error: 'injected_fault' },
      remaining: input.remaining === undefined ? undefined : Number(input.remaining),
    });
    return json(res, 201, { ok: true });
  }
  if (req.method === 'POST' && url.pathname === '/__control/config') {
    const input = await body(req);
    if (input.accessTokenTtlSeconds) state.accessTokenTtlSeconds = Number(input.accessTokenTtlSeconds);
    if (input.rotateRefreshTokens !== undefined) state.rotateRefreshTokens = Boolean(input.rotateRefreshTokens);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && url.pathname === '/__control/subscriptions') {
    return json(res, 200, { value: [...state.subscriptions.values()] });
  }
  return json(res, 404, { error: 'unknown_control_endpoint' });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/__control/')) return handleControl(req, res, url);

  if (req.method === 'GET' && /\/oauth2\/v2\.0\/authorize$/.test(url.pathname)) {
    const clientId = url.searchParams.get('client_id');
    const redirectUri = url.searchParams.get('redirect_uri');
    if (!clientId || !redirectUri || !state.clients.has(clientId)) return json(res, 400, { error: 'invalid_client' });
    const code = `code-${randomUUID()}`;
    state.codes.set(code, { clientId, redirectUri });
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    if (url.searchParams.get('state')) callback.searchParams.set('state', url.searchParams.get('state'));
    res.writeHead(302, { location: callback.toString() });
    return res.end();
  }

  if (req.method === 'POST' && /\/oauth2\/v2\.0\/token$/.test(url.pathname)) {
    const fault = injectedFault('token');
    if (fault) return json(res, fault.status, fault.body);
    const input = await body(req);
    if (state.clients.get(String(input.client_id)) !== String(input.client_secret)) {
      return json(res, 401, { error: 'invalid_client' });
    }
    if (input.grant_type === 'authorization_code') {
      const code = state.codes.get(String(input.code));
      if (!code || code.clientId !== input.client_id || code.redirectUri !== input.redirect_uri) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      state.codes.delete(String(input.code));
      return json(res, 200, issueTokens(String(input.client_id)));
    }
    if (input.grant_type === 'refresh_token') {
      const refresh = state.refreshTokens.get(String(input.refresh_token));
      if (!refresh || refresh.revoked || refresh.clientId !== input.client_id) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      return json(res, 200, issueTokens(String(input.client_id), String(input.refresh_token)));
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  }

  if (!url.pathname.startsWith('/v1.0/')) return json(res, 404, { error: 'not_found' });
  const access = requireAccess(req, res);
  if (!access) return;
  const graphPath = url.pathname.slice('/v1.0'.length);
  const fault = injectedFault(`${req.method} ${graphPath}`);
  if (fault) return json(res, fault.status, fault.body);

  if (req.method === 'GET' && (graphPath === '/me' || /^\/users\/[^/]+$/.test(graphPath))) {
    return json(res, 200, { id: 'emulated-user', userPrincipalName: 'support@example.test', mail: 'support@example.test' });
  }
  if (req.method === 'GET' && /\/(me|users\/[^/]+)\/mailFolders$/.test(graphPath)) {
    return json(res, 200, { value: [{ id: 'inbox', displayName: 'Inbox' }] });
  }
  if (req.method === 'GET' && /\/(me|users\/[^/]+)\/mailFolders\/[^/]+\/messages$/.test(graphPath)) {
    const filter = url.searchParams.get('$filter') || '';
    const match = filter.match(/receivedDateTime ge (.+)$/);
    const since = match ? new Date(match[1]).getTime() : 0;
    const top = Number(url.searchParams.get('$top') || 100);
    const value = [...state.messages.values()]
      .filter((message) => new Date(message.receivedDateTime).getTime() >= since)
      .sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))
      .slice(0, top);
    return json(res, 200, { value });
  }
  const messageMatch = graphPath.match(/^\/(?:me|users\/[^/]+)\/messages\/([^/]+)(\/\$value)?$/);
  if (req.method === 'GET' && messageMatch) {
    const message = state.messages.get(decodeURIComponent(messageMatch[1]));
    if (!message) return json(res, 404, { error: { code: 'ErrorItemNotFound' } });
    return messageMatch[2]
      ? text(res, 200, messageMime(message), 'message/rfc822')
      : json(res, 200, message);
  }
  if (req.method === 'GET' && graphPath === '/subscriptions') {
    return json(res, 200, {
      value: [...state.subscriptions.values()]
        .filter((subscription) => subscription._clientId === access.clientId)
        .map(({ _clientId, ...subscription }) => subscription),
    });
  }
  if (req.method === 'POST' && graphPath === '/subscriptions') {
    const input = await body(req);
    const validationToken = `validation-${randomUUID()}`;
    const validationUrl = new URL(input.notificationUrl);
    validationUrl.searchParams.set('validationToken', validationToken);
    try {
      const validation = await fetch(validationUrl, { method: 'POST' });
      if (!validation.ok || (await validation.text()) !== validationToken) {
        return json(res, 400, { error: { code: 'ValidationError', message: 'Notification URL validation failed' } });
      }
    } catch {
      return json(res, 400, { error: { code: 'ValidationError', message: 'Notification URL is unreachable' } });
    }
    const subscription = { ...input, id: randomUUID(), _clientId: access.clientId };
    state.subscriptions.set(subscription.id, subscription);
    const { _clientId, ...responseSubscription } = subscription;
    return json(res, 201, responseSubscription);
  }
  const subscriptionMatch = graphPath.match(/^\/subscriptions\/([^/]+)$/);
  if (subscriptionMatch && req.method === 'DELETE') {
    const subscription = state.subscriptions.get(subscriptionMatch[1]);
    if (!subscription || subscription._clientId !== access.clientId) {
      return json(res, 404, { error: { code: 'ResourceNotFound' } });
    }
    state.subscriptions.delete(subscriptionMatch[1]);
    res.writeHead(204); return res.end();
  }
  if (subscriptionMatch && req.method === 'PATCH') {
    const subscription = state.subscriptions.get(subscriptionMatch[1]);
    if (!subscription || subscription._clientId !== access.clientId) return json(res, 404, { error: { code: 'ResourceNotFound' } });
    Object.assign(subscription, await body(req));
    const { _clientId, ...responseSubscription } = subscription;
    return json(res, 200, responseSubscription);
  }
  return json(res, 404, { error: { code: 'NotFound', message: graphPath } });
}

const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => json(res, 500, { error: error?.message || String(error) }));
});
server.listen(port, '0.0.0.0', () => console.log(`[graph-emulator] listening on ${port}`));
