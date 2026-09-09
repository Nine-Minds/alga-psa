import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startMicrosoftOidcAuthority } from './microsoft-oidc-authority.mjs';
import { checkMicrosoftCallback } from './check-microsoft-callback.mjs';
const root = path.resolve(process.env.NATIVE_MICROSOFT_OIDC_APP_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
const require = createRequire(path.join(root, 'package.json'));
const knex = require('knex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function validateEnvironment(env) {
  assert.equal(env.NATIVE_MICROSOFT_OIDC_ISOLATED, 'true');
  assert.equal(env.E2E_DATABASE_ISOLATED, 'true');
  assert.equal(env.DB_HOST, env.NATIVE_MICROSOFT_OIDC_EXPECTED_DB_HOST);
  assert.equal(env.DB_NAME_SERVER, env.NATIVE_MICROSOFT_OIDC_EXPECTED_DB_NAME);
  const native = ['127.0.0.1', 'localhost'].includes(env.DB_HOST) && /^oidc_native_[a-z0-9_]+$/.test(env.DB_NAME_SERVER);
  const ci = env.CI === 'true' && env.DB_HOST === 'postgres' && env.DB_NAME_SERVER === 'server';
  assert.ok(native || ci, 'Requires an explicitly owned native or CI database');
  assert.ok(env.DB_USER_ADMIN && env.DB_PASSWORD_ADMIN && env.NATIVE_MICROSOFT_OIDC_SOURCE_EMAIL);
  assert.ok(env.REDIS_HOST && env.REDIS_PORT && env.TEMPORAL_ADDRESS, 'Existing isolated Redis and Temporal bindings are required');
  assert.ok(env.NATIVE_MICROSOFT_OIDC_REPORT, 'A sanitized report output path is required');
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  process.kill(-child.pid, 'SIGTERM');
  await Promise.race([exited, pause(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    process.kill(-child.pid, 'SIGKILL');
    await Promise.race([exited, pause(5000)]);
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'Owned Next process failed to stop');
}
// Stop the owned child immediately so an in-flight callback request unwinds;
// callers still await their operation before running scoped database cleanup.
export function createCallbackCancellation(stopOwnedProcess) {
  const controller = new AbortController();
  let interruptedSignal = null;
  let stopping = null;
  const interrupt = signal => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    controller.abort(new Error('Microsoft callback harness interrupted'));
    stopping = Promise.resolve().then(stopOwnedProcess).then(
      () => ({ error: null }), error => ({ error }),
    );
  };
  const handlers = Object.fromEntries(['SIGTERM', 'SIGINT'].map(signal => [signal, () => interrupt(signal)]));
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler);
  return {
    signal: controller.signal,
    get interruptedSignal() { return interruptedSignal; },
    async dispose() {
      for (const [signal, handler] of Object.entries(handlers)) process.off(signal, handler);
      const result = await stopping;
      if (result?.error) throw result.error;
    },
  };
}

function newFixture() {
  const tenant = randomUUID(), userId = randomUUID();
  return { tenant, userId, email: `native-oidc-${userId}@example.invalid`, clientId: randomUUID(),
    clientSecret: randomBytes(24).toString('hex'), providerObjectId: randomUUID(), microsoftTenantId: 'nativecallback' };
}
async function seedFixture(db, sourceEmail, fixture) {
  return db.transaction(async tx => {
    const sources = await tx('users').where({ email: sourceEmail, user_type: 'internal', is_inactive: false }).select('hashed_password');
    assert.equal(sources.length, 1, 'Source must be one initialized synthetic installation account');
    const { tenant, userId } = fixture;
    await tx('tenants').insert({ tenant, client_name: `Native OIDC ${tenant}`, email: fixture.email, product_code: 'psa' });
    await tx('tenant_settings').insert({ tenant, onboarding_completed: true, settings: { timezone: 'UTC', sso: { autoLinkInternal: true } } });
    await tx('users').insert({ tenant, user_id: userId, username: fixture.email, email: fixture.email,
      first_name: 'Native', last_name: 'Callback', user_type: 'internal', is_inactive: false,
      auth_method: 'password', hashed_password: sources[0].hashed_password });
    return fixture;
  });
}
async function removeFixture(db, fixture) {
  await db.transaction(async tx => {
    const owner = await tx('tenants').where({ tenant: fixture.tenant }).first();
    assert.equal(owner?.client_name, `Native OIDC ${fixture.tenant}`);
    assert.equal(owner?.email, fixture.email);
    // Only known rows created by this fixture and real auth callbacks. An
    // unexpected FK fails cleanup instead of deleting unrelated tenant data.
    for (const table of ['sessions', 'user_auth_accounts', 'user_roles', 'user_preferences', 'users', 'tenant_settings', 'tenants']) {
      if (await tx.schema.hasTable(table)) await tx(table).where({ tenant: fixture.tenant }).delete();
    }
    assert.equal(await tx('tenants').where({ tenant: fixture.tenant }).first(), undefined);
  });
}

export async function runMicrosoftCallback({ env = process.env } = {}) {
  if (env.NATIVE_MICROSOFT_OIDC_REPORT) rmSync(env.NATIVE_MICROSOFT_OIDC_REPORT, { force: true });
  validateEnvironment(env);
  const report = { schemaVersion: 1, scope: 'microsoft-nextauth-callback-development', status: 'failed',
    releaseValidation: false, configuration: { edition: 'enterprise', serverLifecycle: 'next-development', provider: 'microsoft', authority: 'synthetic-loopback', applicationAuthentication: 'nextauth' }, stage: 'fixture', sourceRevision: null, sourceRevisionOrigin: 'unavailable',
    fixtureCleanup: 'not-created', processCleanup: 'not-started' };
  try { report.sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); report.sourceRevisionOrigin = 'git'; }
  catch { if (/^[a-f0-9]{40}$/.test(env.E2E_TEST_REVISION || '')) { report.sourceRevision = env.E2E_TEST_REVISION; report.sourceRevisionOrigin = 'environment'; } }
  const privateDirectory = mkdtempSync(path.join(tmpdir(), 'alga-microsoft-callback-'));
  const db = knex({ client: 'pg', connection: { host: env.DB_HOST, port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME_SERVER, user: env.DB_USER_ADMIN, password: env.DB_PASSWORD_ADMIN }, pool: { min: 0, max: 2 } });
  let fixture, authority, child, seeded = false;
  let childStop;
  const stopOwnedProcess = () => childStop ??= stopChild(child);
  const cancellation = createCallbackCancellation(stopOwnedProcess);
  try {
    fixture = newFixture();
    report.stage = 'authority';
    authority = await startMicrosoftOidcAuthority(fixture);
    cancellation.signal.throwIfAborted();
    const port = await freePort(), origin = `http://localhost:${port}`;
    const appEnv = { ...env, NODE_ENV: 'development', APP_ENV: 'development', EDITION: 'ee', NEXT_PUBLIC_EDITION: 'enterprise',
      DB_HOST_ADMIN: env.DB_HOST, DB_PORT_ADMIN: env.DB_PORT || '5432', DB_USER_SERVER: env.DB_USER_ADMIN, DB_PASSWORD_SERVER: env.DB_PASSWORD_ADMIN,
      MICROSOFT_OAUTH_CLIENT_ID: fixture.clientId, MICROSOFT_OAUTH_CLIENT_SECRET: fixture.clientSecret, MICROSOFT_OAUTH_TENANT_ID: fixture.microsoftTenantId,
      NATIVE_MICROSOFT_OIDC_AUTHORITY: authority.baseUrl, AUTH_URL: origin, NEXTAUTH_URL: origin, NEXT_PUBLIC_BASE_URL: origin, NEXT_PUBLIC_APP_URL: origin,
      REDIS_PREFIX: `native-oidc:${fixture.tenant}:`, REDIS_EVENT_STREAM_PREFIX: `native-oidc:${fixture.tenant}:event-stream:`,
      NEXT_DIST_DIR: '.next/microsoft-oidc-callback', SECRET_READ_CHAIN: 'env,filesystem', SECRET_WRITE_PROVIDER: 'filesystem',
      SECRET_FS_BASE_PATH: path.join(privateDirectory, 'secrets'), STORAGE_LOCAL_BASE_PATH: path.join(privateDirectory, 'files'),
      NODE_OPTIONS: `${env.NODE_OPTIONS || ''} --import ${path.join(root, 'packages/auth/test-harness/microsoft-oidc-preload.mjs')}`.trim() };
    appEnv.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER_ADMIN)}:${encodeURIComponent(env.DB_PASSWORD_ADMIN)}@${env.DB_HOST}:${env.DB_PORT || 5432}/${env.DB_NAME_SERVER}`;
    cancellation.signal.throwIfAborted();
    report.stage = 'app-startup';
    const log = openSync(path.join(privateDirectory, 'server.log'), 'w', 0o600);
    child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--disable-source-maps', '--hostname', '127.0.0.1', '-p', String(port)],
      { cwd: path.join(root, 'server'), env: appEnv, detached: true, stdio: ['ignore', log, log] });
    closeSync(log);
    let spawnError; child.once('error', error => { spawnError = error; });
    report.processCleanup = 'pending';
    const deadline = Date.now() + 180000;
    let ready = false;
    while (Date.now() < deadline && child.exitCode === null && !spawnError && !cancellation.signal.aborted) {
      try { const response = await fetch(`${origin}/api/auth/csrf`, { redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(5000), cancellation.signal]) });
        if (response.status === 200) { ready = true; break; } } catch { /* bounded startup */ }
      await pause(300);
    }
    cancellation.signal.throwIfAborted();
    assert.ok(ready, 'Owned Next auth endpoint did not become ready');
    report.stage = 'fixture';
    await seedFixture(db, env.NATIVE_MICROSOFT_OIDC_SOURCE_EMAIL, fixture);
    seeded = true;
    report.fixtureCleanup = 'pending';
    cancellation.signal.throwIfAborted();
    report.stage = 'callback';
    report.execution = await checkMicrosoftCallback({ origin, authority, fixture, db });
    cancellation.signal.throwIfAborted();
    report.status = 'passed';
    report.stage = 'completed';
  } catch (error) {
    writeFileSync(path.join(privateDirectory, 'failure.json'), JSON.stringify({ stage: report.stage, name: error?.name, code: error?.code, redirectMismatch: error?.redirectMismatch, stackFrames: String(error?.stack || '').split('\n').filter(line => line.trim().startsWith('at ')) }), { mode: 0o600 });
    report.failure = 'callback-harness-failed';
  } finally {
    try { await stopOwnedProcess(); report.processCleanup = 'stopped'; }
    catch { report.status = 'failed'; report.processCleanup = 'failed'; }
    try { await authority?.close(); }
    catch { report.status = 'failed'; report.failure = 'authority-cleanup-failed'; }
    finally {
      try {
        if (seeded && report.processCleanup === 'stopped') { await removeFixture(db, fixture); report.fixtureCleanup = 'removed'; }
        else if (seeded) report.fixtureCleanup = 'retained-process-shutdown-failed';
      } catch (error) { report.status = 'failed'; report.fixtureCleanup = 'failed-retained'; writeFileSync(path.join(privateDirectory, 'cleanup-failure.json'), JSON.stringify({ code: error?.code, table: error?.table, constraint: error?.constraint }), { mode: 0o600 }); }
      finally { try { await db.destroy(); } catch { report.status = 'failed'; report.failure = 'database-connection-cleanup-failed'; } }
    }
    try { await cancellation.dispose(); } catch { report.status = 'failed'; report.processCleanup = 'failed'; }
    if (cancellation.interruptedSignal) { report.status = 'failed'; report.interruptedSignal = cancellation.interruptedSignal; }
    try { report.sourceRevisionAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { report.sourceRevisionAfter = null; }
    writeFileSync(env.NATIVE_MICROSOFT_OIDC_REPORT, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const report = await runMicrosoftCallback(); console.log(JSON.stringify(report)); if (report.status !== 'passed') process.exitCode = report.interruptedSignal === 'SIGINT' ? 130 : report.interruptedSignal === 'SIGTERM' ? 143 : 1; }
  catch { console.error('Microsoft callback harness configuration failed'); process.exitCode = 1; }
}
