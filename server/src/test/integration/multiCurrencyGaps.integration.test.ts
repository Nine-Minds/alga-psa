/**
 * Multi-Currency Gap Tests
 *
 * These tests expose bugs and gaps in the multi-currency implementation
 * by testing actual action functions and verifying their behavior.
 *
 * CRITICAL:
 * - ITransaction missing currency_code field
 * - ICreditTracking missing currency_code field
 *
 * HIGH:
 * - Credit application doesn't validate currency match
 * - Credit listing can't filter by currency
 *
 * MEDIUM:
 * - No pre-flight validation for mixed-currency contracts
 */

import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { setupCommonMocks } from '../../../test-utils/testMocks';

let db: Knex;
let tenantId: string;

// Dynamic imports for actions that need tenant context
let createClientContractFromWizard: typeof import('server/src/lib/actions/contractWizardActions').createClientContractFromWizard;
let createPrepaymentInvoice: typeof import('server/src/lib/actions/creditActions').createPrepaymentInvoice;
let applyCreditToInvoice: typeof import('server/src/lib/actions/creditActions').applyCreditToInvoice;
let listClientCredits: typeof import('server/src/lib/actions/creditActions').listClientCredits;
let getCreditHistory: typeof import('server/src/lib/actions/creditActions').getCreditHistory;

type CreatedIds = {
  serviceTypeId?: string;
  serviceId?: string;
  contractIds: string[];
  contractLineIds: string[];
  clientIds: string[];
  invoiceIds: string[];
  transactionIds: string[];
  creditIds: string[];
};

let createdIds: CreatedIds = {
  contractIds: [],
  contractLineIds: [],
  clientIds: [],
  invoiceIds: [],
  transactionIds: [],
  creditIds: [],
};

vi.mock('server/src/lib/db', async () => {
  const actual = await vi.importActual<typeof import('server/src/lib/db')>('server/src/lib/db');
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
    getCurrentTenantId: vi.fn(async () => tenantId ?? null),
    runWithTenant: vi.fn(async (_tenant: string, fn: () => Promise<any>) => fn())
  };
});

vi.mock('server/src/lib/tenant', () => ({
  getTenantForCurrentRequest: vi.fn(async () => tenantId ?? null),
  getTenantFromHeaders: vi.fn(() => tenantId ?? null)
}));

