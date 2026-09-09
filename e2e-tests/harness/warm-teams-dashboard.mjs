import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../package.json', import.meta.url));
const { request } = require('@playwright/test');

export async function warmTeamsDashboard({ env = process.env, timeoutMs = 240_000 } = {}) {
  assert.equal(env.E2E_DATABASE_ISOLATED, 'true');
  assert.equal(env.E2E_TEAMS_DEVELOPMENT, 'true');
  assert.ok(env.E2E_USER_EMAIL && env.E2E_USER_PASSWORD);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 240_000);
  const base = new URL(env.E2E_BASE_URL);
  assert.ok(['http:', 'https:'].includes(base.protocol) && !base.username && !base.password);
  assert.equal(base.pathname, '/');
  assert.ok(!base.search && !base.hash);
  const deadline = Date.now() + timeoutMs;
  const context = await request.newContext({ baseURL: base.origin, ignoreHTTPSErrors: false });
  const remaining = () => {
    const value = deadline - Date.now();
    assert.ok(value > 0, 'Dashboard warmup deadline exceeded');
    return value;
  };
  const fetch = async (path, options = {}) => {
    const response = await context.fetch(path, { ...options, maxRedirects: 0, timeout: remaining() });
    assert.equal(response.status(), 200, 'Warmup endpoint did not return HTTP 200');
    assert.equal(new URL(response.url()).origin, base.origin);
    return response;
  };
  try {
    const csrf = await (await fetch('/api/auth/csrf')).json();
    assert.ok(typeof csrf.csrfToken === 'string' && csrf.csrfToken);
    const callbackUrl = `${base.origin}/msp/dashboard`;
    const callback = await (await fetch('/api/auth/callback/credentials', { method: 'POST',
      headers: { 'X-Auth-Return-Redirect': '1' }, form: { csrfToken: csrf.csrfToken,
        email: env.E2E_USER_EMAIL, password: env.E2E_USER_PASSWORD, userType: 'internal',
        callbackUrl, redirect: 'false', json: 'true' } })).json();
    assert.equal(callback.error, undefined, 'Credentials were rejected');
    assert.equal(callback.url, callbackUrl, 'Credentials did not authorize the dashboard');
    const session = await (await fetch('/api/auth/session')).json();
    assert.equal(session.user?.email, env.E2E_USER_EMAIL, 'Authenticated session identity mismatch');
    const dashboard = await fetch('/msp/dashboard');
    assert.match(dashboard.headers()['content-type'] ?? '', /text\/html/i);
    const html = await dashboard.text();
    remaining();
    assert.match(html, /data-automation-id=["']dashboard-main["']/);
    assert.doesNotMatch(html, /__next_error__|NEXT_HTTP_ERROR_FALLBACK|NEXT_REDIRECT|\$RX\(|data-nextjs-error|Application error:/);
    return { schemaVersion: 1, scope: 'teams-development-dashboard-warmup', status: 'passed', authenticated: true };
  } finally { await context.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await warmTeamsDashboard())); }
  catch { console.error('Authenticated Teams dashboard warmup failed'); process.exitCode = 1; }
}
