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
      status: 'active'
    });
  }

  async function seedLiveXeroBatch(): Promise<{ batchId: string; lineId: string }> {
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
        external_realm_id: null,
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
        external_realm_id: null,
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
      net_amount: 5000,
      total_price: 5000,
      tax_amount: 0,
      is_manual: false,
      created_at: now,
      updated_at: now
    });

    const batch = await service.createBatch({
      adapter_type: 'xero',
      export_type: 'invoice',
      target_realm: null,
      filters: { start_date: '2025-01-01', end_date: '2025-01-31' },
      created_by: ctx.user.user_id
    });

    const [line] = await service.appendLines(batch.batch_id, {
      lines: [
        {
          batch_id: batch.batch_id,
          invoice_id: invoiceId,
          invoice_charge_id: chargeId,
          client_id: ctx.clientId,
          amount_cents: 5000,
          currency_code: 'USD',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-01-31T00:00:00.000Z'
        }
      ]
    });

    return { batchId: batch.batch_id, lineId: line.line_id };
  }

  it('T017: DB-backed export succeeds through the live Xero adapter using the stored default connection context', async () => {
    const { batchId, lineId } = await seedLiveXeroBatch();

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

    expect(xeroCreateMock).toHaveBeenCalledWith(ctx.tenantId, null);

    const batch = await repository.getBatch(batchId);
    const [line] = await repository.listLines(batchId);

    expect(batch?.status).toBe('delivered');
    expect(line.status).toBe('delivered');
    expect(line.external_document_ref).toBe('xero-invoice-1');
  }, HOOK_TIMEOUT);

  it('T018: DB-backed export fails with a clear guard error when no stored default Xero connection exists', async () => {
    const { batchId, lineId } = await seedLiveXeroBatch();
    const guardError = new AppError(
      'XERO_NOT_CONFIGURED',
      `No Xero connections configured for tenant ${ctx.tenantId}`
    );

    xeroCreateMock.mockRejectedValue(guardError);

    await expect(service.executeBatch(batchId)).rejects.toThrow(
      `No Xero connections configured for tenant ${ctx.tenantId}`
    );

    expect(xeroCreateMock).toHaveBeenCalledWith(ctx.tenantId, null);

    const batch = await repository.getBatch(batchId);
    const [line] = await repository.listLines(batchId);

    expect(batch?.status).toBe('failed');
    expect(batch?.notes).toContain(`No Xero connections configured for tenant ${ctx.tenantId}`);
    expect(line.line_id).toBe(lineId);
    expect(line.status).not.toBe('delivered');
    expect(line.external_document_ref).toBeNull();
  }, HOOK_TIMEOUT);
});
