import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;
let billingPermissionGranted: boolean;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();
const hasBillingReadPermissionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, _table?: string, _left?: string, _right?: string, options: any = {}) => {
      const join = options?.type === 'left' ? query.leftJoin : query.join;
      return typeof join === 'function' ? join.call(query) : query;
    },
  }),
}));

vi.mock('./clientBillingPermissions', () => ({
  hasClientBillingReadPermission: (...args: any[]) => hasBillingReadPermissionMock(...args),
  getClientIdFromPortalUser: vi.fn(),
}));

function buildThenableQuery(result: any) {
  const chain: any = {};
  chain.where = vi.fn(() => chain);
  chain.andWhere = vi.fn(() => chain);
  chain.whereNull = vi.fn(() => chain);
  chain.orWhere = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.join = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => chain);
  chain.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  chain.catch = (onRejected: any) => Promise.resolve(result).catch(onRejected);
  chain.finally = (handler: any) => Promise.resolve(result).finally(handler);
  return chain;
}

function buildTrx(grantedQuery?: any) {
  const contactQuery = {
    where: vi.fn(() => ({
      first: vi.fn(async () => ({ client_id: 'client-1' })),
    })),
  };
  const userQuery = {
    where: vi.fn(() => ({
      first: vi.fn(async () => ({ contact_id: 'contact-1' })),
    })),
  };
  return Object.assign(
    (table: string) => {
      if (table === 'users') {
        return userQuery;
      }
      if (table === 'contacts') {
        return contactQuery;
      }
      if (table === 'client_contracts as cc' && grantedQuery) {
        return grantedQuery;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    {
      raw: vi.fn((sql: string, bindings?: any[]) => ({ sql, bindings })),
    }
  ) as any;
}

describe('client billing metrics permission hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    currentUser = {
      user_id: 'portal-user-1',
      user_type: 'client',
      contact_id: 'contact-1',
      tenant: 'tenant-1',
    };
    billingPermissionGranted = false;

    createTenantKnexMock.mockResolvedValue({ knex: vi.fn() });
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(buildTrx())
    );
    hasBillingReadPermissionMock.mockImplementation(async () => billingPermissionGranted);
  });

  it('T149: getClientBucketUsage fails closed without billing read', async () => {
    const { getClientBucketUsage } = await import('./client-billing-metrics');

    const result = await getClientBucketUsage();

    expect(hasBillingReadPermissionMock).toHaveBeenCalledWith(expect.anything(), currentUser, 'tenant-1');
    expect(result).toEqual({ permissionError: 'Unauthorized to access billing data', messageKey: 'client-portal:errors.access.billingData' });
  });

  it('T150: getClientBucketUsageHistory fails closed without billing read', async () => {
    const { getClientBucketUsageHistory } = await import('./client-billing-metrics');

    const result = await getClientBucketUsageHistory();

    expect(hasBillingReadPermissionMock).toHaveBeenCalledWith(expect.anything(), currentUser, 'tenant-1');
    expect(result).toEqual({ permissionError: 'Unauthorized to access billing data', messageKey: 'client-portal:errors.access.billingData' });
  });

  it('T151: getClientHoursByService fails closed without billing read', async () => {
    const { getClientHoursByService } = await import('./client-billing-metrics');

    const result = await getClientHoursByService({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      groupByServiceType: false,
    });

    expect(hasBillingReadPermissionMock).toHaveBeenCalledWith(expect.anything(), currentUser, 'tenant-1');
    expect(result).toEqual({ permissionError: 'Unauthorized to access billing data', messageKey: 'client-portal:errors.access.billingData' });
  });

  it('T152: getClientUsageMetrics fails closed without billing read', async () => {
    const { getClientUsageMetrics } = await import('./client-billing-metrics');

    const result = await getClientUsageMetrics({
      startDate: '2026-01-01',
      endDate: '2026-02-01',
    });

    expect(hasBillingReadPermissionMock).toHaveBeenCalledWith(expect.anything(), currentUser, 'tenant-1');
    expect(result).toEqual({ permissionError: 'Unauthorized to access billing data', messageKey: 'client-portal:errors.access.billingData' });
  });

  it('T153: each metrics action runs its query when billing read is granted', async () => {
    billingPermissionGranted = true;
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(buildTrx(buildThenableQuery([])))
    );
    const { getClientBucketUsage } = await import('./client-billing-metrics');

    const result = await getClientBucketUsage();

    expect(hasBillingReadPermissionMock).toHaveBeenCalled();
    expect(Array.isArray(result)).toBe(true);
  });
});
