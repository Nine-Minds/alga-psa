import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { createPrepaymentInvoice, applyCreditToInvoice } from '@alga-psa/billing/actions/creditActions';
import { finalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { generateInvoice } from '@alga-psa/billing/actions/invoiceGeneration';
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate
} from '../../../../../test-utils/billingTestHelpers';
import { Temporal } from '@js-temporal/polyfill';
import ClientContractLine from 'server/src/lib/models/clientContractLine';
import { createTestDate, createTestDateISO } from '../../../test-utils/dateUtils';
import { expiredCreditsHandler } from 'server/src/lib/jobs/handlers/expiredCreditsHandler';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { createClient } from '../../../../../test-utils/testDataFactory';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';

let mockedTenantId = '11111111-1111-1111-1111-111111111111';
let mockedUserId = 'mock-user-id';

vi.mock('server/src/lib/analytics/posthog', () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null
  }
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: vi.fn(async (knex, callback) => callback(knex)),
    withAdminTransaction: vi.fn(async (callback, existingConnection) => callback(existingConnection as any))
  };
});

vi.mock('server/src/lib/auth/getSession', () => ({
  getSession: vi.fn(async () => ({
    user: {
      id: mockedUserId,
      tenant: mockedTenantId
    }
  }))
}));

vi.mock('server/src/lib/auth/rbac', () => ({
  hasPermission: vi.fn(() => Promise.resolve(true))
}));

const {
  beforeAll: setupContext,
  beforeEach: resetContext,
  afterEach: rollbackContext,
  afterAll: cleanupContext
} = TestContext.createHelpers();

/**
 * Tests for the effects of credit expiration on the system.
 *
 * These tests focus on the side effects and system-wide impacts of credit expiration:
 * - Client-specific credit expiration processing
 * - Ensuring expired credits have their remaining amount set to zero
 * - Verifying expiration transactions are created correctly
 * - Confirming client credit balances are properly reduced
 */

