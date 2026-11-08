import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

const xeroCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XeroClientService: {
    create: xeroCreateMock
  }
}));

import { AppError } from '@alga-psa/core';
import {
  AccountingAdapterRegistry,
  AccountingExportRepository,
  AccountingExportService,
  XeroAdapter
} from '@alga-psa/billing/services';

import { TestContext } from '../../../../test-utils/testContext';
import {
  createMockUser,
  mockGetCurrentUser,
  setupCommonMocks
} from '../../../../test-utils/testMocks';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

// Xero batches carry an immutable target realm stamped at creation (production
// derives it from the tenant's stored default connection); the adapter refuses
// realm-less batches outright, so every delivery-path test seeds one.
const DEFAULT_TARGET_REALM = 'xero-tenant-default';

describe('Live Xero export integration', () => {
  let ctx: TestContext;
  let repository: AccountingExportRepository;
  let service: AccountingExportService;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'accounting_export_errors',
        'accounting_export_lines',
        'accounting_export_batches',
        'tenant_external_entity_mappings',
        'invoice_charges',
        'invoices',
        'service_catalog',
        // Billing profiles reference clients (NO ACTION); the app layer
        // provisions one per client created through it, so clear them first.
        'client_billing_profiles',
        'clients'
      ]
    });
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    vi.clearAllMocks();

    await ctx.db('accounting_export_errors').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_lines').where({ tenant: ctx.tenantId }).del();
    await ctx.db('accounting_export_batches').where({ tenant: ctx.tenantId }).del();
    await ctx.db('tenant_external_entity_mappings').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    await ctx.db('service_catalog').where({ tenant: ctx.tenantId }).del();
    await ctx.db('client_billing_profiles').where({ tenant: ctx.tenantId }).del();
    await ctx.db('clients').where({ tenant: ctx.tenantId }).del();

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

    const publishModule = await import('server/src/lib/eventBus/publishers');
    vi.spyOn(publishModule, 'publishEvent').mockResolvedValue();

    const dbModule = await import('server/src/lib/db');
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });
    // The billing-package repositories resolve tenant via @alga-psa/db, not
    // the legacy server/src/lib/db module; pin both to the test context.
    const algaDbModule = await import('@alga-psa/db');
    vi.spyOn(algaDbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });

    repository = new AccountingExportRepository(ctx.db, ctx.tenantId);
    service = new AccountingExportService(
      repository,
      new AccountingAdapterRegistry([new XeroAdapter()])
    );
    vi.spyOn(AccountingExportRepository, 'create').mockResolvedValue(repository);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  async function ensureClient(clientId: string, name: string) {
    const now = new Date().toISOString();
    await ctx.db('clients').insert({
      tenant: ctx.tenantId,
      client_id: clientId,
      client_name: name,
      created_at: now,
      updated_at: now,
      is_inactive: false
    });
  }

  async function seedLiveXeroBatch(options: {
    targetRealm?: string | null;
    netAmount?: number | null;
  } = {}): Promise<{ batchId: string; lineId: string }> {
    const targetRealm = options.targetRealm === undefined ? DEFAULT_TARGET_REALM : options.targetRealm;
    const netAmount = options.netAmount === undefined ? 5000 : options.netAmount;
    const serviceId = await createTestService(ctx, {
      service_name: 'Managed Endpoint',
      billing_method: 'fixed',
      default_rate: 5000,
      unit_of_measure: 'device',
      description: 'Endpoint management service'
    });

    await ensureClient(ctx.clientId, 'Acme Holdings');

    const now = new Date().toISOString();
    const invoiceId = uuidv4();
    const chargeId = uuidv4();

    await ctx.db('tenant_external_entity_mappings').insert([
      {
        id: uuidv4(),
        tenant: ctx.tenantId,
        integration_type: 'xero',
        alga_entity_type: 'service',
        alga_entity_id: serviceId,
        external_entity_id: 'ITEM-001',
        external_realm_id: targetRealm,
        metadata: { accountCode: '200' },
        sync_status: 'synced',
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        tenant: ctx.tenantId,
        integration_type: 'xero',
        alga_entity_type: 'client',
        alga_entity_id: ctx.clientId,
        external_entity_id: 'CONTACT-001',
        external_realm_id: targetRealm,
        sync_status: 'synced',
        created_at: now,
        updated_at: now
      }
    ]);

    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: `INV-${uuidv4().slice(0, 8)}`,
      invoice_date: now,
      due_date: now,
      subtotal: 5000,
      tax: 0,
      total_amount: 5000,
      currency_code: 'USD',
      status: 'draft',
      created_at: now,
      updated_at: now
    });

    await ctx.db('invoice_charges').insert({
      item_id: chargeId,
      tenant: ctx.tenantId,
      invoice_id: invoiceId,
      service_id: serviceId,
      description: 'Endpoint subscription',
      quantity: 1,
      unit_price: 5000,
      net_amount: netAmount,
      total_price: 5000,
      tax_amount: 0,
      is_manual: false,
      created_at: now,
      updated_at: now
    });

    const batch = await service.createBatch({
      adapter_type: 'xero',
      export_type: 'invoice',
      target_realm: targetRealm,
      filters: { start_date: '2025-01-01', end_date: '2025-01-31' },
      created_by: ctx.user.user_id
    });

    const [line] = await service.appendLines(batch.batch_id, {
      lines: [
        {
          batch_id: batch.batch_id,
          document_id: invoiceId,
          document_line_id: chargeId,
          client_id: ctx.clientId,
          amount_cents: 5000,
          currency_code: 'USD',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-01-31T00:00:00.000Z',
          // Validation requires lines to declare how their periods were derived.
          payload: { service_period_source: 'invoice_header_fallback' }
        }
      ]
    });

    return { batchId: batch.batch_id, lineId: line.line_id };
  }

  it('T017: DB-backed export succeeds through the live Xero adapter using the stored default connection context', async () => {
    // The adapter requires an immutable batch target realm, so even the
    // default-connection flow exports against a realm-stamped batch.
    const { batchId, lineId } = await seedLiveXeroBatch({ targetRealm: 'xero-default-realm' });

    xeroCreateMock.mockResolvedValue({
      createInvoices: vi.fn(async (payloads: Array<Record<string, any>>) => {
        expect(payloads).toHaveLength(1);
        expect(payloads[0].contactId).toBe('CONTACT-001');
        expect(payloads[0].lines[0].itemCode).toBe('ITEM-001');

        return [
          {
            status: 'success',
            invoiceId: 'xero-invoice-1',
            documentId: payloads[0].invoiceId,
            invoiceNumber: 'XERO-INV-1'
          }
        ];
      })
    });

    await expect(service.executeBatch(batchId)).resolves.toEqual({
      deliveredLines: [{ lineId, externalDocumentRef: 'xero-invoice-1' }],
      metadata: {
        adapter: 'xero',
        deliveredInvoices: 1
      }
    });

    expect(xeroCreateMock).toHaveBeenCalledWith(ctx.tenantId, 'xero-default-realm');

    const batch = await repository.getBatch(batchId);
    const [line] = await repository.listLines(batchId);

    expect(batch?.status).toBe('delivered');
    expect(line.status).toBe('delivered');
    expect(line.external_document_ref).toBe('xero-invoice-1');
  }, HOOK_TIMEOUT);

  it('T018: DB-backed export fails with a clear guard error when no stored default Xero connection exists', async () => {
    const { batchId, lineId } = await seedLiveXeroBatch({ targetRealm: 'xero-default-realm' });
    const guardError = new AppError(
      'XERO_NOT_CONFIGURED',
      `No Xero connections configured for tenant ${ctx.tenantId}`
    );

    xeroCreateMock.mockRejectedValue(guardError);

    await expect(service.executeBatch(batchId)).rejects.toThrow(
      `No Xero connections configured for tenant ${ctx.tenantId}`
    );

    expect(xeroCreateMock).toHaveBeenCalledWith(ctx.tenantId, 'xero-default-realm');

    const batch = await repository.getBatch(batchId);
    const [line] = await repository.listLines(batchId);

    expect(batch?.status).toBe('failed');
    expect(batch?.notes).toContain(`No Xero connections configured for tenant ${ctx.tenantId}`);
    expect(line.line_id).toBe(lineId);
    expect(line.status).not.toBe('delivered');
    expect(line.external_document_ref).toBeNull();
  }, HOOK_TIMEOUT);

  it('T019: realm-scoped Xero service and client mappings resolve for a realm-targeted batch', async () => {
    const { batchId, lineId } = await seedLiveXeroBatch({ targetRealm: 'xero-tenant-1' });

    xeroCreateMock.mockResolvedValue({
      createInvoices: vi.fn(async (payloads: Array<Record<string, any>>) => [{
        status: 'success',
        invoiceId: 'xero-invoice-realm-1',
        documentId: payloads[0].invoiceId
      }])
    });

    await expect(service.executeBatch(batchId)).resolves.toEqual({
      deliveredLines: [{ lineId, externalDocumentRef: 'xero-invoice-realm-1' }],
      metadata: { adapter: 'xero', deliveredInvoices: 1 }
    });
    expect(xeroCreateMock).toHaveBeenCalledWith(ctx.tenantId, 'xero-tenant-1');
  }, HOOK_TIMEOUT);

  it('T020: missing net_amount is a per-line readiness error and never reaches the Xero adapter', async () => {
    // Keep a canonical fixed allocation beneath a consolidated parent. A null
    // parent amount must be caught as a per-line readiness error before fixed
    // allocation expansion can coerce it or invoke the adapter.
    const tenant = ctx.tenantId;
    const clientId = ctx.clientId;
    const serviceId = await createTestService(ctx, {
      service_name: 'Consolidated fixed service', billing_method: 'fixed', default_rate: 5000,
      unit_of_measure: 'device', description: 'T020 consolidated parent fixture'
    });
    await ensureClient(clientId, 'T020 consolidated parent client');
    const invoiceId = uuidv4();
    const chargeId = uuidv4();
    const detailId = uuidv4();
    const configId = uuidv4();
    const contractId = uuidv4();
    const contractLineId = uuidv4();
    const now = new Date().toISOString();
    await ctx.db('contracts').insert({ tenant, contract_id: contractId,
      contract_name: 'Missing net amount fixture contract', billing_frequency: 'monthly',
      is_active: true, is_template: false });
    await ctx.db('contract_lines').insert({ tenant, contract_line_id: contractLineId,
      contract_id: contractId, contract_line_name: 'Consolidated fixed fixture',
      billing_frequency: 'monthly', is_active: true, is_template: false });
    await ctx.db('contract_line_service_configuration').insert({ tenant, config_id: configId,
      contract_line_id: contractLineId, service_id: serviceId, configuration_type: 'Fixed', quantity: 1 });
    await ctx.db('invoices').insert({ tenant, invoice_id: invoiceId, client_id: clientId,
      invoice_number: `INV-${uuidv4().slice(0, 8)}`, invoice_date: now, due_date: now,
      subtotal: 5000, tax: 0, total_amount: 5000, currency_code: 'USD', status: 'draft',
      created_at: now, updated_at: now });
    await ctx.db('invoice_charges').insert({ tenant, item_id: chargeId, invoice_id: invoiceId,
        service_id: null, description: 'Consolidated fixed parent with missing net amount', quantity: 1,
        unit_price: 5000, net_amount: null, total_price: 5000, tax_amount: 0,
        is_manual: false, is_discount: false, created_at: now, updated_at: now });
    await ctx.db('invoice_charge_details').insert({ tenant, item_detail_id: detailId, item_id: chargeId,
      service_id: serviceId, config_id: configId, quantity: 1, rate: 5000,
      service_period_start: '2025-01-01', service_period_end: '2025-01-31' });
    await ctx.db('invoice_charge_fixed_details').insert({ tenant, item_detail_id: detailId,
      base_rate: 5000, allocated_amount: 5000, tax_amount: 0, enable_proration: false,
      fmv: 5000, proportion: 1 });
    const batch = await service.createBatch({ adapter_type: 'xero', export_type: 'invoice',
      target_realm: 'xero-t020-isolated', filters: { start_date: '2025-01-01', end_date: '2025-01-31' },
      created_by: ctx.user.user_id });
    const [line] = await service.appendLines(batch.batch_id, { lines: [{ batch_id: batch.batch_id,
      document_id: invoiceId, document_line_id: chargeId, client_id: clientId,
      amount_cents: 5000, currency_code: 'USD', service_period_start: '2025-01-01T00:00:00.000Z',
      service_period_end: '2025-01-31T00:00:00.000Z',
      payload: { service_period_source: 'canonical_detail_periods' } }] });
    const reservationSpy = vi.spyOn(repository, 'reserveInvoicesForExport');

    const executionError = await service.executeBatch(batch.batch_id).then(() => null, (error: unknown) => error);
    expect(executionError).toMatchObject({
      code: 'ACCOUNTING_EXPORT_VALIDATION_FAILED',
      details: { validationErrors: [expect.objectContaining({ line_id: line.line_id, code: 'missing_net_amount' })] },
    });
    const executionId = reservationSpy.mock.calls[0]?.[4];
    expect(executionId).toEqual(expect.any(String));
    const persistedErrors = await repository.listErrors(batch.batch_id);
    expect(persistedErrors).toEqual(expect.arrayContaining([expect.objectContaining({
      batch_id: batch.batch_id, line_id: line.line_id, code: 'missing_net_amount',
    })]));
    expect(xeroCreateMock).not.toHaveBeenCalled();

    // A delayed failure callback from this attempt cannot overwrite a
    // replacement reservation or append its stale diagnostics.
    const replacementExecutionId = uuidv4();
    await ctx.db('accounting_export_batches').where({ tenant, batch_id: batch.batch_id })
      .update({ status: 'validating', execution_id: replacementExecutionId });
    await expect(repository.failExecution(batch.batch_id, executionId!, 'stale attempt', [{
      line_id: line.line_id, code: 'stale_validation', message: 'stale error',
    }])).resolves.toBe(false);
    const replacementBatch = await repository.getBatch(batch.batch_id);
    expect(replacementBatch).toMatchObject({ status: 'validating', execution_id: replacementExecutionId });
    expect(await repository.listErrors(batch.batch_id)).toEqual(persistedErrors);
  }, HOOK_TIMEOUT);

  it('T021: a realm-less Xero batch fails with XERO_REALM_REQUIRED and never reaches the Xero client', async () => {
    // Realms are immutable batch state stamped at creation; a batch that was
    // created without one must fail loudly instead of guessing a connection
    // and potentially posting into the wrong Xero organisation.
    const { batchId, lineId } = await seedLiveXeroBatch({ targetRealm: null });

    await expect(service.executeBatch(batchId)).rejects.toMatchObject({
      code: 'XERO_REALM_REQUIRED'
    });
    expect(xeroCreateMock).not.toHaveBeenCalled();

    const batch = await repository.getBatch(batchId);
    const [line] = await repository.listLines(batchId);

    expect(batch?.status).toBe('failed');
    expect(batch?.notes).toContain('immutable batch target realm');
    expect(line.line_id).toBe(lineId);
    expect(line.status).not.toBe('delivered');
    expect(line.external_document_ref).toBeNull();
  }, HOOK_TIMEOUT);
});
