/**
 * @alga-psa/billing - Invoice Model Tests
 *
 * Tests for the Invoice model business logic.
 * These tests verify validation logic and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Invoice from '../src/models/invoice';

// Mock Knex to test validation logic without database
const createMockKnex = () => {
  const mockInsert = vi.fn().mockReturnThis();
  const mockWhere = vi.fn().mockReturnThis();
  const mockFirst = vi.fn();
  const mockUpdate = vi.fn().mockReturnThis();
  const mockDel = vi.fn();
  const mockReturning = vi.fn();
  const mockSelect = vi.fn().mockReturnThis();
  const mockLeftJoin = vi.fn().mockReturnThis();
  const mockAndOn = vi.fn().mockReturnThis();
  const mockOn = vi.fn().mockReturnThis();
  const mockRaw = vi.fn((sql: string) => sql);
  const mockOrderBy = vi.fn().mockReturnThis();

  const mockKnex = vi.fn(() => ({
    insert: mockInsert,
    where: mockWhere,
    first: mockFirst,
    update: mockUpdate,
    del: mockDel,
    returning: mockReturning,
    select: mockSelect,
    leftJoin: mockLeftJoin,
    andOn: mockAndOn,
    on: mockOn,
    orderBy: mockOrderBy,
  }));

  // Add raw method
  (mockKnex as any).raw = mockRaw;

  // Add schema for hasTable
  (mockKnex as any).schema = {
    hasTable: vi.fn().mockResolvedValue(false),
  };

  return {
    knex: mockKnex as any,
    mocks: {
      insert: mockInsert,
      where: mockWhere,
      first: mockFirst,
      update: mockUpdate,
      del: mockDel,
      returning: mockReturning,
      select: mockSelect,
      raw: mockRaw,
    },
  };
};

describe('Invoice Model', () => {
  describe('create', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();
      const invoice = {
        client_id: 'client-123',
        invoice_date: new Date(),
        due_date: new Date(),
        subtotal: 10000,
        tax: 1000,
        total_amount: 11000,
        currency_code: 'USD',
        status: 'draft' as const,
        invoice_number: 'INV-001',
        credit_applied: 0,
        is_manual: false,
        invoice_charges: [],
      };

      await expect(Invoice.create(knex, '', invoice)).rejects.toThrow(
        'Tenant context is required for creating invoice'
      );
    });

    it('should throw error when total_amount is not an integer', async () => {
      const { knex } = createMockKnex();
      const invoice = {
        client_id: 'client-123',
        invoice_date: new Date(),
        due_date: new Date(),
        subtotal: 10000,
        tax: 1000,
        total_amount: 11000.5, // Not an integer
        currency_code: 'USD',
        status: 'draft' as const,
        invoice_number: 'INV-001',
        credit_applied: 0,
        is_manual: false,
        invoice_charges: [],
      };

      await expect(Invoice.create(knex, 'tenant-123', invoice)).rejects.toThrow(
        'Total amount must be an integer'
      );
    });
  });

  describe('getById', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.getById(knex, '', 'invoice-123')).rejects.toThrow(
        'Tenant context is required for getting invoice'
      );
    });
  });

  describe('update', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.update(knex, '', 'invoice-123', {})).rejects.toThrow(
        'Tenant context is required for updating invoice'
      );
    });
  });

  describe('delete', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.delete(knex, '', 'invoice-123')).rejects.toThrow(
        'Tenant context is required for deleting invoice'
      );
    });
  });

  describe('getAll', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.getAll(knex, '')).rejects.toThrow(
        'Tenant context is required for listing invoices'
      );
    });
  });

  describe('addInvoiceCharge', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();
      const charge = {
        invoice_id: 'invoice-123',
        description: 'Test charge',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000,
        tax_amount: 1000,
        net_amount: 9000,
        rate: 10000,
        is_manual: true,
      };

      await expect(Invoice.addInvoiceCharge(knex, '', charge)).rejects.toThrow(
        'Tenant context is required for adding invoice charge'
      );
    });

    it('should throw error when total_price is not an integer', async () => {
      const { knex } = createMockKnex();
      const charge = {
        invoice_id: 'invoice-123',
        description: 'Test charge',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000.5, // Not an integer
        tax_amount: 1000,
        net_amount: 9000,
        rate: 10000,
        is_manual: true,
      };

      await expect(Invoice.addInvoiceCharge(knex, 'tenant-123', charge)).rejects.toThrow(
        'Total price must be an integer'
      );
    });

    it('should throw error when unit_price is not an integer', async () => {
      const { knex } = createMockKnex();
      const charge = {
        invoice_id: 'invoice-123',
        description: 'Test charge',
        quantity: 1,
        unit_price: 10000.5, // Not an integer
        total_price: 10000,
        tax_amount: 1000,
        net_amount: 9000,
        rate: 10000,
        is_manual: true,
      };

      await expect(Invoice.addInvoiceCharge(knex, 'tenant-123', charge)).rejects.toThrow(
        'Unit price must be an integer'
      );
    });

    it('should throw error when tax_amount is not an integer', async () => {
      const { knex } = createMockKnex();
      const charge = {
        invoice_id: 'invoice-123',
        description: 'Test charge',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000,
        tax_amount: 1000.5, // Not an integer
        net_amount: 9000,
        rate: 10000,
        is_manual: true,
      };

      await expect(Invoice.addInvoiceCharge(knex, 'tenant-123', charge)).rejects.toThrow(
        'Tax amount must be an integer'
      );
    });

    it('should throw error when net_amount is not an integer', async () => {
      const { knex } = createMockKnex();
      const charge = {
        invoice_id: 'invoice-123',
        description: 'Test charge',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000,
        tax_amount: 1000,
        net_amount: 9000.5, // Not an integer
        rate: 10000,
        is_manual: true,
      };

      await expect(Invoice.addInvoiceCharge(knex, 'tenant-123', charge)).rejects.toThrow(
        'Net amount must be an integer'
      );
    });
  });

  describe('getInvoiceCharges', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.getInvoiceCharges(knex, '', 'invoice-123')).rejects.toThrow(
        'Tenant context is required for getting invoice items'
      );
    });
  });

  describe('updateInvoiceCharge', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.updateInvoiceCharge(knex, '', 'item-123', {})).rejects.toThrow(
        'Tenant context is required for updating invoice item'
      );
    });
  });

  describe('deleteInvoiceItem', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.deleteInvoiceItem(knex, '', 'item-123')).rejects.toThrow(
        'Tenant context is required for deleting invoice item'
      );
    });
  });

  describe('getTemplates', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.getTemplates(knex, '')).rejects.toThrow(
        'Tenant context is required for getting templates'
      );
    });
  });

  describe('getAllTemplates', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.getAllTemplates(knex, '')).rejects.toThrow(
        'Tenant context is required for getting all templates'
      );
    });
  });

  describe('saveTemplate', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();
      const template = {
        template_id: 'template-123',
        name: 'Test Template',
        version: 1,
        assemblyScriptSource: '',
      };

      await expect(Invoice.saveTemplate(knex, '', template)).rejects.toThrow(
        'Tenant context is required for saving template'
      );
    });
  });

  describe('generateInvoice', () => {
    it('should throw error when tenant is not provided', async () => {
      const { knex } = createMockKnex();

      await expect(Invoice.generateInvoice(knex, '', 'invoice-123')).rejects.toThrow(
        'Tenant context is required for generating invoice'
      );
    });
  });

  describe('deprecated methods', () => {
    it('addInvoiceItem should call addInvoiceCharge', async () => {
      const { knex } = createMockKnex();
      const charge = {
        invoice_id: 'invoice-123',
        description: 'Test charge',
        quantity: 1,
        unit_price: 10000,
        total_price: 10000,
        tax_amount: 1000,
        net_amount: 9000,
        rate: 10000,
        is_manual: true,
      };

      // Both should throw the same validation error since tenant is empty
      await expect(Invoice.addInvoiceItem(knex, '', charge)).rejects.toThrow(
        'Tenant context is required for adding invoice charge'
      );
    });

    it('getInvoiceItems should call getInvoiceCharges', async () => {
      const { knex } = createMockKnex();

      // Both should throw the same validation error since tenant is empty
      await expect(Invoice.getInvoiceItems(knex, '', 'invoice-123')).rejects.toThrow(
        'Tenant context is required for getting invoice items'
      );
    });

    it('updateInvoiceItem should call updateInvoiceCharge', async () => {
      const { knex } = createMockKnex();

      // Both should throw the same validation error since tenant is empty
      await expect(Invoice.updateInvoiceItem(knex, '', 'item-123', {})).rejects.toThrow(
        'Tenant context is required for updating invoice item'
      );
    });
  });
});
