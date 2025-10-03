import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import '../../../../../test-utils/nextApiMock';
import { TestContext } from '../../../../../test-utils/testContext';
import { setupCompanyTaxConfiguration, assignServiceTaxRate } from '../../../../../test-utils/billingTestHelpers';
import { setupCommonMocks } from '../../../../../test-utils/testMocks';
import { createPrepaymentInvoice } from 'server/src/lib/actions/creditActions';
import { finalizeInvoice } from 'server/src/lib/actions/invoiceModification';
import { v4 as uuidv4 } from 'uuid';
import type { ICompany } from '../../interfaces/company.interfaces';
import { Temporal } from '@js-temporal/polyfill';
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
 * - Using company-specific settings to determine expiration dates
 * - Falling back to default settings when company settings are not available
 * - Supporting custom expiration dates specified during credit creation
 */

describe('Credit Creation and Dates Tests', () => {
  let context: TestContext;

  async function ensureDefaultTax() {
    await setupCompanyTaxConfiguration(context, {
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
        'company_billing_cycles',
        'company_billing_plans',
        'plan_service_configuration',
        'plan_service_fixed_config',
        'service_catalog',
        'billing_plan_fixed_config',
        'billing_plans',
        'bucket_plans',
        'bucket_usage',
        'tax_rates',
        'tax_regions',
        'company_tax_settings',
        'company_tax_rates',
        'company_billing_settings',
        'default_billing_settings'
      ],
      companyName: 'Credit Expiration Test Company',
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

  it('should create credits with expiration dates based on company settings', async () => {
    const company_id = context.companyId;

    // Set up company billing settings with specific expiration days and explicitly enable credit expiration
    const expirationDays = 45; // 45-day expiration period
    await context.db('company_billing_settings')
      .insert({
        company_id: company_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: expirationDays,
        credit_expiration_notification_days: [14, 7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['company_id', 'tenant'])
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
    // This should use the company settings to determine the expiration date
    const prepaymentAmount = 15000; // $150.00 credit
    const prepaymentInvoice = await createPrepaymentInvoice(
      company_id,
      prepaymentAmount
      // No expiration date provided - should use company settings
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
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
    
    // Verify the expiration date matches company settings
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

  it('should create credits with expiration dates based on default settings when company settings are not available', async () => {
    const company_id = context.companyId;

    // Ensure no company-specific billing settings exist
    await context.db('company_billing_settings')
      .where({ company_id, tenant: context.tenantId })
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
      company_id,
      prepaymentAmount
      // No expiration date provided - should use default settings
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
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
    const company_id = context.companyId;

    // Set up company billing settings with expiration days
    const companyExpirationDays = 30; // 30-day company expiration period
    await context.db('company_billing_settings')
      .insert({
        company_id: company_id,
        tenant: context.tenantId,
        zero_dollar_invoice_handling: 'normal',
        suppress_zero_dollar_invoices: false,
        enable_credit_expiration: true,
        credit_expiration_days: companyExpirationDays,
        credit_expiration_notification_days: [7, 1],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .onConflict(['company_id', 'tenant'])
      .merge({
        enable_credit_expiration: true,
        credit_expiration_days: companyExpirationDays,
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
      company_id,
      prepaymentAmount,
      customExpirationDateString // Specify custom expiration date
    );
    
    // Finalize the prepayment invoice
    await finalizeInvoice(prepaymentInvoice.invoice_id);
    
    // Get the credit transaction
    const creditTransaction = await context.db('transactions')
      .where({
        company_id: company_id,
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
    
    // Verify the expiration date matches the custom date, not company or default settings
    expect(actualDateString).toBe(expectedDateString);
    
    // Calculate company settings expiration date for comparison
    const companyExpirationDate = new Date(today);
    companyExpirationDate.setDate(today.getDate() + companyExpirationDays);
    const companyExpirationDateString = companyExpirationDate.toISOString().split('T')[0];
    
    // Calculate default settings expiration date for comparison
    const defaultExpirationDate = new Date(today);
    defaultExpirationDate.setDate(today.getDate() + defaultExpirationDays);
    const defaultExpirationDateString = defaultExpirationDate.toISOString().split('T')[0];
    
    // Verify the expiration date does NOT match company or default settings
    expect(actualDateString).not.toBe(companyExpirationDateString);
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
