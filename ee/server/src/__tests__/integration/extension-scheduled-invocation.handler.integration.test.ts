import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';

const require = createRequire(import.meta.url);

let db: Knex;

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => db),
}));

const installConfigByInstallId = vi.fn(async (_installId: string) => null);
vi.mock('@ee/lib/extensions/installConfig', () => ({
  getInstallConfigByInstallId: vi.fn((installId: string) => installConfigByInstallId(installId)),
}));

describe('extension-scheduled-invocation handler – DB integration', () => {
  const HOOK_TIMEOUT = 180_000;

  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';

    db = await createTestDbConnection();
    await applyEeMigrationsForExtensionSchedules(db);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    installConfigByInstallId.mockReset();
    process.env.RUNNER_BASE_URL = 'http://runner.test';
    process.env.EXT_GATEWAY_TIMEOUT_MS = '250';

    await db('tenant_extension_schedule').delete().catch(() => undefined);
    await db('extension_api_endpoint').delete().catch(() => undefined);
    await db('tenant_extension_install').delete().catch(() => undefined);
    await db('extension_version').delete().catch(() => undefined);
    await db('extension_registry').delete().catch(() => undefined);

    // Per-test fetch mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = vi.fn(async () => ({
      status: 200,
      text: async () => JSON.stringify({ status: 200 }),
    }));
  });

  it('builds /v1/execute payload and records success', async () => {
    const { tenantId, registryId, versionId, installId, endpointId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: { a: 'b' },
      providers: ['slack'],
      secretEnvelope: { ciphertext_b64: 'xxx' },
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('http://runner.test/v1/execute');
    expect(call[1]?.method).toBe('POST');
    expect(call[1]?.headers?.['x-alga-tenant']).toBe(tenantId);
    expect(call[1]?.headers?.['x-alga-extension']).toBe(registryId);

    const body = JSON.parse(String(call[1]?.body));
    expect(body.context).toMatchObject({
      tenant_id: tenantId,
      extension_id: registryId,
      install_id: installId,
      version_id: versionId,
      trigger: 'schedule',
      schedule_id: scheduleId,
    });
    expect(body.http).toMatchObject({
      method: 'POST',
      path: '/scheduled',
    });
    expect(body.http.body_b64).toBe(Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64'));
    expect(body.providers).toEqual(['slack']);
    expect(body.secret_envelope).toEqual({ ciphertext_b64: 'xxx' });
    expect(body.context.content_hash).toBe('sha256:abc123');
    expect(body.user).toBeUndefined();

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.last_run_at).toBeTruthy();
    expect(row?.last_run_status).toBe('success');
    expect(row?.last_error).toBeNull();

    // Sanity: uses consistent headers inside synthetic http payload.
    expect(body.http.headers).toMatchObject({ 'x-alga-tenant': tenantId, 'x-alga-extension': registryId });
    expect(Object.keys(body.http.headers).sort()).toEqual(['x-alga-extension', 'x-alga-tenant']);
  });

  it('GET endpoints send no body and record failure on runner non-JSON response', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'GET',
      path: '/scheduled',
      payload: { ignored: true },
    });

    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    (globalThis.fetch as any).mockResolvedValueOnce({
      status: 200,
      text: async () => 'not-json',
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow(
      /non-JSON/i
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.http.method).toBe('GET');
    expect(body.http.body_b64).toBeUndefined();

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.last_run_status).toBe('error');
    expect(String(row?.last_error)).toMatch(/non-JSON/i);
  });

  it('records failure on empty runner body', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    (globalThis.fetch as any).mockResolvedValueOnce({
      status: 200,
      text: async () => '',
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow(
      /empty body/i
    );

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.last_run_status).toBe('error');
    expect(String(row?.last_error)).toMatch(/empty body/i);
  });

  it('records failure when runner returns non-2xx status', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    (globalThis.fetch as any).mockResolvedValueOnce({
      status: 500,
      text: async () => JSON.stringify({ status: 500 }),
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow(
      /status/i
    );

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.last_run_status).toBe('error');
    expect(String(row?.last_error)).toMatch(/status/i);
  });

  it('uses payload_json as request body for PUT endpoints', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'PUT',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.http.method).toBe('PUT');
    expect(body.http.body_b64).toBe(Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8').toString('base64'));
  });

  it('timeout aborts runner call and records failure', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    process.env.EXT_GATEWAY_TIMEOUT_MS = '10';

    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    (globalThis.fetch as any).mockImplementationOnce(async (_url: string, init: any) => {
      return await new Promise((_resolve, reject) => {
        const signal: AbortSignal | undefined = init?.signal;
        if (!signal) return reject(new Error('Missing AbortSignal'));
        if (signal.aborted) return reject(new Error('AbortError'));
        signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
      });
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow(
      /abort/i
    );

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.last_run_status).toBe('error');
    expect(String(row?.last_error)).toMatch(/abort/i);
  });

  it('enforces runner response size limit and records failure', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    process.env.EXT_RUNNER_MAX_RESPONSE_BYTES = '64';

    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    (globalThis.fetch as any).mockResolvedValueOnce({
      status: 200,
      text: async () => JSON.stringify({ status: 200, padding: 'x'.repeat(10_000) }),
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow(
      /too large/i
    );

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.last_run_status).toBe('error');
    expect(String(row?.last_error)).toMatch(/too large/i);
  });

  it('records failure when install config cannot be loaded and does not call runner', async () => {
    const { tenantId, installId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    installConfigByInstallId.mockResolvedValueOnce(null);

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow(
      /Install config not found/i
    );

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.last_run_status).toBe('error');
    expect(String(row?.last_error)).toMatch(/Install config not found/i);
  });

  it('lock is released after failure and subsequent run proceeds', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    installConfigByInstallId.mockResolvedValueOnce(null);

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow();

    // Second run with valid install config should proceed (not blocked by stale lock).
    installConfigByInstallId.mockResolvedValueOnce({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    await extensionScheduledInvocationHandler('job-2', { tenantId, installId, scheduleId });
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
  });

  it('disables schedule when endpoint_id is missing (policy)', async () => {
    const { tenantId, installId, scheduleId, endpointId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    await db('extension_api_endpoint').where({ id: endpointId }).del();

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    await expect(extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId })).rejects.toThrow(
      /endpoint/i
    );

    expect((globalThis.fetch as any).mock.calls.length).toBe(0);
    const row = await db('tenant_extension_schedule').where({ id: scheduleId, tenant_id: tenantId }).first();
    expect(row?.enabled).toBe(false);
    expect(row?.last_run_status).toBe('error');
    expect(String(row?.last_error)).toMatch(/endpoint/i);
  });

  it('no-overlap prevents concurrent runs of same schedule', async () => {
    const { tenantId, versionId, installId, scheduleId } = await seed(db, {
      method: 'POST',
      path: '/scheduled',
      payload: { hello: 'world' },
    });

    installConfigByInstallId.mockResolvedValue({
      tenantId,
      installId,
      versionId,
      contentHash: 'abc123',
      config: {},
      providers: [],
      secretEnvelope: null,
    });

    let releaseFetch: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      (globalThis.fetch as any).mockImplementationOnce(async () => {
        resolve();
        await new Promise<void>((r) => {
          releaseFetch = r;
        });
        return { status: 200, text: async () => JSON.stringify({ status: 200 }) };
      });
    });

    const { extensionScheduledInvocationHandler } = await import(
      'server/src/lib/jobs/handlers/extensionScheduledInvocationHandler'
    );

    const first = extensionScheduledInvocationHandler('job-1', { tenantId, installId, scheduleId });
    await fetchStarted;

    // Second invocation should skip due to advisory lock.
    await extensionScheduledInvocationHandler('job-2', { tenantId, installId, scheduleId });
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);

    releaseFetch?.();
    await first;
  });
});

