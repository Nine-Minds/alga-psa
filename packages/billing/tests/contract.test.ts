/**
 * @alga-psa/billing - Contract Model Tests
 *
 * Tests for the Contract model business logic.
 * These tests verify validation logic and error handling.
 */

import { describe, it, expect, vi } from 'vitest';
import Contract from '../src/models/contract';

// Mock Knex to test validation logic without database
const createMockKnex = () => {
  const mockInsert = vi.fn().mockReturnThis();
  const mockWhere = vi.fn().mockReturnThis();
  const mockAndWhere = vi.fn().mockReturnThis();
  const mockWhereNot = vi.fn().mockReturnThis();
  const mockWhereIn = vi.fn().mockReturnThis();
  const mockWhereNull = vi.fn().mockReturnThis();
  const mockOrWhere = vi.fn().mockReturnThis();
  const mockFirst = vi.fn();
  const mockUpdate = vi.fn().mockReturnThis();
  const mockDelete = vi.fn();
  const mockDel = vi.fn();
  const mockReturning = vi.fn();
  const mockSelect = vi.fn().mockReturnThis();
  const mockLeftJoin = vi.fn().mockReturnThis();
  const mockJoin = vi.fn().mockReturnThis();
  const mockCount = vi.fn().mockReturnThis();
  const mockPluck = vi.fn();
  const mockOrderBy = vi.fn().mockReturnThis();

  const mockKnex = vi.fn(() => ({
    insert: mockInsert,
    where: mockWhere,
    andWhere: mockAndWhere,
    whereNot: mockWhereNot,
    whereIn: mockWhereIn,
    whereNull: mockWhereNull,
    orWhere: mockOrWhere,
    first: mockFirst,
    update: mockUpdate,
    delete: mockDelete,
    del: mockDel,
    returning: mockReturning,
    select: mockSelect,
    leftJoin: mockLeftJoin,
    join: mockJoin,
    count: mockCount,
    pluck: mockPluck,
    orderBy: mockOrderBy,
  }));

  return {
    knex: mockKnex as any,
    mocks: {
      insert: mockInsert,
      where: mockWhere,
      first: mockFirst,
      update: mockUpdate,
      delete: mockDelete,
      del: mockDel,
      returning: mockReturning,
      select: mockSelect,
      count: mockCount,
      pluck: mockPluck,
    },
  };
};

describe('Contract Model', () => {
  describe('isInUse', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.isInUse(knex, '', 'contract-123')).rejects.toThrow(
        'Tenant context is required for checking contract usage'
      );
    });
  });

  describe('hasInvoices', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.hasInvoices(knex, '', 'contract-123')).rejects.toThrow(
        'Tenant context is required for checking contract invoices'
      );
    });
  });

  describe('hasActiveContractForClient', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.hasActiveContractForClient(knex, '', 'client-123')).rejects.toThrow(
        'Tenant context is required for checking client active contracts'
      );
    });
  });

  describe('delete', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.delete(knex, '', 'contract-123')).rejects.toThrow(
        'Tenant context is required for deleting contracts'
      );
    });
  });

  describe('getAll', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.getAll(knex, '')).rejects.toThrow(
        'Tenant context is required for fetching contracts'
      );
    });
  });

  describe('getAllWithClients', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.getAllWithClients(knex, '')).rejects.toThrow(
        'Tenant context is required for fetching contracts'
      );
    });
  });

  describe('getById', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.getById(knex, '', 'contract-123')).rejects.toThrow(
        'Tenant context is required for fetching contracts'
      );
    });
  });

  describe('create', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();
      const contract = {
        contract_name: 'Test Contract',
        billing_frequency: 'monthly',
        currency_code: 'USD',
        is_active: true,
        status: 'draft' as const,
      };

      await expect(Contract.create(knex, '', contract)).rejects.toThrow(
        'Tenant context is required for creating contracts'
      );
    });
  });

  describe('update', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.update(knex, '', 'contract-123', {})).rejects.toThrow(
        'Tenant context is required for updating contracts'
      );
    });
  });

  describe('getContractLines', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.getContractLines(knex, '', 'contract-123')).rejects.toThrow(
        'Tenant context is required for fetching contract lines'
      );
    });
  });

  describe('checkAndReactivateExpiredContract', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(
        Contract.checkAndReactivateExpiredContract(knex, '', 'contract-123')
      ).rejects.toThrow('Tenant context is required for checking contract reactivation');
    });
  });

  describe('checkAndUpdateExpiredStatus', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Contract.checkAndUpdateExpiredStatus(knex, '', 'contract-123')).rejects.toThrow(
        'Tenant context is required for checking contract expiration'
      );
    });
  });
});
