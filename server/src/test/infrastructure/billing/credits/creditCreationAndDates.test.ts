import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { setupClientTaxConfiguration, assignServiceTaxRate } from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createPrepaymentInvoice } from 'server/src/lib/actions/creditActions';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { v4 as uuidv4 } from 'uuid';
import type { IClient } from '../../interfaces/client.interfaces';
import { Temporal } from '@js-temporal/polyfill';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expiredCreditsHandler } from 'server/src/lib/jobs/handlers/expiredCreditsHandler';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { TextEncoder as NodeTextEncoder } from 'util';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

process.env.DB_PORT = '5432';
process.env.DB_HOST = process.env.DB_HOST === 'pgbouncer' ? 'localhost' : process.env.DB_HOST;
process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'credit_creation_tests';

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

async function mockSharedDb() {
  const actual = await import('@alga-psa/shared/db');
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
}

vi.mock('@alga-psa/shared/db', mockSharedDb);
vi.mock('@shared/db', mockSharedDb);

vi.mock('@shared/core/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('@shared/workflow/streams/eventBusSchema', () => ({
  BaseEvent: class {},
  Event: class {
    id = 'mock-event-id';
    payload = { tenantId: 'mock-tenant-id' };
  },
  EventType: {} as Record<string, string>,
  EventSchemas: {} as Record<string, unknown>,
  BaseEventSchema: {},
  convertToWorkflowEvent: vi.fn((event) => event)
}));

