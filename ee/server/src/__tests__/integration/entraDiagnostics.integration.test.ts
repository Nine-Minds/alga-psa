// Real migrated PostgreSQL tables + the Microsoft Graph emulator over HTTP.
// Only request-context plumbing, the secret backend and Temporal transport are
// replaced. Repository queries, token refresh, adapters and report assembly run.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import axios from 'axios';
import knex, { type Knex } from 'knex';
import { pathToFileURL } from 'node:url';

const context = vi.hoisted(() => ({ db: null as unknown as Knex.Transaction,
  secrets: new Map<string, string>(), writes: [] as string[] }));
vi.mock('@alga-psa/db', async importOriginal => ({
  ...await importOriginal(),
  createTenantKnex: async () => ({ knex: context.db }),
}));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: context.db }),
  runWithTenant: async (_tenant: string, fn: () => Promise<unknown>) => fn(),
}));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: async () => context.db }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => ({
  getAppSecret: async () => null,
  getTenantSecret: async (tenant: string, name: string) => context.secrets.get(`${tenant}:${name}`) ?? null,
  setTenantSecret: async (tenant: string, name: string, value: string) => {
    context.writes.push(name); context.secrets.set(`${tenant}:${name}`, value);
  },
}) }));
vi.mock('@ee/lib/integrations/entra/diagnostics/temporalReadiness', () => ({
  probeTemporalReadiness: async () => ({ reachable: true, workerEvidence: 'available' }),
  describeEntraSchedule: async () => ({ configured: true, lookupFailed: false,
    intervalMinutes: 1440, paused: false, nextFireTime: new Date(Date.now() + 86400000).toISOString() }),
}));

import { runEntraConnectionDiagnostics } from '@ee/lib/integrations/entra/diagnostics/connectionDiagnostics';
import { runEntraClientAccessDiagnostics } from '@ee/lib/integrations/entra/diagnostics/clientDiagnostics';
import { ENTRA_DIRECT_SECRET_KEYS } from '@ee/lib/integrations/entra/secrets';

