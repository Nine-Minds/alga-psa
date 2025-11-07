import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { setupCommonMocks, createMockUser, mockGetCurrentUser } from '../../../../test-utils/testMocks';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

import { AccountingExportService } from 'server/src/lib/services/accountingExportService';
import { AccountingExportRepository } from 'server/src/lib/repositories/accountingExportRepository';
import { AccountingAdapterRegistry } from 'server/src/lib/adapters/accounting/registry';
import { AccountingMappingResolver } from 'server/src/lib/services/accountingMappingResolver';
import {
  AccountingExportAdapter,
  AccountingExportAdapterCapabilities,
  AccountingExportAdapterContext,
  AccountingExportDeliveryResult,
  AccountingExportTransformResult
} from 'server/src/lib/adapters/accounting/accountingExportAdapter';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

class StubQuickBooksAdapter implements AccountingExportAdapter {
  readonly type = 'quickbooks_online';

  capabilities(): AccountingExportAdapterCapabilities {
    return {
      deliveryMode: 'api',
      supportsPartialRetry: true,
      supportsInvoiceUpdates: true
    };
  }

  async transform(context: AccountingExportAdapterContext): Promise<AccountingExportTransformResult> {
    return {
      documents: context.lines.map((line) => ({
        documentId: `invoice-${line.invoice_id}`,
        lineIds: [line.line_id],
        payload: {
          invoiceId: line.invoice_id,
          amountCents: line.amount_cents
        }
      }))
    };
  }

  async deliver(_transform: AccountingExportTransformResult, context: AccountingExportAdapterContext): Promise<AccountingExportDeliveryResult> {
    return {
      deliveredLines: context.lines.map((line) => ({
        lineId: line.line_id,
        externalDocumentRef: `QB-${line.invoice_id}`
      }))
    };
  }
}

describe('Accounting export batch lifecycle integration', () => {
  let ctx: TestContext;
  let service: AccountingExportService;
  let repository: AccountingExportRepository;

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
    const adapterRegistry = new AccountingAdapterRegistry([new StubQuickBooksAdapter()]);
    service = new AccountingExportService(repository, adapterRegistry);
    vi.spyOn(AccountingExportRepository, 'create').mockResolvedValue(repository);
    const resolver = new AccountingMappingResolver(ctx.db);
    vi.spyOn(AccountingMappingResolver, 'create').mockResolvedValue(resolver);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  async function seedInvoiceWithMapping(): Promise<{ invoiceId: string; chargeId: string; serviceId: string }> {
    const serviceId = await createTestService(ctx, {
      service_name: 'Managed Endpoint',
      billing_method: 'fixed',
      default_rate: 5000,
      unit_of_measure: 'device',
      description: 'Endpoint management service'
    });

    const now = new Date().toISOString();

    await ctx.db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant: ctx.tenantId,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'service',
      alga_entity_id: serviceId,
      external_entity_id: `QBO-ITEM-${uuidv4()}`,
      sync_status: 'synced',
      created_at: now,
      updated_at: now
    });

    const invoiceId = uuidv4();

    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: `INV-${uuidv4().slice(0, 8)}`,
      invoice_date: now,
      due_date: now,
      total_amount: 5000,
      currency_code: 'USD',
      status: 'draft',
      created_at: now,
      updated_at: now
    });

    const chargeId = uuidv4();

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

    return { invoiceId, chargeId, serviceId };
  }

  async function createBatchWithLine(filters: Record<string, unknown>) {
    const { invoiceId, chargeId } = await seedInvoiceWithMapping();

    const batch = await service.createBatch({
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      target_realm: 'realm-001',
      filters,
      created_by: ctx.user.user_id
    });

    await service.appendLines(batch.batch_id, {
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

    return { batch, invoiceId, chargeId };
  }

  it('transitions a batch from pending to delivered during execution', async () => {
    const filters = { start_date: '2025-01-01', end_date: '2025-01-31' };
    const { batch } = await createBatchWithLine(filters);

    const initial = await repository.getBatch(batch.batch_id);
    expect(initial?.status).toBe('pending');

    const statusSpy = vi.spyOn(AccountingExportRepository.prototype, 'updateBatchStatus');

    await service.executeBatch(batch.batch_id);

    const transitionStatuses = statusSpy.mock.calls
      .filter(([, payload]) => payload?.status)
      .map(([, payload]) => payload.status);

    expect(transitionStatuses).toEqual(expect.arrayContaining(['validating', 'ready', 'delivered']));

    const delivered = await repository.getBatch(batch.batch_id);
    expect(delivered?.status).toBe('delivered');
    expect(delivered?.delivered_at).toBeTruthy();

    const deliveredLines = await repository.listLines(batch.batch_id);
    expect(deliveredLines.every((line) => line.status === 'delivered')).toBe(true);

    const postedAt = new Date().toISOString();
    await service.updateBatchStatus(batch.batch_id, { status: 'posted', posted_at: postedAt });

    const posted = await repository.getBatch(batch.batch_id);
    expect(posted?.status).toBe('posted');
    expect(posted?.posted_at).toBeTruthy();
  }, HOOK_TIMEOUT);

  it('rejects creation when an active batch already exists for the same filters', async () => {
    const filters = { start_date: '2025-01-01', end_date: '2025-01-31' };
    await createBatchWithLine(filters);

    await expect(
      service.createBatch({
        adapter_type: 'quickbooks_online',
        export_type: 'invoice',
        target_realm: 'realm-001',
        filters,
        created_by: ctx.user.user_id
      })
    ).rejects.toMatchObject({ code: 'ACCOUNTING_EXPORT_DUPLICATE' });
  }, HOOK_TIMEOUT);

  it('prevents executing batches that are cancelled or already delivered', async () => {
    const cancelledFilters = { start_date: '2025-02-01', end_date: '2025-02-28' };
    const { batch: cancelledBatch } = await createBatchWithLine(cancelledFilters);

    await service.updateBatchStatus(cancelledBatch.batch_id, { status: 'cancelled' });
    await expect(service.executeBatch(cancelledBatch.batch_id)).rejects.toMatchObject({ code: 'ACCOUNTING_EXPORT_INVALID_STATE' });

    const deliveredFilters = { start_date: '2025-03-01', end_date: '2025-03-31' };
    const { batch: deliveredBatch } = await createBatchWithLine(deliveredFilters);
    await service.executeBatch(deliveredBatch.batch_id);
    await expect(service.executeBatch(deliveredBatch.batch_id)).rejects.toMatchObject({ code: 'ACCOUNTING_EXPORT_INVALID_STATE' });

  }, HOOK_TIMEOUT);
});
