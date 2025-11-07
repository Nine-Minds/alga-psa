import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../../test-utils/testMocks';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

import { AccountingExportService } from 'server/src/lib/services/accountingExportService';
import { AccountingExportRepository } from 'server/src/lib/repositories/accountingExportRepository';
import { AccountingExportValidation } from 'server/src/lib/validation/accountingExportValidation';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 120_000;

describe('Accounting export validation – unmapped services', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'accounting_export_errors',
        'accounting_export_lines',
        'accounting_export_batches',
        'tenant_external_entity_mappings',
        'invoice_charges',
        'invoices',
        'service_catalog'
      ]
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    await ctx.db('accounting_export_errors').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_lines').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_batches').where({ tenant: ctx.tenantId }).del();
    await ctx.db('tenant_external_entity_mappings').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    await ctx.db('service_catalog').where({ tenant: ctx.tenantId }).del();
  }, HOOK_TIMEOUT);

afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function seedInvoice(options: { taxRegion?: string; invoiceNumber?: string } = {}) {
    const serviceId = await createTestService(ctx, {
      service_name: 'Managed Endpoint',
      billing_method: 'fixed',
      default_rate: 5000,
      unit_of_measure: 'device',
      description: 'Test service'
    });
    const invoiceId = uuidv4();
    const chargeId = uuidv4();

    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: 'INV-1001',
      invoice_date: new Date().toISOString(),
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      total_amount: 5000,
      currency_code: 'USD',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await ctx.db('invoice_charges').insert({
      item_id: chargeId,
      invoice_id: invoiceId,
      service_id: serviceId,
      tenant: ctx.tenantId,
      description: 'Endpoint management',
      quantity: 1,
      unit_price: 5000,
      net_amount: 5000,
      total_price: 5000,
      tax_amount: 0,
      tax_region: options.taxRegion ?? null,
      is_manual: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    return { serviceId, invoiceId, chargeId };
  }

  async function insertServiceMapping(serviceId: string) {
    await insertServiceMapping(serviceId);
  }

  async function stubValidationDependencies(): Promise<AccountingExportRepository> {
    const repoModule = await import('server/src/lib/repositories/accountingExportRepository');
    vi.spyOn(repoModule.AccountingExportRepository, 'create').mockResolvedValue({
      getBatch: async (id: string) =>
        ctx.db('accounting_export_batches')
          .where({ batch_id: id, tenant: ctx.tenantId })
          .first(),
      listLines: async (id: string) =>
        ctx.db('accounting_export_lines')
          .where({ batch_id: id, tenant: ctx.tenantId })
          .orderBy('created_at'),
      listErrors: async (id: string) =>
        ctx.db('accounting_export_errors')
          .where({ batch_id: id, tenant: ctx.tenantId })
          .orderBy('created_at'),
      addError: async (input: any) => {
        const record = {
          error_id: uuidv4(),
          tenant: ctx.tenantId,
          batch_id: input.batch_id,
          line_id: input.line_id ?? null,
          code: input.code,
          message: input.message,
          metadata: input.metadata ?? null,
          resolution_state: input.resolution_state ?? 'open',
          created_at: new Date().toISOString()
        };
        await ctx.db('accounting_export_errors').insert(record);
        return record;
      }
    } as unknown as AccountingExportRepository);

    const serviceModule = await import('server/src/lib/services/accountingExportService');
    vi.spyOn(serviceModule.AccountingExportService, 'create').mockResolvedValue({
      updateBatchStatus: async (id: string, updates: any) => {
        await ctx.db('accounting_export_batches')
          .where({ batch_id: id, tenant: ctx.tenantId })
          .update({ ...updates, updated_at: new Date().toISOString() });
      }
    } as unknown as AccountingExportService);

    return AccountingExportRepository.create();
  }

  it('marks batch as needs_attention when services lack mappings and clears once mapped', async () => {
    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'finance-admin-role',
          tenant: ctx.tenantId,
          role_name: 'Finance Admin',
          permissions: []
        }
      ]
    });
    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: financeUser.user_id,
      user: financeUser,
      permissionCheck: () => true
    });
    mockGetCurrentUser(financeUser);

    const { serviceId, invoiceId, chargeId } = await seedInvoice();
    const batchId = uuidv4();

    await ctx.db('accounting_export_batches').insert({
      batch_id: batchId,
      tenant: ctx.tenantId,
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      status: 'pending',
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await ctx.db('accounting_export_lines').insert({
      line_id: uuidv4(),
      batch_id: batchId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      invoice_charge_id: chargeId,
      client_id: ctx.clientId,
      amount_cents: 5000,
      currency_code: 'USD',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const repo = await stubValidationDependencies();

    await AccountingExportValidation.ensureMappingsForBatch(batchId);

    const errorsAfterValidation = await repo.listErrors(batchId);
    expect(errorsAfterValidation).toHaveLength(1);
    expect(errorsAfterValidation[0].code).toBe('missing_service_mapping');

    const batchAfterValidation = await repo.getBatch(batchId);
    expect(batchAfterValidation?.status).toBe('needs_attention');

    await insertServiceMapping(serviceId);

    await ctx.db('accounting_export_errors').where({ batch_id: batchId }).del();

    await AccountingExportValidation.ensureMappingsForBatch(batchId);

    const errorsAfterMapping = await repo.listErrors(batchId);
    expect(errorsAfterMapping).toHaveLength(0);

    const finalBatch = await repo.getBatch(batchId);
    expect(finalBatch?.status).toBe('ready');
  it('flags missing tax mappings for QuickBooks exports', async () => {
    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'finance-admin-role',
          tenant: ctx.tenantId,
          role_name: 'Finance Admin',
          permissions: []
        }
      ]
    });
    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: financeUser.user_id,
      user: financeUser,
      permissionCheck: () => true
    });
    mockGetCurrentUser(financeUser);

    const { serviceId, invoiceId, chargeId } = await seedInvoice({ taxRegion: 'CA' });
    await insertServiceMapping(serviceId);

    const batchId = uuidv4();
    await ctx.db('accounting_export_batches').insert({
      batch_id: batchId,
      tenant: ctx.tenantId,
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      status: 'pending',
      target_realm: 'realm-1',
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await ctx.db('accounting_export_lines').insert({
      line_id: uuidv4(),
      batch_id: batchId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      invoice_charge_id: chargeId,
      client_id: ctx.clientId,
      amount_cents: 5000,
      currency_code: 'USD',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const repo = await stubValidationDependencies();

    await AccountingExportValidation.ensureMappingsForBatch(batchId);

    const errorsAfterValidation = await repo.listErrors(batchId);
    expect(errorsAfterValidation.some((error) => error.code === 'missing_tax_mapping')).toBe(true);

    const batchAfterValidation = await repo.getBatch(batchId);
    expect(batchAfterValidation?.status).toBe('needs_attention');
  });

  it('flags missing payment term mappings for QuickBooks exports', async () => {
    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'finance-admin-role',
          tenant: ctx.tenantId,
          role_name: 'Finance Admin',
          permissions: []
        }
      ]
    });
    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: financeUser.user_id,
      user: financeUser,
      permissionCheck: () => true
    });
    mockGetCurrentUser(financeUser);

    await ctx.db('clients')
      .where({ client_id: ctx.clientId, tenant: ctx.tenantId })
      .update({ payment_terms: 'NET30' });

    const { serviceId, invoiceId, chargeId } = await seedInvoice();
    await insertServiceMapping(serviceId);

    const batchId = uuidv4();
    await ctx.db('accounting_export_batches').insert({
      batch_id: batchId,
      tenant: ctx.tenantId,
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      status: 'pending',
      target_realm: 'realm-1',
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await ctx.db('accounting_export_lines').insert({
      line_id: uuidv4(),
      batch_id: batchId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      invoice_charge_id: chargeId,
      client_id: ctx.clientId,
      amount_cents: 5000,
      currency_code: 'USD',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const repo = await stubValidationDependencies();

    await AccountingExportValidation.ensureMappingsForBatch(batchId);

    const errorsAfterValidation = await repo.listErrors(batchId);
    expect(errorsAfterValidation.some((error) => error.code === 'missing_payment_term_mapping')).toBe(true);

    const batchAfterValidation = await repo.getBatch(batchId);
    expect(batchAfterValidation?.status).toBe('needs_attention');
  });

  it('flags missing target realm for QuickBooks batches', async () => {
    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        {
          role_id: 'finance-admin-role',
          tenant: ctx.tenantId,
          role_name: 'Finance Admin',
          permissions: []
        }
      ]
    });
    setupCommonMocks({
      tenantId: ctx.tenantId,
      userId: financeUser.user_id,
      user: financeUser,
      permissionCheck: () => true
    });
    mockGetCurrentUser(financeUser);

    const { serviceId, invoiceId, chargeId } = await seedInvoice();
    await insertServiceMapping(serviceId);

    const batchId = uuidv4();
    await ctx.db('accounting_export_batches').insert({
      batch_id: batchId,
      tenant: ctx.tenantId,
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      status: 'pending',
      target_realm: null,
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await ctx.db('accounting_export_lines').insert({
      line_id: uuidv4(),
      batch_id: batchId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      invoice_charge_id: chargeId,
      client_id: ctx.clientId,
      amount_cents: 5000,
      currency_code: 'USD',
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const repo = await stubValidationDependencies();

    await AccountingExportValidation.ensureMappingsForBatch(batchId);

    const errorsAfterValidation = await repo.listErrors(batchId);
    expect(errorsAfterValidation.some((error) => error.code === 'missing_target_realm')).toBe(true);

    const batchAfterValidation = await repo.getBatch(batchId);
    expect(batchAfterValidation?.status).toBe('needs_attention');
  });

  });
});
