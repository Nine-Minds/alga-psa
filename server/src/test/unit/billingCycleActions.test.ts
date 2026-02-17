// server/src/test/actions/billingCycleActions.test.ts

import { describe, it, expect, beforeEach, vi, MockedFunction } from 'vitest';
import { getBillingCycle, updateBillingCycle, getAllBillingCycles } from '@alga-psa/billing/actions';
import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';

let currentUser: { user_id: string; tenant: string } | null = {
  user_id: 'test-user-id',
  tenant: 'test-tenant',
};

// Mock shared db transaction helper used within actions
vi.mock('@alga-psa/db', () => ({
  withTransaction: async (_knex: any, fn: any) => {
    // Execute callback immediately with the provided knex mock
    return await fn(_knex);
  },
  createTenantKnex: vi.fn(),
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
  getSecret: async (_k: string) => undefined,
  getAppSecret: async (_k: string) => undefined,
  getSecretProviderInstance: () => ({
    getSecret: async (_k: string) => undefined,
    getAppSecret: async (_k: string) => undefined,
    setSecret: async (_k: string, _v: string) => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

// Some server actions import from '@alga-psa/core'; provide the same stub
vi.mock('@alga-psa/core', () => ({
  getSecret: async (_k: string) => undefined,
  getAppSecret: async (_k: string) => undefined,
  getSecretProviderInstance: () => ({
    getSecret: async (_k: string) => undefined,
    getAppSecret: async (_k: string) => undefined,
    setSecret: async (_k: string, _v: string) => {},
    getProviderName: () => 'MockSecretProvider',
    close: async () => {},
  }),
}));

// (obsolete) previous db/db mock removed; actions import from server/src/lib/db

// Create mock knex instance factory
function createMockKnex(): Knex {
  const mockKnex = vi.fn(() => mockKnex) as unknown as Knex;
  
  // Add query builder methods
  (mockKnex as any).where = vi.fn().mockReturnThis();
  (mockKnex as any).first = vi.fn();
  (mockKnex as any).insert = vi.fn().mockReturnThis();
  (mockKnex as any).onConflict = vi.fn().mockReturnThis();
  (mockKnex as any).merge = vi.fn().mockReturnThis();
  (mockKnex as any).update = vi.fn().mockReturnThis();
  (mockKnex as any).orderBy = vi.fn().mockReturnThis();
  (mockKnex as any).del = vi.fn().mockReturnThis();
  (mockKnex as any).select = vi.fn().mockReturnThis();

  return mockKnex;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => async (...args: any[]) => {
    if (!currentUser) {
      throw new Error('Unauthorized');
    }
    return fn(currentUser, { tenant: currentUser.tenant }, ...args);
  },
}));

describe('Billing Cycle Actions', () => {
  let mockCreateTenantKnex: MockedFunction<typeof createTenantKnex>;

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { user_id: 'test-user-id', tenant: 'test-tenant' };
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
      currentUser = null;

      await expect(getBillingCycle('client-1')).rejects.toThrow('Unauthorized');
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
      currentUser = null;

      await expect(updateBillingCycle('client-1', 'quarterly')).rejects.toThrow('Unauthorized');
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
      currentUser = null;

      await expect(getAllBillingCycles()).rejects.toThrow('Unauthorized');
    });
  });
});