async function seed(
  db: Knex,
  params: { method: string; path: string; payload: unknown }
): Promise<{
  tenantId: string;
  registryId: string;
  versionId: string;
  installId: string;
  endpointId: string;
  scheduleId: string;
}> {
  const tenantId = uuidv4();
  const registryId = uuidv4();
  const versionId = uuidv4();
  const installId = uuidv4();
  const endpointId = uuidv4();
  const scheduleId = uuidv4();

  await ensureTenantRow(db, tenantId);

  await db('extension_registry').insert({
    id: registryId,
    publisher: 'vitest',
    name: `ext-${registryId.slice(0, 8)}`,
    display_name: 'Vitest Scheduled Invocations',
    description: 'Vitest test extension',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('extension_version').insert({
    id: versionId,
    registry_id: registryId,
    version: '1.0.0',
    runtime: 'node',
    main_entry: 'index.js',
    api: JSON.stringify({}),
    ui: null,
    capabilities: JSON.stringify([]),
    api_endpoints: JSON.stringify([{ method: params.method, path: params.path, handler: 'h' }]),
    created_at: db.fn.now(),
  });

  await db('tenant_extension_install').insert({
    id: installId,
    tenant_id: tenantId,
    registry_id: registryId,
    version_id: versionId,
    granted_caps: JSON.stringify([]),
    config: JSON.stringify({}),
    is_enabled: true,
    status: 'enabled',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('extension_api_endpoint').insert({
    id: endpointId,
    version_id: versionId,
    method: String(params.method).toUpperCase(),
    path: String(params.path).startsWith('/') ? String(params.path) : `/${params.path}`,
    handler: 'h',
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('tenant_extension_schedule').insert({
    id: scheduleId,
    tenant_id: tenantId,
    install_id: installId,
    endpoint_id: endpointId,
    enabled: true,
    cron: '0 1 * * *',
    timezone: 'UTC',
    payload_json: params.payload,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { tenantId, registryId, versionId, installId, endpointId, scheduleId };
}

async function ensureTenantRow(db: Knex, id: string): Promise<void> {
  const existing = await db('tenants').where({ tenant: id }).first();
  if (existing) return;
  await db('tenants').insert({
    tenant: id,
    client_name: `Test Co ${id.slice(0, 6)}`,
    email: `test-${id.slice(0, 6)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

async function applyEeMigrationsForExtensionSchedules(connection: Knex): Promise<void> {
  const eeMigrations = [
    '2025080801_create_extension_registry.cjs',
    '2025080802_create_extension_version.cjs',
    '2025080803_create_extension_bundle.cjs',
    '2025080804_create_tenant_extension_install.cjs',
    '20250810140000_align_registry_v2_schema.cjs',
    '20251031130000_create_install_config_tables.cjs',
    '20260101120000_create_extension_schedule_tables.cjs',
  ];

  const repoRoot = path.resolve(process.cwd(), '..', '..');
  for (const name of eeMigrations) {
    const full = path.resolve(repoRoot, 'ee', 'server', 'migrations', name);
    const mod = require(full);
    await mod.up(connection);
  }
}
