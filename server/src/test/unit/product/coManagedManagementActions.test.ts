import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCoManagedProvisioningStatus, getCoManagedProvisioningOptions, getCoManagedBillingState, changeCoManagedWorkspaceSeats, canOpenCoManagedClientProvisioning } from '../../../lib/actions/coManagedActions';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), capacity: vi.fn(), license: vi.fn(), resize: vi.fn(),
  user: { tenant: 'home', user_id: 'admin', user_type: 'internal' }, rows: {} as Record<string, any[]>, reads: [] as string[] }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) => handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/licensing', () => ({ getCoManagedEntitlementState: mocks.capacity, getLicenseStateRow: mocks.license, changeCoManagedAllocation: mocks.resize }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {} }), tenantDb: (_db: any, tenant: string) => ({
  table: (table: string) => {
    const key = `${tenant}:${table}`; mocks.reads.push(key);
    let rows = [...(mocks.rows[key] || [])]; let offset = 0, limit = Infinity;
    const value = () => rows.slice(offset, offset + limit);
    const query: any = {
      where: (key: any, expected: any) => { const match = typeof key === 'string' ? { [key]: expected } : key;
        rows = rows.filter(row => Object.entries(match).every(([column, expected]) => row[column] === expected)); return query; },
      whereIn: (key: string, values: any[]) => { rows = rows.filter(row => values.includes(row[key])); return query; },
      whereILike: (_key: string, _pattern: string) => query,
      orderBy: () => query, offset: (n: number) => { offset = n; return query; }, limit: (n: number) => { limit = n; return query; },
      select: () => query, first: async () => value()[0], then: (resolve: any, reject: any) => Promise.resolve(value()).then(resolve, reject),
    }; return query;
  },
}) }));
const clientId = 'a0000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.resetAllMocks(); mocks.reads.length = 0; mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(true);
  mocks.license.mockResolvedValue(null); mocks.capacity.mockResolvedValue({ capacity: 3, allocated: 1, available: 2, canGrow: true });
  mocks.rows = { 'home:tenants': [{ product_code: 'psa', plan: 'pro' }],
    'home:clients': [{ client_id: clientId, client_name: 'Own client', is_inactive: false, tax_id: 'private commercial field' }],
    'home:boards': [{ board_id: 'own-board', board_name: 'Own queue', is_inactive: false, sensitive: 'not returned' }],
    'home:co_managed_provisioning_operations': [{ operation_id: 'own-operation', customer_tenant: 'own-customer', relationship_id: 'own-relationship',
      state: 'pending_acceptance', request: { workspaceName: 'Own customer', administrator: { email: 'admin@example.test' }, seats: 1 },
      invitation_sent_at: null, unexpected_token: 'never-return' }],
    'own-customer:co_management_relationships': [{ relationship_id: 'own-relationship', sponsor_tenant: 'home', state: 'active' }],
    'sibling:co_managed_provisioning_operations': [{ operation_id: 'sibling-operation', request: { workspaceName: 'Hidden sibling' } }],
  };
});
describe('sponsor co-management read boundaries', () => {
  it('returns only own progress and lifecycle state, excluding internal fields and sibling operations', async () => {
    const result = await getCoManagedProvisioningStatus();
    expect(result.items).toEqual([{ operationId: 'own-operation', workspaceName: 'Own customer', administratorEmail: 'admin@example.test',
      seats: 1, canChangeSeats: false, state: 'active', invitationSent: false, deliveryFailed: false, canRetry: false }]);
    expect(JSON.stringify(result)).not.toContain('never-return');
    expect(mocks.reads.some(key => key.startsWith('sibling:'))).toBe(false);
  });
  it('does not use a foreign relationship belonging to another sponsor', async () => {
    mocks.rows['own-customer:co_management_relationships'][0].sponsor_tenant = 'another-sponsor';
    expect((await getCoManagedProvisioningStatus()).items[0].state).toBe('pending_acceptance');
  });
  it('returns a paginated list and no unbounded progress payload', async () => {
    const record = mocks.rows['home:co_managed_provisioning_operations'][0];
    mocks.rows['home:co_managed_provisioning_operations'] = Array.from({ length: 28 }, (_, i) => ({ ...record, operation_id: `operation-${i}` }));
    expect(await getCoManagedProvisioningStatus(0)).toMatchObject({ hasMore: true, items: expect.any(Array) });
    expect((await getCoManagedProvisioningStatus(0)).items).toHaveLength(25);
    expect((await getCoManagedProvisioningStatus(1)).items).toHaveLength(3);
    await expect(getCoManagedProvisioningStatus(-1)).rejects.toThrow('Invalid page');
  });
  it('returns only the client and board labels needed by the form', async () => {
    expect(await getCoManagedProvisioningOptions('', clientId)).toEqual({ clients: [{ id: clientId, name: 'Own client' }], boards: [{ id: 'own-board', name: 'Own queue' }] });
  });
  it('denies requesters and missing management permissions before any data read', async () => {
    mocks.user.user_type = 'client';
    await expect(getCoManagedProvisioningStatus()).rejects.toThrow('Permission denied');
    await expect(getCoManagedProvisioningOptions()).rejects.toThrow('Permission denied');
    expect(mocks.reads).toEqual([]);
    mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(false);
    expect(await canOpenCoManagedClientProvisioning(clientId)).toBe(false);
    expect(mocks.reads).toEqual([]);
  });
  it('lets relationship readers see seat capacity without granting purchase authority', async () => {
    mocks.permission.mockImplementation(async (_user, resource) => resource === 'co_management');
    expect(await getCoManagedBillingState()).toMatchObject({ capacity: 3, canReadRelationships: true, canPurchase: false });
  });
  it('hides client provisioning for Essentials, customer workspaces, and foreign client IDs', async () => {
    expect(await canOpenCoManagedClientProvisioning(clientId)).toBe(true);
    expect(await canOpenCoManagedClientProvisioning('b0000000-0000-4000-8000-000000000002')).toBe(false);
    mocks.rows['home:tenants'][0].plan = 'essentials';
    expect(await canOpenCoManagedClientProvisioning(clientId)).toBe(false);
    mocks.rows['home:tenants'][0] = { product_code: 'co_managed', plan: 'pro' };
    expect(await canOpenCoManagedClientProvisioning(clientId)).toBe(false);
  });
});

it('resizes only a sponsor-owned operation and derives the customer identity from its durable record', async () => {
  const operationId = 'a0000000-0000-4000-8000-000000000002';
  await expect(changeCoManagedWorkspaceSeats({ operationId, seats: 2, expectedSeats: 1 })).rejects.toThrow('not found');
  expect(mocks.resize).not.toHaveBeenCalled();
  mocks.rows['home:co_managed_provisioning_operations'][0].operation_id = operationId;
  await changeCoManagedWorkspaceSeats({ operationId, seats: 2, expectedSeats: 1, customerTenant: 'forged-customer', sponsorTenant: 'forged-sponsor' } as any);
  expect(mocks.resize).toHaveBeenCalledWith({}, 'home', { customerTenant: 'own-customer', relationshipId: 'own-relationship', seats: 2, expectedSeats: 1 });
});
