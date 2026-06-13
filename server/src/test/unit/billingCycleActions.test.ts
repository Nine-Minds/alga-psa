// server/src/test/unit/billingCycleActions.test.ts

import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest';
import { getBillingCycle, updateBillingCycle, getAllBillingCycles } from '@alga-psa/billing/actions/billingCycleActions';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';

const { mockGetCurrentUser } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
}));

// The actions are wrapped with withAuth; mirror the production wrapper which
// throws when no authenticated user is available.
vi.mock('@alga-psa/auth', () => {
  const wrap = (handler: (...args: any[]) => any) => {
    return async (...args: any[]) => {
      const user = await mockGetCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }
      return handler(user, { tenant: 'test-tenant' }, ...args);
    };
  };

  return {
    getCurrentUser: mockGetCurrentUser,
    getSession: vi.fn().mockResolvedValue(null),
    getSessionWithRevocationCheck: vi.fn().mockResolvedValue(null),
    hasPermission: vi.fn().mockResolvedValue(true),
    withAuth: wrap,
    withAuthCheck: wrap,
    withOptionalAuth: (handler: (...args: any[]) => any) => async (...args: any[]) => {
      const user = await mockGetCurrentUser();
      if (!user) {
        return handler(null, null, ...args);
      }
      return handler(user, { tenant: 'test-tenant' }, ...args);
    },
  };
});

// Permission checks go through @alga-psa/auth/rbac inside the actions.
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

// Mock shared db helpers used within actions; withTransaction passes the
// mocked knex through as the trx so per-test stubs apply.
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(),
  withTransaction: vi.fn(async (knex: any, fn: any) => fn(knex)),
  runWithTenant: vi.fn(async (_tenant: string, cb: any) => cb()),
  getCurrentTenantId: vi.fn(() => 'test-tenant'),
  getTenantContext: vi.fn(async () => 'test-tenant'),
  getTenantIdBySlug: vi.fn(async () => 'test-tenant'),
  registerAfterCommit: vi.fn(),
}));

// Heavy sibling modules pulled in by billingCycleActions' module graph.
vi.mock('@alga-psa/billing/actions/billingAndTax', () => ({
  getNextBillingDate: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({
  hardDeleteInvoice: vi.fn(),
}));
vi.mock('@alga-psa/billing/lib/billing/createBillingCycles', () => ({
  createClientContractLineCycles: vi.fn(),
}));

// Mock shared logger used by various model/action imports pulled into module graph
vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock secret provider used by config/storage
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: () => ({
    getSecret: async (_k: string) => undefined,
    setSecret: async (_k: string, _v: string) => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

// Create mock knex instance factory
function createMockKnex(): Knex {
  const mockKnex = vi.fn(() => mockKnex) as unknown as Knex;

  // Add query builder methods
  (mockKnex as any).where = vi.fn().mockReturnThis();
  (mockKnex as any).whereIn = vi.fn().mockReturnThis();
  (mockKnex as any).andWhere = vi.fn().mockReturnThis();
  (mockKnex as any).first = vi.fn();
  (mockKnex as any).insert = vi.fn().mockReturnThis();
  (mockKnex as any).onConflict = vi.fn().mockReturnThis();
  (mockKnex as any).merge = vi.fn().mockReturnThis();
  (mockKnex as any).update = vi.fn().mockReturnThis();
  (mockKnex as any).orderBy = vi.fn().mockReturnThis();
  (mockKnex as any).del = vi.fn().mockReturnThis();
  (mockKnex as any).select = vi.fn().mockReturnThis();
  (mockKnex as any).raw = vi.fn();

  return mockKnex;
}

describe('Billing Cycle Actions', () => {
  let mockCreateTenantKnex: MockedFunction<typeof createTenantKnex>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({ user_id: 'test-user-id', tenant: 'test-tenant', roles: [] });
    mockCreateTenantKnex = vi.mocked(createTenantKnex);
  });

  describe('getBillingCycle', () => {
    it('should return the billing cycle for a client', async () => {
      const mockKnex = createMockKnex();
      (mockKnex as any).first.mockResolvedValue({ billing_cycle: 'monthly' });
      mockCreateTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: 'test-tenant' });

      const result = await getBillingCycle('client-1');
      expect(result).toBe('monthly');
      expect((mockKnex as any).where).toHaveBeenCalledWith({ client_id: 'client-1', tenant: 'test-tenant' });
    });

    it('should return "monthly" if no billing cycle is set', async () => {
      const mockKnex = createMockKnex();
      (mockKnex as any).first.mockResolvedValue(null);
      mockCreateTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: 'test-tenant' });

      const result = await getBillingCycle('client-2');
      expect(result).toBe('monthly');
    });

    it('should throw an error if user is not authenticated', async () => {
      mockGetCurrentUser.mockResolvedValue(null);

      await expect(getBillingCycle('client-1')).rejects.toThrow('User not authenticated');
    });
  });

  describe('updateBillingCycle', () => {
    it('should update the billing cycle for a client', async () => {
      const mockKnex = createMockKnex();
      mockCreateTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: 'test-tenant' });

      await updateBillingCycle('client-1', 'quarterly');

      expect((mockKnex as any).where).toHaveBeenCalledWith({ client_id: 'client-1', tenant: 'test-tenant' });
      expect((mockKnex as any).update).toHaveBeenCalled();
    });

    it('should throw an error if user is not authenticated', async () => {
      mockGetCurrentUser.mockResolvedValue(null);

      await expect(updateBillingCycle('client-1', 'quarterly')).rejects.toThrow('User not authenticated');
    });
  });

  describe('getAllBillingCycles', () => {
    it('should return all billing cycles', async () => {
      const mockKnex = createMockKnex();
      (mockKnex as any).select.mockResolvedValue([
        { client_id: 'client-1', billing_cycle: 'monthly' },
        { client_id: 'client-2', billing_cycle: 'quarterly' }
      ]);
      mockCreateTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: 'test-tenant' });

      const result = await getAllBillingCycles();
      expect(result).toEqual({
        'client-1': 'monthly',
        'client-2': 'quarterly'
      });
    });

    it('should return an empty object if no billing cycles are set', async () => {
      const mockKnex = createMockKnex();
      (mockKnex as any).select.mockResolvedValue([]);
      mockCreateTenantKnex.mockResolvedValue({ knex: mockKnex, tenant: 'test-tenant' });

      const result = await getAllBillingCycles();
      expect(result).toEqual({});
    });

    it('should throw an error if user is not authenticated', async () => {
      mockGetCurrentUser.mockResolvedValue(null);

      await expect(getAllBillingCycles()).rejects.toThrow('User not authenticated');
    });
  });
});
