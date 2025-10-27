import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createPrepaymentInvoice } from '@product/actions/creditActions';
import { finalizeInvoice } from '@product/actions/invoiceModification';
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

vi.mock('@alga-psa/shared/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/shared/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('@shared/db', () => ({
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
}));

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

vi.mock('@product/actions/user-actions/userActions', () => ({
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
 * Core tests for credit expiration functionality.
 * 
 * These tests focus on the fundamental behavior of the credit expiration system:
 * - Detecting and marking expired credits
 * - Creating expiration transactions
 * - Handling expiration dates correctly
 * - Preventing duplicate expirations
 */

describe('Credit Expiration Core Tests', () => {
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
    await ensureDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should verify that expired credits are properly marked as expired', async () => {
    const client_id = context.clientId;

    // Set up client billing settings with expiration days
    await context.db('client_billing_settings')
      .insert({
        client_id: client_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['client_id', 'tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        updated_at: new Date().toISOString()
      });

    // Create prepayment invoice with expiration date in the past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10); // 10 days ago
    const expirationDate = pastDate.toISOString();
    
    const prepaymentAmount = 8000; // $80.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount,
      expirationDate
    );
    
    // Finalize the prepayment invoice to create the credit
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Get the initial credit tracking entry
    const initialCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify initial state - credit should not be expired yet
    expect(initialCreditTracking).toBeTruthy();
    expect(initialCreditTracking.is_expired).toBe(false);
    expect(Number(initialCreditTracking.remaining_amount)).toBe(prepaymentAmount);
    expect(toPlainDate(initialCreditTracking.expiration_date)).toEqual(toPlainDate(expirationDate));
    
    // Run the expired credits handler to process expired credits
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Get the updated credit tracking entry
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify the credit is now properly marked as expired
    expect(updatedCreditTracking).toBeTruthy();
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
    
    // Verify the expiration transaction was created
    const expirationTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    expect(Number(expirationTransaction.amount)).toBe(-prepaymentAmount);
    
    // Verify the client credit balance was updated
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(0);
  });

  it('should mark expired credits as expired and create expiration transactions', async () => {
    const client_id = context.clientId;

    // Set up client billing settings with expiration days and explicitly enable credit expiration
    await context.db('client_billing_settings')
      .insert({
        client_id: client_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['client_id', 'tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
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

    // Step 1: Create prepayment invoice with manual expiration date in the past
    const prepaymentAmount = 10000; // $100.00 credit
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expirationDate = pastDate.toISOString();
    
    console.log('Test: Creating prepayment invoice with expiration date:', expirationDate);
    
    const prepaymentInvoice = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount,
      expirationDate
    );
    
    console.log('Test: Prepayment invoice created:', prepaymentInvoice.invoice_id);
    
    // Step 2: Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    console.log('Test: Prepayment invoice finalized');
    
    // Step 3: Verify initial credit balance and credit tracking entry
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(prepaymentAmount);
    console.log('Test: Initial credit balance verified:', initialCredit);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    console.log('Test: Credit transaction found:', creditTransaction?.transaction_id);
    console.log('Test: Credit transaction expiration_date:', creditTransaction?.expiration_date);
    console.log('Test: Expected expiration_date:', expirationDate);
    
    // Log all columns in the transaction
    console.log('Test: All transaction columns:', Object.keys(creditTransaction || {}));
    
    // Check if the transactions table has the expiration_date column
    const hasColumn = await context.db.schema.hasColumn('transactions', 'expiration_date');
    console.log('Test: transactions table has expiration_date column:', hasColumn);
    
    // Log the SQL query that would be executed
    const query = context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .toSQL();
    console.log('Test: SQL query:', query.sql, query.bindings);
    
    expect(creditTransaction).toBeTruthy();
    expect(toPlainDate(creditTransaction.expiration_date)).toEqual(toPlainDate(expirationDate)); 
    
    // Get the credit tracking entry
    const creditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(creditTracking).toBeTruthy();
    expect(toPlainDate(creditTracking.expiration_date)).toEqual(toPlainDate(expirationDate));
    expect(creditTracking.is_expired).toBe(false);
    expect(Number(creditTracking.remaining_amount)).toBe(prepaymentAmount);
    
    // Step 4: Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 5: Verify credit is now marked as expired
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking).toBeTruthy();
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
    
    // Step 6: Verify expiration transaction was created
    const expirationTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    expect(Number(expirationTransaction.amount)).toBe(-prepaymentAmount);
    expect(expirationTransaction.description).toContain('Credit expired');
    
    // Step 7: Verify client credit balance was updated
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(0);
  });

  it('should only expire credits that have passed their expiration date', async () => {
    const client_id = context.clientId;

    // Set up client billing settings with expiration days and explicitly enable credit expiration
    await context.db('client_billing_settings')
      .insert({
        client_id: client_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['client_id', 'tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        updated_at: new Date().toISOString()
      });

    // Step 1: Create first prepayment invoice with expiration date in the past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const pastExpirationDate = pastDate.toISOString();
    
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      client_id, 
      5000, // $50.00 credit
      pastExpirationDate
    );
    
    // Step 2: Create second prepayment invoice with expiration date in the future
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in the future
    const futureExpirationDate = futureDate.toISOString();
    
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      client_id, 
      7000, // $70.00 credit
      futureExpirationDate
    );
    
    // Step 3: Finalize both prepayment invoices
    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    
    // Step 4: Verify initial credit balance
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(12000); // $120.00 total credit
    
    // Get the credit transactions
    const creditTransaction1 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice1.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const creditTransaction2 = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice2.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 5: Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 6: Verify only the expired credit is marked as expired
    const updatedCreditTracking1 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const updatedCreditTracking2 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // First credit should be expired
    expect(updatedCreditTracking1.is_expired).toBe(true);
    expect(Number(updatedCreditTracking1.remaining_amount)).toBe(0);
    
    // Second credit should still be active
    expect(updatedCreditTracking2.is_expired).toBe(false);
    expect(Number(updatedCreditTracking2.remaining_amount)).toBe(7000);
    
    // Step 7: Verify expiration transaction was created only for the expired credit
    const expirationTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    expect(Number(expirationTransaction.amount)).toBe(-5000);
    
    // No expiration transaction should exist for the non-expired credit
    const nonExpirationTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(nonExpirationTransaction).toBeUndefined();
    
    // Step 8: Verify client credit balance was updated correctly
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(7000); // Only the non-expired credit remains
  });

  it('should not re-expire already expired credits', async () => {
    const client_id = context.clientId;

    // Set up client billing settings with expiration days and explicitly enable credit expiration
    await context.db('client_billing_settings')
      .insert({
        client_id: client_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['client_id', 'tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        updated_at: new Date().toISOString()
      });

    // Step 1: Create prepayment invoice with expiration date in the past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expirationDate = pastDate.toISOString();
    
    const prepaymentInvoice = await createPrepaymentInvoice(
      client_id, 
      10000, // $100.00 credit
      expirationDate
    );
    
    // Step 2: Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Step 3: Run the expired credits handler first time
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 4: Verify credit is marked as expired and transaction created
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking.is_expired).toBe(true);
    
    const expirationTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    
    // Step 5: Run the expired credits handler again
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Step 6: Verify no additional expiration transactions were created
    const expirationTransactions = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .count('* as count');
    
    expect(parseInt(expirationTransactions[0].count.toString(), 10)).toBe(1); // Still only one expiration transaction
  });
});
