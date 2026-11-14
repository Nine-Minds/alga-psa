import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

// External boundaries only: stored-credential getters (secret store) and the
// provider adapters. The DB, disconnect repository, cycle service and handler
// are real.
const qboCredentialsMock = vi.hoisted(() => vi.fn(async () => ({}) as Record<string, any>));
const xeroConnectionsMock = vi.hoisted(() => vi.fn(async () => ({}) as Record<string, any>));
const getConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  getStoredQboCredentialsMap: qboCredentialsMock,
}));
vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  getStoredXeroConnections: xeroConnectionsMock,
}));
vi.mock('server/src/lib/db/db', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  getConnection: getConnectionMock,
}));

import { AccountingAdapterRegistry, SyncCycleRepository } from '@alga-psa/billing/services';
import { accountingSyncCycleHandler } from '@/lib/jobs/handlers/accountingSyncCycleHandler';
import { TestContext } from '../../../../test-utils/testContext';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

function fakeAdapter(type: string, fetchChanges = vi.fn(async () => ({ changes: [], truncated: false, fetchedAt: new Date().toISOString() }))) {
  return { type, capabilities: () => ({ supportsChangePolling: true }), fetchChanges } as any;
}

describe('provider disconnect isolation (real DB)', () => {
  let ctx: TestContext;
  let otherTenant: string;
  let qboFetch: ReturnType<typeof vi.fn>;
  let xeroFetch: ReturnType<typeof vi.fn>;

  const insertDisconnect = (tenant: string, provider: string, status: string) =>
    ctx.db('provider_disconnect_records').insert({
      tenant,
      provider,
      status,
      targets: JSON.stringify([{ targetId: 't', status: 'failed_permanent', updatedAt: new Date().toISOString() }]),
      attempt_count: 1,
      last_error_class: 'xero_http_403',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  const cycles = (tenant: string, adapterType: string) =>
    ctx.db('accounting_sync_cycles').where({ tenant, adapter_type: adapterType }).orderBy('started_at', 'asc');

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: ['provider_disconnect_records', 'accounting_sync_cycles'] });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    vi.stubEnv('EDITION', 'ee');
    vi.stubEnv('NEXT_PUBLIC_EDITION', 'enterprise');
    await ctx.db('provider_disconnect_records').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_sync_cycles').where({ tenant: ctx.tenantId }).del();
    otherTenant = (await ctx.db('tenants').whereNot({ tenant: ctx.tenantId }).first('tenant'))?.tenant ?? null;
    if (!otherTenant) {
      otherTenant = uuidv4();
      await ctx.db('tenants').insert({
        tenant: otherTenant, client_name: 'Other', email: `o-${otherTenant.slice(0, 8)}@example.com`,
        created_at: ctx.db.fn.now(), updated_at: ctx.db.fn.now(),
      });
    }
    await ctx.db('provider_disconnect_records').where({ tenant: otherTenant }).del();

    getConnectionMock.mockResolvedValue(ctx.db);
    qboFetch = vi.fn(async () => ({ changes: [], truncated: false, fetchedAt: new Date().toISOString() }));
    xeroFetch = vi.fn(async () => ({ changes: [], truncated: false, fetchedAt: new Date().toISOString() }));
    vi.spyOn(AccountingAdapterRegistry, 'createDefault').mockResolvedValue(
      new AccountingAdapterRegistry([fakeAdapter('quickbooks_online', qboFetch as any), fakeAdapter('xero', xeroFetch as any)])
    );
    // Auto-sync enabled (the scheduled cycle honours this setting).
    await ctx.db('tenant_settings')
      .insert({ tenant: ctx.tenantId, settings: JSON.stringify({ accountingSync: { autoSyncEnabled: true } }) })
      .onConflict('tenant')
      .merge({ settings: JSON.stringify({ accountingSync: { autoSyncEnabled: true } }) });
    qboCredentialsMock.mockResolvedValue({ 'realm-1': {} });
    xeroConnectionsMock.mockResolvedValue({});
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await ctx.db('provider_disconnect_records').whereIn('tenant', [ctx.tenantId, otherTenant]).del();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  afterAll(async () => { await helpers.afterAll(); }, HOOK_TIMEOUT);

  it('Xero failed_permanent does not stop QBO: a new successful cycle becomes the latest; history and Xero record unchanged', async () => {
    await insertDisconnect(ctx.tenantId, 'xero', 'failed_permanent');
    await ctx.db('accounting_sync_cycles').insert({
      tenant: ctx.tenantId, adapter_type: 'quickbooks_online', target_realm: 'realm-1', status: 'failed',
      error: 'Failed to refresh QBO token. Please re-authenticate.',
      started_at: '2026-11-10T18:15:04.536Z', finished_at: '2026-11-10T18:15:05.144Z',
    });
    const xeroBefore = await ctx.db('provider_disconnect_records').where({ tenant: ctx.tenantId, provider: 'xero' }).first();

    await accountingSyncCycleHandler({ tenantId: ctx.tenantId } as any);

    const rows = await cycles(ctx.tenantId, 'quickbooks_online');
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('failed'); // history retained
    expect(rows[0].error).toMatch(/re-authenticate/);
    const latest = await new SyncCycleRepository(ctx.db).getLatestCycle(ctx.tenantId, 'quickbooks_online', 'realm-1');
    expect(latest?.status).toBe('succeeded');
    expect(latest?.error ?? null).toBeNull();
    expect(qboFetch).toHaveBeenCalledTimes(1);
    const xeroAfter = await ctx.db('provider_disconnect_records').where({ tenant: ctx.tenantId, provider: 'xero' }).first();
    expect(xeroAfter).toEqual(xeroBefore);
    expect(await cycles(ctx.tenantId, 'xero')).toHaveLength(0);
  });

  it.each(['pending_revocation', 'failed_permanent'])(
    'a same-provider %s record writes no QBO cycle and calls no provider API',
    async (status) => {
      await insertDisconnect(ctx.tenantId, 'quickbooks_online', status);
      await accountingSyncCycleHandler({ tenantId: ctx.tenantId } as any);
      expect(await cycles(ctx.tenantId, 'quickbooks_online')).toHaveLength(0);
      expect(qboFetch).not.toHaveBeenCalled();
    }
  );

  it('the same record in ANOTHER tenant does not block this tenant', async () => {
    await insertDisconnect(otherTenant, 'quickbooks_online', 'failed_permanent');
    await accountingSyncCycleHandler({ tenantId: ctx.tenantId } as any);
    const rows = await cycles(ctx.tenantId, 'quickbooks_online');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('succeeded');
  });

  it('a finalized same-provider record does not block', async () => {
    await insertDisconnect(ctx.tenantId, 'quickbooks_online', 'finalized');
    await accountingSyncCycleHandler({ tenantId: ctx.tenantId } as any);
    expect(await cycles(ctx.tenantId, 'quickbooks_online')).toHaveLength(1);
  });
});
