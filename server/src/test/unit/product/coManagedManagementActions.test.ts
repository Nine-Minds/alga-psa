import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoManagedProvisioningStatus, getCoManagedProvisioningOptions, getCoManagedBillingState,
  changeCoManagedWorkspaceSeats, canOpenCoManagedClientProvisioning } from '../../../lib/actions/coManagedActions';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), capacity: vi.fn(), license: vi.fn(), resize: vi.fn(),
  browser: vi.fn(), options: vi.fn(), status: vi.fn(), client: vi.fn(), db: {},
  user: { tenant: 'home', user_id: 'admin', user_type: 'internal' },
  actor: { kind: 'session', tenant: 'home', userId: 'admin', sessionId: 'tracked-session' },
  rows: {} as Record<string, any[]> }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) => handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: mocks.browser }));
vi.mock('@alga-psa/co-managed', () => ({ canManageCoManagedClient: mocks.client, getCoManagedManagementOptions: mocks.options,
  getCoManagedManagementStatus: mocks.status, changeCoManagedAllocationForActor: mocks.resize }));
vi.mock('@alga-psa/licensing', () => ({ getCoManagedEntitlementState: mocks.capacity, getLicenseStateRow: mocks.license }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: mocks.db }), tenantDb: (_db: any, tenant: string) => ({
  table: (name: string) => {
    let rows = mocks.rows[`${tenant}:${name}`] || [];
    const query: any = { whereIn: (key: string, values: any[]) => { rows = rows.filter(row => values.includes(row[key])); return query; },
      select: () => query, first: async () => rows[0] };
    return query;
  },
}) }));
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(true);
  mocks.browser.mockResolvedValue(mocks.actor); mocks.client.mockResolvedValue(true);
  mocks.options.mockResolvedValue({ clients: [], boards: [] }); mocks.status.mockResolvedValue({ items: [], hasMore: false });
  mocks.license.mockResolvedValue(null); mocks.capacity.mockResolvedValue({ capacity: 3, allocated: 1, available: 2, canGrow: true });
  mocks.rows = { 'home:tenants': [{ product_code: 'psa', plan: 'pro' }] };
});

describe('sponsor management authentication adapters', () => {
  it('passes only the tracked home actor and explicit client, search and page qualifiers to policy-aware reads', async () => {
    expect(await canOpenCoManagedClientProvisioning('selected-client')).toBe(true);
    await getCoManagedProvisioningOptions('search', 'selected-client');
    await getCoManagedProvisioningStatus(3);
    expect(mocks.browser).toHaveBeenCalledTimes(3);
    expect(mocks.browser).toHaveBeenCalledWith(mocks.user, 'home');
    expect(mocks.client).toHaveBeenCalledWith(mocks.db, mocks.actor, 'selected-client');
    expect(mocks.options).toHaveBeenCalledWith(mocks.db, mocks.actor, 'search', 'selected-client');
    expect(mocks.status).toHaveBeenCalledWith(mocks.db, mocks.actor, 3);
  });
  it('forwards only allocation operation and seat quantities, leaving customer identity to durable policy admission', async () => {
    await changeCoManagedWorkspaceSeats({ operationId: 'operation', seats: 2, expectedSeats: 1,
      customerTenant: 'forged-customer', sponsorTenant: 'forged-sponsor', requestedBy: 'forged-user' } as any);
    expect(mocks.resize).toHaveBeenCalledWith(mocks.db, mocks.actor, { operationId: 'operation', seats: 2, expectedSeats: 1 });
  });
  it.each(['client', 'options', 'status', 'resize'])('does not lend API or invalid browser authority to %s', async kind => {
    mocks.browser.mockRejectedValue(new Error('Session authority unavailable'));
    const calls = { client: () => canOpenCoManagedClientProvisioning('client'), options: () => getCoManagedProvisioningOptions(),
      status: () => getCoManagedProvisioningStatus(), resize: () => changeCoManagedWorkspaceSeats({ operationId: 'op', seats: 1, expectedSeats: 2 }) };
    await expect(calls[kind as keyof typeof calls]()).rejects.toThrow('Session authority unavailable');
    for (const check of [mocks.client, mocks.options, mocks.status, mocks.resize]) expect(check).not.toHaveBeenCalled();
  });
  it('denies requester access and missing permissions before entering record-policy work', async () => {
    mocks.user.user_type = 'client';
    await expect(getCoManagedProvisioningStatus()).rejects.toThrow('Permission denied');
    await expect(getCoManagedProvisioningOptions()).rejects.toThrow('Permission denied');
    await expect(changeCoManagedWorkspaceSeats({ operationId: 'op', seats: 1, expectedSeats: 2 })).rejects.toThrow('Permission denied');
    expect(await canOpenCoManagedClientProvisioning('client')).toBe(false);
    mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(false);
    expect(await canOpenCoManagedClientProvisioning('client')).toBe(false);
    expect(mocks.browser).not.toHaveBeenCalled();
  });
  it('propagates record-policy denial without falling back to tenant-wide reads', async () => {
    mocks.options.mockRejectedValue(new Error('Policy denied'));
    mocks.resize.mockRejectedValue(new Error('Policy denied'));
    await expect(getCoManagedProvisioningOptions()).rejects.toThrow('Policy denied');
    await expect(changeCoManagedWorkspaceSeats({ operationId: 'op', seats: 1, expectedSeats: 2 })).rejects.toThrow('Policy denied');
  });
  it('lets relationship readers see sponsor pool capacity without granting purchase authority', async () => {
    mocks.permission.mockImplementation(async (_user, resource) => resource === 'co_management');
    expect(await getCoManagedBillingState()).toMatchObject({ capacity: 3, canReadRelationships: true, canPurchase: false });
  });
});