describe('Multi-Currency Gap Tests', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_USER_ADMIN = process.env.DB_USER_ADMIN || 'postgres';
    process.env.DB_NAME_SERVER = process.env.DB_NAME_SERVER || 'sebastian_test';
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    process.env.DB_PASSWORD_ADMIN = process.env.DB_PASSWORD_ADMIN || 'postpass123';
    process.env.DB_USER_SERVER = process.env.DB_USER_SERVER || 'app_user';
    process.env.DB_PASSWORD_SERVER = process.env.DB_PASSWORD_SERVER || 'postpass123';
    process.env.E2E_AUTH_BYPASS = 'true';

    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
    setupCommonMocks({ tenantId, permissionCheck: () => true });

    // Import actions after mocks are set up
    ({ createClientContractFromWizard } = await import('server/src/lib/actions/contractWizardActions'));
    ({ createPrepaymentInvoice, applyCreditToInvoice, listClientCredits, getCreditHistory } = await import('server/src/lib/actions/creditActions'));
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  afterEach(async () => {
    if (db && tenantId) {
      await cleanupCreatedRecords(db, tenantId, createdIds);
    }
    createdIds = {
      contractIds: [],
      contractLineIds: [],
      clientIds: [],
      invoiceIds: [],
      transactionIds: [],
      creditIds: [],
    };
  });

  // =============================================================================
  // CRITICAL: createPrepaymentInvoice should record currency on transactions
  // =============================================================================
  describe('CRITICAL: Prepayment credits should track currency', () => {
    it('createPrepaymentInvoice should record currency on the credit transaction', async () => {
      // Setup: Create a client with EUR as default currency
      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'EUR Prepayment Client',
        default_currency_code: 'EUR',
        credit_balance: 0,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.clientIds.push(clientId);

      // Action: Create a prepayment invoice (which creates credit)
      const prepaymentInvoice = await createPrepaymentInvoice(clientId, 10000); // 100.00 EUR
      createdIds.invoiceIds.push(prepaymentInvoice.invoice_id);

      // Verify: The transaction should have currency_code = 'EUR'
      const transaction = await db('transactions')
        .where({
          client_id: clientId,
          tenant: tenantId,
          type: 'credit_issuance'
        })
        .first();

      createdIds.transactionIds.push(transaction.transaction_id);

      // GAP EXPOSED: Transaction doesn't have currency_code field
      // Once fixed, this should be 'EUR' (inherited from client or invoice)
      expect(transaction.currency_code).toBe('EUR');
    });

    it('createPrepaymentInvoice should record currency on the credit_tracking entry', async () => {
      // Setup: Create a client with GBP as default currency
      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'GBP Prepayment Client',
        default_currency_code: 'GBP',
        credit_balance: 0,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.clientIds.push(clientId);

      // Action: Create prepayment
      const prepaymentInvoice = await createPrepaymentInvoice(clientId, 5000); // 50.00 GBP
      createdIds.invoiceIds.push(prepaymentInvoice.invoice_id);

      // Verify: The credit tracking entry should have currency_code = 'GBP'
      const creditEntry = await db('credit_tracking')
        .where({ client_id: clientId, tenant: tenantId })
        .first();

      if (creditEntry) {
        createdIds.creditIds.push(creditEntry.credit_id);
      }

      // GAP EXPOSED: credit_tracking doesn't have currency_code field
      expect(creditEntry.currency_code).toBe('GBP');
    });
  });

  // =============================================================================
  // CRITICAL: applyCreditToInvoice should validate currency match
  // =============================================================================
  describe('CRITICAL: Credit application should validate currency', () => {
    it('applyCreditToInvoice should reject applying USD credit to EUR invoice', async () => {
      // Setup: Create client with USD credit
      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'Cross-Currency Credit Client',
        default_currency_code: 'USD',
        credit_balance: 10000, // $100 USD credit
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.clientIds.push(clientId);

      // Create USD credit via prepayment
      const usdPrepayment = await createPrepaymentInvoice(clientId, 10000);
      createdIds.invoiceIds.push(usdPrepayment.invoice_id);

      // Create an EUR invoice (different currency!)
      const eurInvoiceId = uuidv4();
      await db('invoices').insert({
        invoice_id: eurInvoiceId,
        tenant: tenantId,
        client_id: clientId,
        invoice_number: `INV-EUR-${Date.now()}`,
        invoice_date: new Date().toISOString(),
        due_date: new Date().toISOString(),
        subtotal: 5000,
        tax: 0,
        total_amount: 5000,
        status: 'sent',
        currency_code: 'EUR', // EUR invoice!
        credit_applied: 0,
      });
      createdIds.invoiceIds.push(eurInvoiceId);

      // Action: Try to apply USD credit to EUR invoice
      // GAP EXPOSED: This should throw an error but currently succeeds
      let error: Error | null = null;
      try {
        await applyCreditToInvoice(clientId, eurInvoiceId, 5000);
      } catch (e) {
        error = e as Error;
      }

      // Expected: Should reject with currency mismatch error
      expect(error).not.toBeNull();
      expect(error?.message).toContain('currencies');
    });
  });

  // =============================================================================
  // HIGH: listClientCredits should support currency filtering
  // =============================================================================
  describe('HIGH: Credit listing should support currency filtering', () => {
    it('listClientCredits should be able to filter credits by currency', async () => {
      // Setup: Create client with credits in multiple currencies
      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'Multi-Currency Credits Client',
        default_currency_code: 'USD',
        credit_balance: 0,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.clientIds.push(clientId);

      // Create USD credit
      await db('clients').where({ client_id: clientId, tenant: tenantId })
        .update({ default_currency_code: 'USD' });
      const usdPrepayment = await createPrepaymentInvoice(clientId, 10000);
      createdIds.invoiceIds.push(usdPrepayment.invoice_id);

      // Update client to EUR and create EUR credit
      await db('clients').where({ client_id: clientId, tenant: tenantId })
        .update({ default_currency_code: 'EUR', credit_balance: 10000 });
      const eurPrepayment = await createPrepaymentInvoice(clientId, 5000);
      createdIds.invoiceIds.push(eurPrepayment.invoice_id);

      // Action: List credits - we need to be able to see them grouped by currency
      const allCredits = await listClientCredits(clientId, false, 1, 100);

      // Verify: Each credit should have currency_code so UI can display by currency
      // GAP EXPOSED: Credits don't have currency_code, can't display "USD: $100, EUR: €50"
      expect(allCredits.credits.length).toBeGreaterThanOrEqual(2);

      const currencies = allCredits.credits.map((c: any) => c.currency_code);
      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
    });
  });

  // =============================================================================
  // HIGH: getCreditHistory should support currency filtering
  // =============================================================================
  describe('HIGH: Credit history should support currency filtering', () => {
    it('getCreditHistory should return transactions with currency information', async () => {
      // Setup: Create client and some credit transactions
      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'Credit History Client',
        default_currency_code: 'EUR',
        credit_balance: 0,
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.clientIds.push(clientId);

      // Create EUR prepayment
      const prepayment = await createPrepaymentInvoice(clientId, 10000);
      createdIds.invoiceIds.push(prepayment.invoice_id);

      // Action: Get credit history
      const history = await getCreditHistory(clientId);

      // Verify: Each transaction in history should have currency_code
      // GAP EXPOSED: Transactions don't have currency, can't generate currency-specific statements
      expect(history.length).toBeGreaterThan(0);

      for (const tx of history) {
        expect(tx.currency_code).toBeDefined();
        expect(tx.currency_code).toBe('EUR');
      }
    });
  });

  // =============================================================================
  // MEDIUM: Mixed-currency contracts should have pre-flight validation
  // =============================================================================
  describe('MEDIUM: Mixed-currency contract creation', () => {
    it('should warn when creating contract in different currency than existing active contract', async () => {
      // Setup: Create service
      const { serviceTypeId, serviceId } = await createTestService(db, tenantId);
      createdIds.serviceTypeId = serviceTypeId;
      createdIds.serviceId = serviceId;

      // Create client
      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'Multi-Contract Client',
        default_currency_code: 'USD',
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.clientIds.push(clientId);

      // Create first contract in USD
      const usdContract = await createClientContractFromWizard({
        contract_name: 'USD Contract',
        client_id: clientId,
        start_date: new Date().toISOString().split('T')[0],
        billing_frequency: 'monthly',
        currency_code: 'USD',
        fixed_services: [{ service_id: serviceId, quantity: 1 }],
        hourly_services: [],
        usage_services: [],
        fixed_base_rate: 10000,
        enable_proration: true
      });
      createdIds.contractIds.push(usdContract.contract_id);
      if (usdContract.contract_line_ids) {
        createdIds.contractLineIds.push(...usdContract.contract_line_ids);
      }

      // Action: Create second contract in EUR - should warn or error
      // GAP: Currently succeeds silently, will cause billing engine error later
      let warningOrError: Error | null = null;
      try {
        const eurContract = await createClientContractFromWizard({
          contract_name: 'EUR Contract',
          client_id: clientId,
          start_date: new Date().toISOString().split('T')[0],
          billing_frequency: 'monthly',
          currency_code: 'EUR',
          fixed_services: [{ service_id: serviceId, quantity: 1 }],
          hourly_services: [],
          usage_services: [],
          fixed_base_rate: 9000,
          enable_proration: true
        });
        createdIds.contractIds.push(eurContract.contract_id);
        if (eurContract.contract_line_ids) {
          createdIds.contractLineIds.push(...eurContract.contract_line_ids);
        }
      } catch (e) {
        warningOrError = e as Error;
      }

      // Expected: Should warn or error about mixed currencies
      // Currently: Silently creates, will fail at billing time
      expect(warningOrError).not.toBeNull();
      expect(warningOrError?.message).toContain('currency');
    });
  });

  // =============================================================================
  // Verification tests (these SHOULD pass - documenting working functionality)
  // =============================================================================
  describe('VERIFIED: Working currency functionality', () => {
    it('billing engine correctly retrieves contract currency via join', async () => {
      // Setup
      const { serviceTypeId, serviceId } = await createTestService(db, tenantId);
      createdIds.serviceTypeId = serviceTypeId;
      createdIds.serviceId = serviceId;

      const clientId = uuidv4();
      await db('clients').insert({
        client_id: clientId,
        tenant: tenantId,
        client_name: 'Billing Engine Test Client',
        default_currency_code: 'EUR',
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      });
      createdIds.clientIds.push(clientId);

      // Create JPY contract
      const contract = await createClientContractFromWizard({
        contract_name: 'JPY Contract',
        client_id: clientId,
        start_date: new Date().toISOString().split('T')[0],
        billing_frequency: 'monthly',
        currency_code: 'JPY',
        fixed_services: [{ service_id: serviceId, quantity: 1 }],
        hourly_services: [],
        usage_services: [],
        fixed_base_rate: 100000,
        enable_proration: false
      });
      createdIds.contractIds.push(contract.contract_id);
      if (contract.contract_line_ids) {
        createdIds.contractLineIds.push(...contract.contract_line_ids);
      }

      // Verify: Query the way billing engine does
      const lines = await db('client_contract_lines as ccl')
        .leftJoin('client_contracts as cc', function() {
          this.on('ccl.client_contract_id', '=', 'cc.client_contract_id')
            .andOn('cc.tenant', '=', 'ccl.tenant');
        })
        .leftJoin('contracts as c', function() {
          this.on('c.contract_id', '=', db.raw('coalesce(cc.template_contract_id, cc.contract_id)'))
            .andOn('c.tenant', '=', 'cc.tenant');
        })
        .where({ 'ccl.client_id': clientId, 'ccl.tenant': tenantId })
        .select('c.currency_code');

      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0].currency_code).toBe('JPY');
    });

    it('clients.default_currency_code has NOT NULL constraint', async () => {
      // Attempt to create client without currency - should fail
      const clientId = uuidv4();
      let error: Error | null = null;

      try {
        await db('clients').insert({
          client_id: clientId,
          tenant: tenantId,
          client_name: 'No Currency Client',
          default_currency_code: null,
          credit_balance: 0,
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        });
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toContain('not-null');
    });
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

async function ensureTenant(connection: Knex): Promise<string> {
  const existing = await connection('tenants').first<{ tenant: string }>('tenant');
  if (existing?.tenant) {
    return existing.tenant;
  }

  const newTenantId = uuidv4();
  await connection('tenants').insert({
    tenant: newTenantId,
    client_name: 'Multi-Currency Gap Test Tenant',
    email: 'multi-currency-gap-test@test.co',
    created_at: connection.fn.now(),
    updated_at: connection.fn.now()
  });
  return newTenantId;
}

async function createTestService(db: Knex, tenantId: string): Promise<{ serviceTypeId: string; serviceId: string }> {
  const serviceTypeId = uuidv4();
  const serviceTypeName = `Service Type ${serviceTypeId.slice(0, 8)}`;
  await db('service_types').insert({
    id: serviceTypeId,
    tenant: tenantId,
    name: serviceTypeName,
    billing_method: 'fixed',
    order_number: Math.floor(Math.random() * 1000000),
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });

  const serviceId = uuidv4();
  await db('service_catalog').insert({
    tenant: tenantId,
    service_id: serviceId,
    service_name: `Test Service ${serviceId.slice(0, 8)}`,
    description: 'Test service for multi-currency gap tests',
    default_rate: 1000,
    unit_of_measure: 'month',
    billing_method: 'fixed',
    custom_service_type_id: serviceTypeId,
    tax_rate_id: null,
    category_id: null
  });

  return { serviceTypeId, serviceId };
}

async function cleanupCreatedRecords(db: Knex, tenantId: string, ids: CreatedIds) {
  const safeDelete = async (table: string, where: Record<string, unknown>) => {
    try {
      await db(table).where(where).del();
    } catch {
      // ignore cleanup issues
    }
  };

  const safeDeleteIn = async (table: string, column: string, values: string[]) => {
    if (!values || values.length === 0) return;
    try {
      await db(table).whereIn(column, values).andWhere({ tenant: tenantId }).del();
    } catch {
      // ignore cleanup issues
    }
  };

  // Delete in reverse dependency order
  await safeDeleteIn('credit_allocations', 'transaction_id', ids.transactionIds);
  await safeDeleteIn('credit_tracking', 'credit_id', ids.creditIds);
  await safeDeleteIn('transactions', 'transaction_id', ids.transactionIds);

  // Also clean up any transactions we didn't explicitly track
  for (const clientId of ids.clientIds) {
    await safeDelete('credit_allocations', { tenant: tenantId });
    await safeDelete('credit_tracking', { client_id: clientId, tenant: tenantId });
    await safeDelete('transactions', { client_id: clientId, tenant: tenantId });
  }

  await safeDeleteIn('invoice_charges', 'invoice_id', ids.invoiceIds);
  await safeDeleteIn('invoices', 'invoice_id', ids.invoiceIds);

  await safeDeleteIn('contract_line_service_bucket_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_usage_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_rate_tiers', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_hourly_configs', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_hourly_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_fixed_config', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_service_configuration', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_line_services', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('client_contract_lines', 'contract_line_id', ids.contractLineIds);
  await safeDeleteIn('contract_lines', 'contract_line_id', ids.contractLineIds);

  for (const contractId of ids.contractIds) {
    await safeDelete('client_contracts', { tenant: tenantId, contract_id: contractId });
    await safeDelete('contracts', { tenant: tenantId, contract_id: contractId });
  }

  for (const clientId of ids.clientIds) {
    await safeDelete('clients', { tenant: tenantId, client_id: clientId });
  }

  if (ids.serviceId) {
    await safeDelete('service_catalog', { tenant: tenantId, service_id: ids.serviceId });
  }
  if (ids.serviceTypeId) {
    await safeDelete('service_types', { tenant: tenantId, id: ids.serviceTypeId });
  }
}
