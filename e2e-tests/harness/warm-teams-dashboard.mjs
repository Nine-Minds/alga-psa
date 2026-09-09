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
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const diagnostics = { stage: 'context', code: 'request-failed' };
  const context = await request.newContext({ baseURL: base.origin, ignoreHTTPSErrors: false });
  const remaining = () => {
    const value = deadline - Date.now();
    assert.ok(value > 0, 'Dashboard warmup deadline exceeded');
    return value;
  };
  const fetch = async (path, options = {}) => {
    diagnostics.code = 'request-failed';
    delete diagnostics.httpStatus;
    const response = await context.fetch(path, { ...options, maxRedirects: 0, timeout: remaining() });
    diagnostics.httpStatus = response.status();
    diagnostics.code = 'unexpected-http-status';
    assert.equal(response.status(), 200, 'Warmup endpoint did not return HTTP 200');
    diagnostics.code = 'unexpected-origin';
    assert.equal(new URL(response.url()).origin, base.origin);
    diagnostics.code = 'invalid-response';
    return response;
  };
  try {
    diagnostics.stage = 'csrf';
    const csrf = await (await fetch('/api/auth/csrf')).json();
    assert.ok(typeof csrf.csrfToken === 'string' && csrf.csrfToken);
    const callbackUrl = `${base.origin}/msp/dashboard`;
    diagnostics.stage = 'credentials';
    const callback = await (await fetch('/api/auth/callback/credentials', { method: 'POST',
      headers: { 'X-Auth-Return-Redirect': '1' }, form: { csrfToken: csrf.csrfToken,
        email: env.E2E_USER_EMAIL, password: env.E2E_USER_PASSWORD, userType: 'internal',
        callbackUrl, redirect: 'false', json: 'true' } })).json();
    diagnostics.code = 'credentials-rejected';
    assert.equal(callback.error, undefined, 'Credentials were rejected');
    assert.equal(callback.url, callbackUrl, 'Credentials did not authorize the dashboard');
    diagnostics.stage = 'session';
    const session = await (await fetch('/api/auth/session')).json();
    diagnostics.code = 'session-identity-mismatch';
    assert.equal(session.user?.email, env.E2E_USER_EMAIL, 'Authenticated session identity mismatch');
    diagnostics.stage = 'dashboard';
    const dashboard = await fetch('/msp/dashboard');
    diagnostics.code = 'unexpected-content-type';
    assert.match(dashboard.headers()['content-type'] ?? '', /text\/html/i);
    const html = await dashboard.text();
    remaining();
    diagnostics.htmlLength = html.length;
    diagnostics.dashboardMarkerPresent = /data-automation-id=["']dashboard-main["']/.test(html);
    diagnostics.errorSentinelPresent = /__next_error__|NEXT_HTTP_ERROR_FALLBACK|NEXT_REDIRECT|\$RX\(|data-nextjs-error|Application error:/.test(html);
    diagnostics.code = 'dashboard-marker-missing';
    assert.match(html, /data-automation-id=["']dashboard-main["']/);
    diagnostics.code = 'dashboard-error-sentinel';
    assert.doesNotMatch(html, /__next_error__|NEXT_HTTP_ERROR_FALLBACK|NEXT_REDIRECT|\$RX\(|data-nextjs-error|Application error:/);
    return { schemaVersion: 1, scope: 'teams-development-dashboard-warmup', status: 'passed', authenticated: true };
  } catch {
    const error = new Error('Authenticated Teams dashboard warmup failed');
    error.diagnostics = { ...diagnostics, elapsedMs: Date.now() - startedAt,
      ...(Date.now() >= deadline ? { code: 'deadline-exceeded' } : {}) };
    throw error;
  } finally { await context.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await warmTeamsDashboard())); }
  catch (error) {
    console.error(JSON.stringify({ scope: 'teams-development-dashboard-warmup', status: 'failed',
      ...(error.diagnostics ?? { stage: 'configuration', code: 'configuration-or-context-failed' }) }));
    process.exitCode = 1;
  }
}