describe('Credit Expiration Effects Tests', () => {
  let context: TestContext;

  async function setupDefaultTax() {
    await setupClientTaxConfiguration(context, {
      regionCode: 'US-NY',
      regionName: 'New York',
      description: 'NY State Tax',
      startDate: '2020-01-01T00:00:00.000Z',
      taxPercentage: 8.875
    });
    await assignServiceTaxRate(context, '*', 'US-NY', { onlyUnset: true });
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        'invoice_charges',
        'invoices',
        'transactions',
        'credit_tracking',
        'credit_allocations',
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

    await setupDefaultTax();
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
    await setupDefaultTax();
  }, 30000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it('should process expired credits for a specific client when client ID is provided', async () => {
    // Create two test clients
    await context.db('tax_regions')
      .insert({
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      })
      .onConflict(['tenant', 'region_code'])
      .ignore();

    const client1_id = await createClient(context.db, context.tenantId, 'Client 1 Expiration Test', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    const client2_id = await createClient(context.db, context.tenantId, 'Client 2 Expiration Test', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupClientTaxConfiguration(context, {
      clientId: client1_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 8.875,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY State Tax'
    });

    await setupClientTaxConfiguration(context, {
      clientId: client2_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 8.875,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY State Tax'
    });

    // Set up client billing settings for both clients with credit expiration explicitly enabled
    await context.db('client_billing_settings').insert([
      {
        client_id: client1_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true, // Explicitly enable credit expiration
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        client_id: client2_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true, // Explicitly enable credit expiration
        credit_expiration_days: 30,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ]);

    // Create expired credits for both clients
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expirationDate = pastDate.toISOString();
    
    // Create and finalize prepayment invoices for both clients
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      client1_id, 
      5000, // $50.00 credit
      expirationDate
    );
    
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      client2_id, 
      7000, // $70.00 credit
      expirationDate
    );
    
    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    
    // Get the credit transactions
    const creditTransaction1 = await context.db('transactions')
      .where({
        client_id: client1_id,
        invoice_id: prepaymentInvoice1.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    const creditTransaction2 = await context.db('transactions')
      .where({
        client_id: client2_id,
        invoice_id: prepaymentInvoice2.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Run the expired credits handler for client1 only
    await expiredCreditsHandler({ 
      tenantId: context.tenantId,
      clientId: client1_id
    });
    
    // Verify client1's credit is expired
    const updatedCreditTracking1 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking1.is_expired).toBe(true);
    expect(Number(updatedCreditTracking1.remaining_amount)).toBe(0);
    
    // Verify client2's credit is still active
    const updatedCreditTracking2 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking2.is_expired).toBe(false);
    expect(Number(updatedCreditTracking2.remaining_amount)).toBe(7000);
    
    // Verify expiration transaction was created only for client1
    const expirationTransaction1 = await context.db('transactions')
      .where({
        client_id: client1_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction1).toBeTruthy();
    
    const expirationTransaction2 = await context.db('transactions')
      .where({
        client_id: client2_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction2).toBeUndefined();
    
    // Verify client credit balances
    const client1Credit = await ClientContractLine.getClientCredit(client1_id);
    const client2Credit = await ClientContractLine.getClientCredit(client2_id);
    
    expect(client1Credit).toBe(0); // Credit expired
    expect(client2Credit).toBe(7000); // Credit still active
  }, 120000);

  it('should test that expired credits have their remaining amount set to zero', async () => {
    // Create test client
    await context.db('tax_regions')
      .insert({
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      })
      .onConflict(['tenant', 'region_code'])
      .ignore();

    const client_id = await createClient(context.db, context.tenantId, 'Zero Remaining Amount Test Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 8.875,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY State Tax'
    });

    // Set up client billing settings with expiration days
    await context.db('client_billing_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Create multiple credits with different amounts and expiration dates
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 5); // 5 days ago
    const expiredDate = pastDate.toISOString();
    
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30); // 30 days in future
    const activeDate = futureDate.toISOString();
    
    // Create and finalize first prepayment invoice (will expire)
    const prepaymentAmount1 = 12500; // $125.00
    const prepaymentInvoice1 = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount1,
      expiredDate
    );
    await finalizeInvoice(prepaymentInvoice1.invoice_id);
    
    // Create and finalize second prepayment invoice (will remain active)
    const prepaymentAmount2 = 7500; // $75.00
    const prepaymentInvoice2 = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount2,
      activeDate
    );
    await finalizeInvoice(prepaymentInvoice2.invoice_id);
    
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
    
    // Get the initial credit tracking entries
    const initialCreditTracking1 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    const initialCreditTracking2 = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction2.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify initial state
    expect(initialCreditTracking1.is_expired).toBe(false);
    expect(Number(initialCreditTracking1.remaining_amount)).toBe(prepaymentAmount1);
    
    expect(initialCreditTracking2.is_expired).toBe(false);
    expect(Number(initialCreditTracking2.remaining_amount)).toBe(prepaymentAmount2);
    
    // Verify initial client credit balance
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(prepaymentAmount1 + prepaymentAmount2);
    
    // Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Get the updated credit tracking entries
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
    
    // Verify the expired credit has its remaining amount set to zero
    expect(updatedCreditTracking1.is_expired).toBe(true);
    expect(Number(updatedCreditTracking1.remaining_amount)).toBe(0);
    
    // Verify the active credit is unchanged
    expect(updatedCreditTracking2.is_expired).toBe(false);
    expect(Number(updatedCreditTracking2.remaining_amount)).toBe(prepaymentAmount2);
    
    // Verify the client credit balance was reduced by the expired credit amount
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(prepaymentAmount2);
    
    // Verify the expiration transaction was created with the correct amount
    const expirationTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction1.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(expirationTransaction).toBeTruthy();
    expect(Number(expirationTransaction.amount)).toBe(-prepaymentAmount1);
  }, 120000);

  it('should test that expiration transactions are created when credits expire', async () => {
    // Create test client
    await context.db('tax_regions')
      .insert({
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      })
      .onConflict(['tenant', 'region_code'])
      .ignore();

    const client_id = await createClient(context.db, context.tenantId, 'Expiration Transaction Test Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 8.875,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY State Tax'
    });

    // Set up client billing settings with expiration days
    await context.db('client_billing_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Create prepayment invoice with expiration date in the past
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 7); // 7 days ago
    const expirationDate = pastDate.toISOString();
    
    const prepaymentAmount = 12500; // $125.00 credit
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
    
    // Verify initial state
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(prepaymentAmount);
    
    // Run the expired credits handler to process expired credits
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Verify the expiration transaction was created
    const expirationTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        type: 'credit_expiration',
        related_transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    // Verify the expiration transaction exists
    expect(expirationTransaction).toBeTruthy();
    
    // Verify the transaction amount is negative and matches the credit amount
    expect(Number(expirationTransaction.amount)).toBe(-prepaymentAmount);
    
    // Verify the transaction is linked to the original credit transaction
    expect(expirationTransaction.related_transaction_id).toBe(creditTransaction.transaction_id);
    
    // Verify the transaction description indicates it's for credit expiration
    expect(expirationTransaction.description).toContain('Credit expired');
    
    // Verify the transaction has the correct client ID
    expect(expirationTransaction.client_id).toBe(client_id);
    
    // Verify the transaction has the correct type
    expect(expirationTransaction.type).toBe('credit_expiration');
    
    // Verify the transaction has a created_at timestamp
    expect(expirationTransaction.created_at).toBeTruthy();
    
    // Verify the client credit balance was updated
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(0);
    
    // Verify the credit tracking entry is marked as expired
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
  }, 120000);

  it('should validate that client credit balance is reduced when credits expire', async () => {
    // Create test client
    await context.db('tax_regions')
      .insert({
        tenant: context.tenantId,
        region_code: 'US-NY',
        region_name: 'New York',
        is_active: true
      })
      .onConflict(['tenant', 'region_code'])
      .ignore();

    const client_id = await createClient(context.db, context.tenantId, 'Credit Balance Reduction Test Client', {
      billing_cycle: 'monthly',
      region_code: 'US-NY',
      is_tax_exempt: false,
      credit_balance: 0
    });

    await setupClientTaxConfiguration(context, {
      clientId: client_id,
      regionCode: 'US-NY',
      regionName: 'New York',
      taxPercentage: 8.875,
      startDate: '2020-01-01T00:00:00.000Z',
      description: 'NY State Tax'
    });

    // Set up client billing settings with expiration days
    await context.db('client_billing_settings').insert({
      client_id: client_id,
      tenant: context.tenantId,
      zero_dollar_invoice_handling: 'normal',
      suppress_zero_dollar_invoices: false,
      enable_credit_expiration: true,
      credit_expiration_days: 30,
      credit_expiration_notification_days: [7, 1],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // Create credits with different expiration dates
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10); // 10 days ago
    const expiredDate = pastDate.toISOString();
    
    // Create and finalize prepayment invoice with expired date
    const prepaymentAmount = 15000; // $150.00
    const prepaymentInvoice = await createPrepaymentInvoice(
      client_id,
      prepaymentAmount,
      expiredDate
    );
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Verify initial credit balance
    const initialCredit = await ClientContractLine.getClientCredit(client_id);
    expect(initialCredit).toBe(prepaymentAmount);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        client_id: client_id,
        invoice_id: prepaymentInvoice.invoice_id,
        type: 'credit_issuance'
      })
      .first();
    
    // Run the expired credits handler
    await expiredCreditsHandler({ tenantId: context.tenantId });
    
    // Verify client credit balance is reduced to zero
    const finalCredit = await ClientContractLine.getClientCredit(client_id);
    expect(finalCredit).toBe(0);
    
    // Verify the expiration transaction was created with the correct amount
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
    
    // Verify the credit tracking entry is marked as expired
    const updatedCreditTracking = await context.db('credit_tracking')
      .where({
        transaction_id: creditTransaction.transaction_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(updatedCreditTracking.is_expired).toBe(true);
    expect(Number(updatedCreditTracking.remaining_amount)).toBe(0);
    
    // Verify the client record has been updated with the reduced credit balance
    const updatedClient = await context.db('clients')
      .where({
        client_id: client_id,
        tenant: context.tenantId
      })
      .first();
    
    expect(Number(updatedClient.credit_balance)).toBe(0);
  }, 120000);
});