vi.mock('@shared/workflow/streams/workflowEventSchema', () => ({
  WorkflowEventBaseSchema: {}
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

vi.mock('server/src/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    user_type: 'internal',
    roles: []
  }))
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

/**
 * Tests for credit creation with expiration dates.
 * 
 * These tests focus on how expiration dates are assigned to credits:
 * - Using client-specific settings to determine expiration dates
 * - Falling back to default settings when client settings are not available
 * - Supporting custom expiration dates specified during credit creation
 */

describe('Credit Creation and Dates Tests', () => {
  let context: TestContext;

  async function ensureDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State + City Tax',
      startDate: '2025-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_items',
        'invoices',
        'transactions',
        'credit_tracking',
        'client_billing_cycles',
        'client_contract_lines',
        'contract_line_services',
        'service_catalog',
        'contract_lines',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'tax_regions',
        'client_tax_settings',
        'client_tax_rates',
        'client_billing_settings',
        'default_billing_settings'
      ],
      clientName: 'Credit Expiration Test Client',
      userType: 'internal'
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    const sessionModule = await import('server/src/lib/auth/getSession');
    vi.mocked(sessionModule.getSession).mockResolvedValue({
      user: {
        id: mockedUserId,
        tenant: mockedTenantId
      }
    });

    await ensureDefaultTax();
  }, 60000);

  beforeEach(async () => {
    context = await resetContext();
    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    const sessionModule = await import('server/src/lib/auth/getSession');
    vi.mocked(sessionModule.getSession).mockResolvedValue({
      user: {
        id: mockedUserId,
        tenant: mockedTenantId
      }
    });
    await ensureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should create credits with expiration dates based on client settings', async () => {
    const client_id = context.clientId;

    // Set up client billing settings with specific expiration days and explicitly enable credit expiration
    const expirationDays = 45; // 45-day expiration period
    await context.db('client_billing_settings')
      .insert({
        client_id: client_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: expirationDays,
        credit_expiration_notification_days: [14, 7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['client_id', 'tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: expirationDays,
        credit_expiration_notification_days: [14, 7, 1],
        updated_at: new Date().toISOString()
      });

    // Also ensure default settings have credit expiration enabled
    await context.db('default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 365,
        credit_expiration_notification_days: [30, 7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['tenant'])
      .merge({
        enable_credit_expiration: true,
        updated_at: new Date().toISOString()
      });

    // Create prepayment invoice WITHOUT specifying an expiration date
    // This should use the client settings to determine the expiration date
    const prepaymentAmount = 15000; // $150.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount
      // No expiration date provided - should use client settings
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Verify the transaction has an expiration date
    expect(creditTransaction).toBeTruthy();
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Calculate expected expiration date (current date + expirationDays)
    const today = new Date();
    const expectedExpirationDate = new Date(today);
    expectedExpirationDate.setDate(today.getDate() + expirationDays);
    
    // Convert both dates to date-only strings for comparison (ignoring time)
    const actualExpirationDate = new Date(creditTransaction.expiration_date);
    const actualDateString = actualExpirationDate.toISOString().split('T')[0];
    const expectedDateString = expectedExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date matches client settings
    expect(actualDateString).toBe(expectedDateString);
    
    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify credit tracking entry has the same expiration date
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(expectedExpirationDate));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
  });

  it('should create credits with expiration dates based on default settings when client settings are not available', async () => {
    const client_id = context.clientId;

    // Ensure no client-specific billing settings exist
    await context.db('client_billing_settings')
      .where({ client_id, tenant: context.tenantId })
      .delete();

    // Set up default billing settings with specific expiration days
    const defaultExpirationDays = 180; // 180-day default expiration period
    await context.db('default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: defaultExpirationDays,
        credit_expiration_notification_days: [30, 14, 7],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: defaultExpirationDays,
        credit_expiration_notification_days: [30, 14, 7],
        updated_at: new Date().toISOString()
      });

    // Create prepayment invoice WITHOUT specifying an expiration date
    // This should use the default settings to determine the expiration date
    const prepaymentAmount = 20000; // $200.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount
      // No expiration date provided - should use default settings
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Verify the transaction has an expiration date
    expect(creditTransaction).toBeTruthy();
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Calculate expected expiration date (current date + defaultExpirationDays)
    const today = new Date();
    const expectedExpirationDate = new Date(today);
    expectedExpirationDate.setDate(today.getDate() + defaultExpirationDays);
    
    // Convert both dates to date-only strings for comparison (ignoring time)
    const actualExpirationDate = new Date(creditTransaction.expiration_date);
    const actualDateString = actualExpirationDate.toISOString().split('T')[0];
    const expectedDateString = expectedExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date matches default settings
    expect(actualDateString).toBe(expectedDateString);
    
    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify credit tracking entry has the same expiration date
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(expectedExpirationDate));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
  });

  it('should allow prepayment invoices to specify custom expiration dates', async () => {
    const client_id = context.clientId;

    // Set up client billing settings with expiration days
    const clientExpirationDays = 30; // 30-day client expiration period
    await context.db('client_billing_settings')
      .insert({
        client_id: client_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: clientExpirationDays,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['client_id', 'tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: clientExpirationDays,
        credit_expiration_notification_days: [7, 1],
        updated_at: new Date().toISOString()
      });

    // Set up default billing settings with different expiration days
    const defaultExpirationDays = 60; // 60-day default expiration period
    await context.db('default_billing_settings')
      .insert({
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: defaultExpirationDays,
        credit_expiration_notification_days: [30, 14, 7],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: defaultExpirationDays,
        credit_expiration_notification_days: [30, 14, 7],
        updated_at: new Date().toISOString()
      });

    // Create a custom expiration date (120 days in the future)
    const customExpirationDays = 120;
    const today = new Date();
    const customExpirationDate = new Date(today);
    customExpirationDate.setDate(today.getDate() + customExpirationDays);
    const customExpirationDateString = customExpirationDate.toISOString();

    // Create prepayment invoice WITH a custom expiration date
    const prepaymentAmount = 12500; // $125.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount,
      customExpirationDateString // Specify custom expiration date
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Verify the transaction has an expiration date
    expect(creditTransaction).toBeTruthy();
    expect(creditTransaction.expiration_date).toBeTruthy();
    
    // Convert both dates to date-only strings for comparison (ignoring time)
    const actualExpirationDate = new Date(creditTransaction.expiration_date);
    const actualDateString = actualExpirationDate.toISOString().split('T')[0];
    const expectedDateString = customExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date matches the custom date, not client or default settings
    expect(actualDateString).toBe(expectedDateString);
    
    // Calculate client settings expiration date for comparison
    const clientExpirationDate = new Date(today);
    clientExpirationDate.setDate(today.getDate() + clientExpirationDays);
    const clientExpirationDateString = clientExpirationDate.toISOString().split('T')[0];
    
    // Calculate default settings expiration date for comparison
    const defaultExpirationDate = new Date(today);
    defaultExpirationDate.setDate(today.getDate() + defaultExpirationDays);
    const defaultExpirationDateString = defaultExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date does NOT match client or default settings
    expect(actualDateString).not.toBe(clientExpirationDateString);
    expect(actualDateString).not.toBe(defaultExpirationDateString);
    
    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify credit tracking entry has the same custom expiration date
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(customExpirationDateString));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
  });
});