describe('Entra diagnostics: migrated DB and Microsoft Graph emulator', () => {
  let db: Knex;
  let server: Server;
  let core: any;
  let tenant: string;
  let clientId: string;
  let customerId: string;
  let foreignTenant: string;
  let foreignClient: string;
  let baseUrl: string;
  let cippStatus = 200;
  let cippBody: unknown = [];
  let cippFirst404 = false;
  const requests: string[] = [];
  const appId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const secret = 'diagnostics-synthetic-client-secret';
  const protectedTables = ['entra_partner_connections', 'entra_managed_tenants',
    'entra_client_tenant_mappings', 'entra_sync_settings', 'entra_sync_runs',
    'entra_sync_run_tenants', 'entra_contact_links', 'entra_contact_reconciliation_queue',
    'contacts', 'microsoft_profiles', 'microsoft_profile_consumer_bindings'];
  let before: Record<string, unknown>;

  async function snapshot() {
    const rows: Record<string, unknown> = {};
    for (const table of protectedTables) {
      rows[table] = (await context.db(table).whereIn('tenant', [tenant, foreignTenant]))
        .map(row => JSON.stringify(row)).sort();
    }
    return rows;
  }

  beforeAll(async () => {
    const database = process.env.ENTRA_DIAGNOSTICS_TEST_DB || process.env.TEST_DB_NAME;
    if (!database || !/^(test_|entra_diagnostics_)|_test$/.test(database)) {
      throw new Error('Set ENTRA_DIAGNOSTICS_TEST_DB or TEST_DB_NAME to a disposable migrated test database');
    }
    db = knex({ client: 'pg', connection: { host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.ENTRA_DIAGNOSTICS_DB_PORT || process.env.DB_PORT || 5472), database,
      user: process.env.ENTRA_DIAGNOSTICS_DB_USER || process.env.DB_USER_ADMIN || 'postgres',
      password: process.env.ENTRA_DIAGNOSTICS_DB_PASSWORD || process.env.DB_PASSWORD_ADMIN ||
        readFileSync(resolve('../../secrets/postgres_password'), 'utf8').trim() }, pool: { min: 0, max: 2 } });
    expect(await db.schema.hasTable('entra_sync_run_tenants')).toBe(true);
    expect((await db('knex_migrations').count('* as count').first())?.count).not.toBe('0');
    const env = { clock: { now: () => new Date() }, rng: Math.random, log: () => undefined };
    // Load source at runtime so clean CI needs no emulator build, while its
    // separate TypeScript project stays outside the EE application's type graph.
    const source = resolve('../../packages/emulators/msgraph/src');
    const { MsGraphCore } = await import(pathToFileURL(`${source}/core.ts`).href);
    const { wire } = await import(pathToFileURL(`${source}/wire.ts`).href);
    core = new MsGraphCore(env);
    const app = express();
    app.use((req, _res, next) => { requests.push(`${req.method} ${req.path}`); next(); });
    app.get(['/api/listtenants', '/api/tenant/list', '/api/tenants'], (req, res) => {
      if (cippFirst404 && req.path === '/api/listtenants') { res.sendStatus(404); return; }
      res.status(cippStatus).json(cippBody);
    });
    wire(app, core, env);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    baseUrl = base;
    vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', base);
    vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${base}/v1.0`);
    vi.stubEnv('MICROSOFT_GRAPH_BETA_BASE_URL', `${base}/beta`);
    vi.stubEnv('EDITION', 'ee');
    vi.stubEnv('ENTRA_DIAGNOSTICS_JOB_SECRET', 'diagnostics-integration-signing-secret');
  });

  beforeEach(async () => {
    context.db = await db.transaction();
    tenant = randomUUID(); foreignTenant = randomUUID();
    clientId = randomUUID(); foreignClient = randomUUID(); customerId = randomUUID();
    for (const id of [tenant, foreignTenant]) {
      await context.db('tenants').insert({ tenant: id, client_name: 'Northwind IT', email: `${id}@example.test` });
      await context.db('entra_partner_connections').insert({ tenant: id, connection_type: 'direct',
        status: 'connected', is_active: true, connected_at: new Date() });
      await context.db('clients').insert({ tenant: id, client_id: id === tenant ? clientId : foreignClient,
        client_name: id === tenant ? 'Cedar Grove Dental' : 'Foreign private client' });
      const managedId = randomUUID();
      await context.db('entra_managed_tenants').insert({ tenant: id, managed_tenant_id: managedId,
        entra_tenant_id: id === tenant ? customerId : randomUUID(), display_name: 'Cedar Grove Directory' });
      await context.db('entra_client_tenant_mappings').insert({ tenant: id, managed_tenant_id: managedId,
        client_id: id === tenant ? clientId : foreignClient, mapping_state: 'mapped', is_active: true });
    }
    const profileId = randomUUID();
    await context.db('microsoft_profiles').insert({ tenant, profile_id: profileId, display_name: 'Northwind Entra',
      display_name_normalized: 'northwind entra', client_id: appId, tenant_id: 'common',
      client_secret_ref: 'diagnostics-client-secret', capabilities: JSON.stringify(['entra']) });
    await context.db('microsoft_profile_consumer_bindings').insert({ tenant, consumer_type: 'entra', profile_id: profileId });
    await context.db('entra_sync_settings').insert({ tenant, sync_enabled: true });
    core.reset();
    requests.length = 0;
    cippStatus = 200; cippBody = []; cippFirst404 = false;
    core.registerClient(appId, secret);
    core.addOrganization({ id: customerId, displayName: 'Cedar Grove Directory', primaryDomain: 'cedar.example' });
    core.addDirectoryUser({ id: randomUUID(), displayName: 'Jamie Lee', userPrincipalName: 'jamie@cedar.example', accountEnabled: true });
    const code = core.authorize(appId, 'http://localhost/callback', {
      scope: 'User.Read ManagedTenants.Read.All Directory.Read.All offline_access' });
    const tokens = core.grantToken({ grant_type: 'authorization_code', client_id: appId,
      client_secret: secret, redirect_uri: 'http://localhost/callback', code });
    context.secrets.clear(); context.writes.length = 0;
    for (const [key, value] of Object.entries({ 'diagnostics-client-secret': secret,
      [ENTRA_DIRECT_SECRET_KEYS.accessToken]: tokens.access_token,
      [ENTRA_DIRECT_SECRET_KEYS.refreshToken]: tokens.refresh_token!,
      [ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt]: new Date(Date.now() + 3600000).toISOString() })) {
      context.secrets.set(`${tenant}:${key}`, value);
    }
    before = await snapshot();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      expect(await snapshot()).toEqual(before);
      expect(context.writes.every(key => [ENTRA_DIRECT_SECRET_KEYS.accessToken,
        ENTRA_DIRECT_SECRET_KEYS.refreshToken, ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt,
        ENTRA_DIRECT_SECRET_KEYS.tokenScope].includes(key))).toBe(true);
    } finally { await context.db.rollback(); }
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await db?.destroy(); vi.unstubAllEnvs();
  });

  it('runs both scopes successfully without changing domain tables', async () => {
    for (let i = 0; i < 1000; i++) core.addOrganization({ id: randomUUID(), displayName: `Unmapped directory ${i}` });
    const connection = await runEntraConnectionDiagnostics(tenant);
    expect(connection.summary.overallStatus, JSON.stringify(connection.steps)).toBe('pass');
    expect(connection.summary.managedTenantCount).toBe(1001);
    expect(requests.filter(path => path.startsWith('POST '))).toEqual(['POST /common/oauth2/v2.0/token']);
    expect(requests.filter(path => path === 'GET /beta/tenantRelationships/managedTenants/tenants').length).toBeGreaterThan(2);
    expect(connection.steps.find(s => s.id === 'managed_tenants_endpoint')?.http?.requestId).toBeTruthy();
    const clients = await runEntraClientAccessDiagnostics(tenant, 'operator', { includeUserYield: true });
    expect(clients.isDone).toBe(true);
    expect(clients.clients[0].overallStatus, JSON.stringify(clients.clients[0].steps)).toBe('warn');
    expect(clients.clients[0].steps.find(s => s.id === 'shared_mailbox_detection')?.status).toBe('warn');
    expect(clients.clients[0].steps.find(s => s.id === 'user_yield_preview')?.data).toMatchObject({ totalUsers: 1, includedUsers: 1 });
    expect(JSON.stringify(connection.supportBundle)).not.toContain(secret);
    expect(context.writes.length).toBeGreaterThan(0);
  });

  it('partner consent failure blocks discovery and retains Graph correlation', async () => {
    core.injectOperationFault('GET /tenantRelationships/managedTenants/tenants', {
      status: 403, body: { error: { code: 'Authorization_RequestDenied', message: 'consent_missing' } } });
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(s => s.id === 'managed_tenants_endpoint')).toMatchObject({ status: 'fail', http: { status: 403, requestId: expect.any(String) } });
    expect(report.steps.find(s => s.id === 'managed_tenants_count')?.status).toBe('skip');
    expect(JSON.stringify(report.recommendations)).toContain('Global Administrator');
    expect(report.summary.mappedClientCount).toBe(1);
  });

  it('customer consent generates a customer-specific consent link', async () => {
    core.injectOperationFault(`token:${customerId}`, { status: 400,
      body: { error: 'invalid_grant', suberror: 'consent_required', error_description: 'AADSTS65001: customer consent missing' } });
    const report = await runEntraClientAccessDiagnostics(tenant, 'operator', {});
    expect(report.aggregate.need_consent).toBe(1);
    expect(JSON.stringify(report.recommendations)).toContain(`https://login.microsoftonline.com/${customerId}/adminconsent?client_id=${appId}`);
    expect(report.clients[0].steps.find(s => s.id === 'users_read')?.status).toBe('skip');
    expect(requests.filter(path => path === `POST /${customerId}/oauth2/v2.0/token`)).toHaveLength(1);
  });

  it('customer users 403 means missing GDAP role', async () => {
    core.injectOperationFault(`${customerId}:GET /users`, { status: 403,
      body: { error: { code: 'Authorization_RequestDenied', message: 'Insufficient privileges' } } });
    const report = await runEntraClientAccessDiagnostics(tenant, 'operator', {});
    expect(report.aggregate.missing_role).toBe(1);
    expect(JSON.stringify(report.recommendations)).toContain('GDAP');
    expect(report.clients[0].steps.find(s => s.id === 'groups_read')?.status).toBe('pass');
  });

  it('an empty managed tenant response is a warning', async () => {
    core.organizations.clear();
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(s => s.id === 'managed_tenants_count')?.status).toBe('warn');
  });

  it('expired client secret blocks Graph with a rotate-secret remedy', async () => {
    core.injectOperationFault('token:common', { status: 400, body: {
      error: 'invalid_client', error_description: 'AADSTS7000222: client secret expired' } });
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(s => s.id === 'token_refresh')).toMatchObject({ status: 'fail', error: { aadstsCode: 'AADSTS7000222' } });
    expect(report.steps.find(s => s.id === 'managed_tenants_endpoint')?.status).toBe('skip');
  });

  it('rejects foreign-client selections before minting a token', async () => {
    const report = await runEntraClientAccessDiagnostics(tenant, 'operator', { clientIds: [foreignClient] });
    expect(report.error).toBeTruthy();
    expect(report.clients).toEqual([]);
    expect(context.writes).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('Foreign private client');
  });

  it('finds consecutive real failures behind 25 preflights and decodes nested customer consent', async () => {
    const failedId = randomUUID();
    await context.db('entra_sync_runs').insert([
      { tenant, run_id: failedId, status: 'failed', is_dry_run: false, started_at: new Date(Date.now() - 60000) },
      { tenant, run_id: randomUUID(), status: 'failed', is_dry_run: false, started_at: new Date(Date.now() - 120000) },
      ...Array.from({ length: 25 }, () => ({ tenant, run_id: randomUUID(), status: 'completed', is_dry_run: true, started_at: new Date() })),
    ]);
    const mapping = await context.db('entra_client_tenant_mappings').where({ tenant, client_id: clientId }).first();
    await context.db('entra_sync_run_tenants').insert({ tenant, run_id: failedId, status: 'failed',
      managed_tenant_id: mapping.managed_tenant_id, client_id: clientId,
      error_message: JSON.stringify({ message: 'Activity task failed', cause: JSON.stringify({
        message: 'AADSTS65001: customer admin consent missing', refresh_token: 'never-export-this-secret' }) }) });
    before = await snapshot();
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(s => s.id === 'last_runs')).toMatchObject({ status: 'warn', data: {
      decodedFailure: { message: 'AADSTS65001: customer admin consent missing', level: 'tenant' } } });
    expect(JSON.stringify(report.recommendations)).toContain(`/` + customerId + '/adminconsent');
    expect(JSON.stringify(report)).not.toContain('never-export-this-secret');
  });

  it('decodes a run-level error when no tenant result was recorded', async () => {
    await context.db('entra_sync_runs').insert({ tenant, status: 'failed', is_dry_run: false,
      summary: JSON.stringify({ error: { cause: { message: 'AADSTS7000222: expired client secret' } } }) });
    before = await snapshot();
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(s => s.id === 'last_runs')?.data).toMatchObject({
      decodedFailure: { level: 'run', aadstsCode: 'AADSTS7000222' } });
  });

  it('reports aged reconciliation work only for the current workspace without changing it', async () => {
    const oldest = new Date(Date.now() - 3 * 86400000);
    await context.db('entra_contact_reconciliation_queue').insert([
      { tenant, entra_tenant_id: customerId, entra_object_id: randomUUID(), created_at: oldest },
      { tenant: foreignTenant, entra_tenant_id: randomUUID(), entra_object_id: randomUUID(),
        display_name: 'Foreign private queue', created_at: new Date(0) },
    ]);
    before = await snapshot();
    const report = await runEntraConnectionDiagnostics(tenant);
    const step = report.steps.find(step => step.id === 'reconciliation_queue');
    expect(step).toMatchObject({ status: 'warn', data: { openCount: 1 } });
    expect(Number(step?.data?.oldestAgeMs)).toBeGreaterThanOrEqual(3 * 86400000);
    expect(Number(step?.data?.oldestAgeMs)).toBeLessThan(4 * 86400000);
    expect(JSON.stringify(report)).not.toContain('Foreign private queue');
  });

  it('finishes fifty clients in bounded requests and refuses foreign continuation identities', async () => {
    for (let i = 1; i < 50; i++) {
      const client = randomUUID(); const managed = randomUUID();
      await context.db('clients').insert({ tenant, client_id: client, client_name: `Mapped client ${i}` });
      await context.db('entra_managed_tenants').insert({ tenant, managed_tenant_id: managed,
        entra_tenant_id: randomUUID(), display_name: `Directory ${i}` });
      await context.db('entra_client_tenant_mappings').insert({ tenant, managed_tenant_id: managed,
        client_id: client, mapping_state: 'mapped', is_active: true });
    }
    before = await snapshot();
    let result = await runEntraClientAccessDiagnostics(tenant, 'operator', {});
    expect(result.completed).toBe(3);
    expect(result.isDone).toBe(false);
    const requestCount = requests.length;
    for (const [workspace, operator] of [[foreignTenant, 'operator'], [tenant, 'another-operator']]) {
      const denied = await runEntraClientAccessDiagnostics(workspace, operator, { continuation: result.jobId });
      expect(denied.error).toBeTruthy(); expect(denied.clients).toEqual([]);
    }
    expect(requests).toHaveLength(requestCount);
    let previous = result.completed; let batches = 1;
    while (!result.isDone && batches < 20) {
      result = await runEntraClientAccessDiagnostics(tenant, 'operator', { continuation: result.jobId });
      expect(result.completed - previous).toBeGreaterThan(0);
      expect(result.completed - previous).toBeLessThanOrEqual(3);
      previous = result.completed; batches++;
    }
    expect(result.isDone).toBe(true); expect(result.completed).toBe(50);
    expect(result.aggregate.other).toBe(50); expect(batches).toBe(17);
    expect(requests.filter(path => path.startsWith('POST '))).toHaveLength(50);
  });

  it('reports missing setup without inserting defaults or attempting OAuth', async () => {
    await context.db('entra_partner_connections').where({ tenant }).del();
    await context.db('entra_sync_settings').where({ tenant }).del();
    before = await snapshot();
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(s => s.id === 'connection_row')?.status).toBe('fail');
    expect(report.steps.find(s => s.id === 'last_runs')?.data).toMatchObject({ noRuns: true });
    expect(requests).toEqual([]);
  });

  it('applies stored custom filters and all built-in exclusion reasons without creating sync data', async () => {
    await context.db('entra_sync_settings').where({ tenant }).update({
      user_filter_config: JSON.stringify({ version: 1, memberUsersOnly: false, licensedUsersOnly: false, includeGroupIds: [], excludeGroupIds: [], exclusionPatterns: ['contractor'], deactivateExcludedContacts: false }) });
    before = await snapshot();
    core.addDirectoryUser({ userPrincipalName: 'disabled@cedar.example', accountEnabled: false });
    core.addDirectoryUser({ userPrincipalName: '', mail: null, accountEnabled: true });
    core.addDirectoryUser({ userPrincipalName: 'svc-monitor@cedar.example', accountEnabled: true });
    core.addDirectoryUser({ userPrincipalName: 'contractor@cedar.example', accountEnabled: true });
    const report = await runEntraClientAccessDiagnostics(tenant, 'operator', { includeUserYield: true });
    expect(report.clients[0].steps.find(step => step.id === 'user_yield_preview')?.data).toMatchObject({
      totalUsers: 5, includedUsers: 1, excludedByReason: { account_disabled: 1, missing_identity: 1, service_account: 1, tenant_custom_pattern: 1 } });
    expect(requests.filter(path => path === `POST /${customerId}/oauth2/v2.0/token`)).toHaveLength(1);
  });

  it('resumes a full directory preview across requests without double-counting or serializing credentials', async () => {
    for (let i = 0; i < 10000; i++) core.addDirectoryUser({
      userPrincipalName: `person${i}@cedar.example`, accountEnabled: true });
    const first = await runEntraClientAccessDiagnostics(tenant, 'operator', { includeUserYield: true });
    expect(first.isDone).toBe(false);
    expect(first.completed).toBe(0);
    expect(first.jobId).toBeTruthy();
    const state = Buffer.from(first.jobId.split('.')[0], 'base64url').toString();
    expect(state).not.toContain(secret);
    expect(state).not.toMatch(/access_token|refresh_token|Bearer /);
    const second = await runEntraClientAccessDiagnostics(tenant, 'operator', { continuation: first.jobId });
    expect(second.isDone).toBe(true);
    expect(second.completed).toBe(1);
    expect(second.clients[0].steps.find(step => step.id === 'user_yield_preview')?.data)
      .toMatchObject({ totalUsers: 10001, includedUsers: 10001 });
  });

  async function useCipp() {
    await context.db('entra_partner_connections').where({ tenant }).update({ connection_type: 'cipp' });
    context.secrets.set(`${tenant}:entra_cipp_base_url`, baseUrl);
    context.secrets.set(`${tenant}:entra_cipp_api_token`, 'synthetic-cipp-api-key');
    before = await snapshot();
  }

  it('CIPP falls back from 404 to the alternative endpoint and normalizes discovery', async () => {
    await useCipp(); cippFirst404 = true;
    cippBody = [{ customerId, displayName: 'Cedar Grove Directory', defaultDomainName: 'cedar.example' }];
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(requests).toEqual(['GET /api/listtenants', 'GET /api/tenant/list']);
    expect(report.steps.find(step => step.id === 'cipp_tenant_list')?.status).toBe('pass');
    expect(report.summary.managedTenantCount).toBe(1);
  });

  it('CIPP successful empty discovery warns without claiming an HTTP failure', async () => {
    await useCipp();
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(step => step.id === 'cipp_reachable')?.status).toBe('pass');
    expect(report.steps.find(step => step.id === 'cipp_tenant_list')?.status).toBe('warn');
  });

  it.each([404, 500, 401, 403, 200])('CIPP HTTP %s runs through the real probe and skips dependent checks', async status => {
    await useCipp();
    cippStatus = status;
    cippBody = { unexpected: 'This is not a tenant list' };
    const report = await runEntraConnectionDiagnostics(tenant);
    const steps = Object.fromEntries(report.steps.map(step => [step.id, step]));
    if ([401, 403].includes(status)) {
      expect(steps.cipp_auth.status).toBe('fail');
      expect(JSON.stringify(report.recommendations)).toContain('CIPP API key');
    } else expect(steps.cipp_reachable.status).toBe('fail');
    expect(steps.cipp_tenant_list.status).toBe('skip');
    expect(steps.cipp_mappings_vs_list.status).toBe('skip');
  });

  it.each(['ENOTFOUND', 'CERT_HAS_EXPIRED', 'ETIMEDOUT'])('CIPP transport %s is classified by the real probe', async code => {
    await useCipp();
    // DNS/TLS/deadline are injected at the transport seam; the CIPP probe,
    // report, secrets and DB reads are still the real implementations.
    vi.spyOn(axios, 'get').mockRejectedValue(new axios.AxiosError(code, code));
    const report = await runEntraConnectionDiagnostics(tenant);
    expect(report.steps.find(step => step.id === 'cipp_reachable')?.status).toBe('fail');
    expect(report.steps.find(step => step.id === 'cipp_tenant_list')?.status).toBe('skip');
  });
});
