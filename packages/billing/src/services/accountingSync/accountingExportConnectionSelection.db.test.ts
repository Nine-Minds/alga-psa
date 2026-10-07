import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';

/**
 * DB-backed selected-target delivery.
 *
 * A manual export created with an explicit, connected target is delivered
 * through the real export service, the real provider adapter and the real
 * mapping resolver. Only the vendor HTTP boundary (QboClientService) is faked;
 * the credential store, DB handle and permissions are the seams pinned for the
 * test. The reported scenario — QuickBooks Online selected while Xero B is the
 * saved default — must deliver against the selected QBO realm and use that
 * realm's mappings.
 */

const connectionsState = vi.hoisted(() => ({
  xero: {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' },
    'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' }
  } as Record<string, { connectionId: string; xeroTenantId: string; tenantName: string }>,
  qbo: { 'qbo-realm-a': { realmId: 'qbo-realm-a' } } as Record<string, unknown>
}));

const qboVendor = vi.hoisted(() => ({
  deliveryCalls: [] as Array<{ realm: string; itemRefs: string[] }>
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/xero/xeroClientService')>()),
  getStoredXeroConnections: async () => connectionsState.xero,
  getXeroDefaultSelection: async () => ({ status: 'resolved', connectionId: 'conn-b' })
}));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/integrations/lib/qbo/qboClientService')>()),
  getStoredQboCredentialsMap: async () => connectionsState.qbo,
  getDefaultQboRealmId: async () => 'qbo-realm-a',
  // The vendor boundary: record what would have been sent to QuickBooks.
  QboClientService: {
    create: async (_tenant: string, realm: string) => ({
      read: async () => null,
      update: async () => ({ Id: 'QB-INV-A-1', SyncToken: '1', Line: [] }),
      create: async (_entity: string, payload: any) => {
        const lines = Array.isArray(payload?.Line) ? payload.Line : [];
        qboVendor.deliveryCalls.push({
          realm,
          itemRefs: lines
            .map((line: any) => line?.SalesItemLineDetail?.ItemRef?.value)
            .filter((value: unknown): value is string => typeof value === 'string')
        });
        return {
          Id: 'QB-INV-A-1',
          SyncToken: '0',
          DocNumber: payload?.DocNumber ?? 'QBO-1',
          TotalAmt: payload?.TotalAmt ?? 50,
          Line: lines.map((line: any, index: number) => ({
            Id: String(index + 1),
            DetailType: 'SalesItemLineDetail',
            SalesItemLineDetail: line?.SalesItemLineDetail
          }))
        };
      }
    })
  }
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined)
}));

vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: unknown) => fn }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

import * as dbModule from '@alga-psa/db';
import { AccountingExportInvoiceSelector } from '../accountingExportInvoiceSelector';
import { AccountingExportRepository } from '../../repositories/accountingExportRepository';
import { AccountingExportService } from '../accountingExportService';
import { KnexInvoiceMappingRepository } from '../../repositories/invoiceMappingRepository';
import { lockInvoiceForExternalSync } from '../../lib/invoiceExternalSyncLock';
import { assertInvoiceNotExported } from '../accountingSync/invoiceExportGuards';
import { inspectInvoiceEditable } from '../invoiceAdjustmentEditability';
import { wireLocalTestDbEnv, createTestDbConnection } from '../../actions/_dbTestUtils';

const tenantA = randomUUID();
let db: Knex;

async function ensureServiceType(tenant: string): Promise<string> {
  const existing = await db('service_types').where({ tenant, name: 'Fixed Service Type' }).first('id');
  if (existing?.id) {
    return existing.id;
  }
  const id = randomUUID();
  await db('service_types').insert({ id, tenant, name: 'Fixed Service Type' });
  return id;
}

async function seedInvoice(): Promise<{ invoiceId: string; chargeId: string; serviceId: string; clientId: string }> {
  const clientId = randomUUID();
  const invoiceId = randomUUID();
  const chargeId = randomUUID();
  const serviceId = randomUUID();
  const invoiceDate = '2026-02-01T00:00:00.000Z';

  await db('clients').insert({
    tenant: tenantA,
    client_id: clientId,
    client_name: `Selection Client ${clientId.slice(0, 6)}`,
    created_at: invoiceDate,
    updated_at: invoiceDate,
    is_inactive: false
  });

  const serviceTypeId = await ensureServiceType(tenantA);
  await db('service_catalog').insert({
    tenant: tenantA,
    service_id: serviceId,
    service_name: `Managed Endpoint ${serviceId.slice(0, 6)}`,
    billing_method: 'fixed',
    default_rate: 5000,
    custom_service_type_id: serviceTypeId
  });

  await db('invoices').insert({
    invoice_id: invoiceId,
    tenant: tenantA,
    client_id: clientId,
    invoice_number: `INV-${invoiceId.slice(0, 6)}`,
    invoice_date: invoiceDate,
    due_date: invoiceDate,
    subtotal: 5000,
    tax: 0,
    total_amount: 5000,
    status: 'sent',
    currency_code: 'USD',
    is_manual: false,
    created_at: invoiceDate,
    updated_at: invoiceDate
  });

  await db('invoice_charges').insert({
    item_id: chargeId,
    tenant: tenantA,
    invoice_id: invoiceId,
    service_id: serviceId,
    description: 'Selection line',
    quantity: 1,
    unit_price: 5000,
    total_price: 5000,
    net_amount: 5000,
    tax_amount: 0,
    is_manual: false,
    created_at: invoiceDate,
    updated_at: invoiceDate
  });

  return { invoiceId, chargeId, serviceId, clientId };
}

async function seedServiceMapping(serviceId: string, realmId: string, externalId: string): Promise<void> {
  await db('tenant_external_entity_mappings').insert({
    id: randomUUID(),
    tenant: tenantA,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'service',
    alga_entity_id: serviceId,
    external_entity_id: externalId,
    external_realm_id: realmId,
    sync_status: 'manual_link',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

async function seedClientMapping(clientId: string, realmId: string): Promise<void> {
  await db('tenant_external_entity_mappings').insert({
    id: randomUUID(),
    tenant: tenantA,
    integration_type: 'quickbooks_online',
    alga_entity_type: 'client',
    alga_entity_id: clientId,
    external_entity_id: 'QB-CUST-A',
    external_realm_id: realmId,
    sync_status: 'manual_link',
    created_at: db.fn.now(),
    updated_at: db.fn.now()
  });
}

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: db, tenant: tenantA } as never);

  await db('tenants').insert({
    tenant: tenantA,
    client_name: `Selection ${tenantA.slice(0, 8)}`,
    email: `selection-${tenantA.slice(0, 8)}@example.com`
  });
});

afterAll(async () => {
  await db('accounting_export_artifacts').where({ tenant: tenantA }).del();
  await db('accounting_export_errors').where({ tenant: tenantA }).del();
  await db('accounting_export_lines').where({ tenant: tenantA }).del();
  await db('accounting_export_batches').where({ tenant: tenantA }).del();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('invoice_charges').where({ tenant: tenantA }).del();
  await db('invoices').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).del();
  await db('clients').where({ tenant: tenantA }).del();
  await db('tenant_settings').where({ tenant: tenantA }).del();
  await db('tenants').where({ tenant: tenantA }).del();
  await db.destroy().catch(() => undefined);
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db('accounting_export_artifacts').where({ tenant: tenantA }).del();
  await db('accounting_export_errors').where({ tenant: tenantA }).del();
  await db('accounting_export_lines').where({ tenant: tenantA }).del();
  await db('accounting_export_batches').where({ tenant: tenantA }).del();
  await db('tenant_external_entity_mappings').where({ tenant: tenantA }).del();
  await db('invoice_charges').where({ tenant: tenantA }).del();
  await db('invoices').where({ tenant: tenantA }).del();
  await db('service_catalog').where({ tenant: tenantA }).del();
  await db('clients').where({ tenant: tenantA }).del();
  await db('tenant_settings').where({ tenant: tenantA }).del();
  qboVendor.deliveryCalls.length = 0;
  connectionsState.xero = {
    'conn-a': { connectionId: 'conn-a', xeroTenantId: 'org-a', tenantName: 'Org A' },
    'conn-b': { connectionId: 'conn-b', xeroTenantId: 'org-b', tenantName: 'Org B' }
  };
  connectionsState.qbo = { 'qbo-realm-a': { realmId: 'qbo-realm-a' } };
  // Reported scenario: Xero B is the saved default while QBO is connected.
  await db('tenant_settings').insert({
    tenant: tenantA,
    settings: { accountingSync: { defaultRealm: 'conn-b' } },
    updated_at: db.fn.now()
  });
});

describe('manual export selected-target delivery (DB-backed)', () => {
  it('fences an expired owner and never recovers a live execution transaction', async () => {
    const { invoiceId } = await seedInvoice();
    const repo = await AccountingExportRepository.createForTenant(tenantA);
    const batch = await repo.createBatch({ adapter_type: 'quickbooks_desktop', export_type: 'invoice' });
    await repo.addLine({ batch_id: batch.batch_id, document_id: invoiceId, amount_cents: 5000, currency_code: 'USD' });
    const expired = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const oldId = randomUUID();
    await repo.reserveInvoicesForExport(batch.batch_id, [invoiceId], batch.status, expired, oldId);
    expect(await repo.recoverExpiredExecution(batch.batch_id, cutoff)).toBe(true);
    const newId = randomUUID();
    await repo.reserveInvoicesForExport(batch.batch_id, [invoiceId], 'failed', expired, newId);
    const staleWork = vi.fn();
    await expect(repo.withExecution(batch.batch_id, oldId, staleWork)).rejects.toThrow(/no longer owns/);
    expect(staleWork).not.toHaveBeenCalled();
    await repo.failExecution(batch.batch_id, oldId, 'stale worker failure');
    expect((await repo.getBatch(batch.batch_id))?.status).toBe('validating');

    await repo.withExecution(batch.batch_id, newId, async (scoped) => {
      // Even an old timestamp cannot override a worker still holding its fence.
      expect(await repo.recoverExpiredExecution(batch.batch_id, cutoff)).toBe(false);
      await scoped.updateBatchStatus(batch.batch_id, { status: 'delivered' });
    });
    await repo.failExecution(batch.batch_id, oldId, 'late failure');
    expect((await repo.getBatch(batch.batch_id))?.status).toBe('delivered');
  });

  it('publishes IIF bytes and delivered edit guards atomically when a status write fails', async () => {
    const { invoiceId, serviceId, clientId } = await seedInvoice();
    for (const [entityType, entityId, externalId] of [
      ['service', serviceId, 'ATOMIC-SERVICE'], ['client', clientId, 'ATOMIC-CUSTOMER'],
    ] as const) await db('tenant_external_entity_mappings').insert({
      id: randomUUID(), tenant: tenantA, integration_type: 'quickbooks_desktop',
      alga_entity_type: entityType, alga_entity_id: entityId, external_entity_id: externalId,
      sync_status: 'manual_link', created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    const selected = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_desktop', filters: { invoiceIds: [invoiceId] },
    });
    await db('invoices').where({ tenant: tenantA, invoice_id: invoiceId }).update({ status: 'draft', finalized_at: null });
    const service = await AccountingExportService.createForTenant(tenantA);
    const { AccountingExportValidation } = await import('../accountingExportValidation');
    const validation = vi.spyOn(AccountingExportValidation, 'ensureMappingsForBatch')
      .mockRejectedValueOnce(new Error('injected preparation failure'));
    try {
      await expect(service.executeBatch(selected.batch.batch_id)).rejects.toThrow('injected preparation failure');
    } finally { validation.mockRestore(); }
    expect((await service.getBatchWithDetails(selected.batch.batch_id)).batch?.status).toBe('failed');
    expect((await inspectInvoiceEditable(db, tenantA, invoiceId)).capability.editable).toBe(true);
    const updateLine = vi.spyOn(AccountingExportRepository.prototype, 'updateLine').mockImplementationOnce(async () => {
      expect((await service.getBatchWithDetails(selected.batch.batch_id)).artifacts).toHaveLength(0);
      expect((await inspectInvoiceEditable(db, tenantA, invoiceId)).capability.editable).toBe(false);
      throw new Error('injected delivered-line failure');
    });
    try {
      await expect(service.executeBatch(selected.batch.batch_id)).rejects.toThrow('injected delivered-line failure');
    } finally { updateLine.mockRestore(); }
    expect((await service.getBatchWithDetails(selected.batch.batch_id)).artifacts).toHaveLength(0);
    expect((await inspectInvoiceEditable(db, tenantA, invoiceId)).capability.editable).toBe(true);
    await service.executeBatch(selected.batch.batch_id);
    expect((await service.getBatchWithDetails(selected.batch.batch_id)).artifacts).toHaveLength(1);
    expect((await inspectInvoiceEditable(db, tenantA, invoiceId)).capability).toMatchObject({ editable: false, code: 'exported' });
  });

  it('does not let a cancellation that read ready overwrite an execution reservation', async () => {
    const { invoiceId, serviceId, clientId } = await seedInvoice();
    for (const [entityType, entityId, externalId] of [
      ['service', serviceId, 'RACE-SERVICE'], ['client', clientId, 'RACE-CUSTOMER'],
    ] as const) await db('tenant_external_entity_mappings').insert({
      id: randomUUID(), tenant: tenantA, integration_type: 'quickbooks_desktop',
      alga_entity_type: entityType, alga_entity_id: entityId, external_entity_id: externalId,
      sync_status: 'manual_link', created_at: db.fn.now(), updated_at: db.fn.now(),
    });
    const selected = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_desktop', filters: { invoiceIds: [invoiceId] }, createdBy: randomUUID(),
    });
    const service = await AccountingExportService.createForTenant(tenantA);
    const repo = (service as any).repository;
    const originalGetBatch = repo.getBatch.bind(repo);
    let cancellationRead!: () => void;
    let continueCancellation!: () => void;
    const readReady = new Promise<void>((resolve) => { cancellationRead = resolve; });
    const cancelGate = new Promise<void>((resolve) => { continueCancellation = resolve; });
    let pauseNextRead = true;
    repo.getBatch = async (batchId: string) => {
      const row = await originalGetBatch(batchId);
      if (pauseNextRead) { pauseNextRead = false; cancellationRead(); await cancelGate; }
      return row;
    };
    const cancellation = service.cancelBatch(selected.batch.batch_id);
    await readReady;
    const adapter = (service as any).adapterRegistry.get('quickbooks_desktop');
    const originalTransform = adapter.transform.bind(adapter);
    let transformStarted!: () => void;
    let releaseTransform!: () => void;
    const started = new Promise<void>((resolve) => { transformStarted = resolve; });
    const transformGate = new Promise<void>((resolve) => { releaseTransform = resolve; });
    adapter.transform = async (context: any) => { transformStarted(); await transformGate; return originalTransform(context); };
    const execution = service.executeBatch(selected.batch.batch_id);
    await started;
    continueCancellation();
    const rejectedCancellation = expect(cancellation).rejects.toThrow(/cannot cancel batch in status (validating|delivered)/i);
    expect((await originalGetBatch(selected.batch.batch_id))?.status).toBe('validating');
    releaseTransform();
    await execution;
    await rejectedCancellation;
    adapter.transform = originalTransform;
    repo.getBatch = originalGetBatch;
  });

  it('persists real IIF bytes through executeBatch and blocks an edit during the transform snapshot', async () => {
    const { invoiceId, serviceId, clientId } = await seedInvoice();
    for (const [entityType, entityId, externalId] of [
      ['service', serviceId, 'DESKTOP-SERVICE'],
      ['client', clientId, 'DESKTOP-CUSTOMER'],
    ] as const) {
      await db('tenant_external_entity_mappings').insert({
        id: randomUUID(), tenant: tenantA, integration_type: 'quickbooks_desktop',
        alga_entity_type: entityType, alga_entity_id: entityId, external_entity_id: externalId,
        sync_status: 'manual_link', created_at: db.fn.now(), updated_at: db.fn.now(),
      });
    }
    const selected = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_desktop', filters: { invoiceIds: [invoiceId] }, createdBy: randomUUID(),
    });
    const service = await AccountingExportService.createForTenant(tenantA);
    const adapter = (service as any).adapterRegistry.get('quickbooks_desktop');
    const originalTransform = adapter.transform.bind(adapter);
    const originalDeliver = adapter.deliver.bind(adapter);
    let deliveryAttempt = 0;
    let previousIifBytes = Buffer.alloc(0);
    adapter.deliver = async (transformResult: any, context: any) => {
      const result = await originalDeliver(transformResult, context);
      deliveryAttempt += 1;
      const iif = result.artifacts.file;
      if (deliveryAttempt === 1) previousIifBytes = Buffer.from(iif.content, 'utf8');
      return {
        ...result,
        metadata: {
          ...result.metadata,
          files: deliveryAttempt === 1
            ? [iif, { filename: 'broken.csv', contentType: 'text/csv' }]
            : [iif, { filename: 'supplemental.csv', contentType: 'text/csv', content: 'second exact file\r\n' }],
        },
      };
    };
    const { StorageService } = await import('@alga-psa/storage/StorageService');
    const upload = vi.spyOn(StorageService, 'uploadFile').mockImplementation(async (_tenant, bytes, filename) => {
      if (filename === 'supplemental.csv') throw new Error('object store unavailable for second artifact');
      return { file_id: randomUUID(), filename, size: Buffer.isBuffer(bytes) ? bytes.length : 0 } as any;
    });
    const deleteFile = vi.spyOn(StorageService, 'deleteFile').mockResolvedValue({} as any);
    let transformStarted!: () => void;
    let releaseTransform!: () => void;
    const started = new Promise<void>((resolve) => { transformStarted = resolve; });
    const gate = new Promise<void>((resolve) => { releaseTransform = resolve; });
    adapter.transform = async (context: any) => {
      transformStarted();
      await gate;
      return originalTransform(context);
    };

    const executing = service.executeBatch(selected.batch.batch_id);
    await started;
    expect((await db('accounting_export_batches').where({ tenant: tenantA, batch_id: selected.batch.batch_id }).first()).status).toBe('validating');
    await expect(service.cancelBatch(selected.batch.batch_id)).rejects.toThrow(/cannot cancel batch in status validating/i);
    await expect(service.updateBatchStatus(selected.batch.batch_id, { status: 'cancelled' })).rejects.toThrow(/cannot be transitioned manually/i);
    await expect(db.transaction(async (trx) => {
      await lockInvoiceForExternalSync(trx, tenantA, invoiceId);
      await assertInvoiceNotExported(trx, tenantA, invoiceId, 'edit');
    })).rejects.toThrow(/accounting export is being prepared/i);

    releaseTransform();
    await expect(executing).rejects.toThrow(/invalid file artifact/i);
    const partial = await service.getBatchWithDetails(selected.batch.batch_id);
    expect(partial.batch?.status).toBe('failed');
    expect(partial.artifacts).toHaveLength(0);
    expect(await db('accounting_export_artifacts').where({ tenant: tenantA, batch_id: selected.batch.batch_id })).toHaveLength(0);

    // A corrected retry must replace the first attempt's bytes, retain exact
    // adapter output, and add the second file without repeating any provider
    // transport. QuickBooks Desktop delivery is file preparation; this adapter
    // makes no provider HTTP request (no transport mock is involved).
    await db('invoice_charges').where({ tenant: tenantA, invoice_id: invoiceId }).update({ net_amount: 5100, total_price: 5100, unit_price: 5100 });
    const result = await service.executeBatch(selected.batch.batch_id);
    adapter.transform = originalTransform;
    adapter.deliver = originalDeliver;
    expect(result.failedDocuments).toBeUndefined();
    const reloaded = await service.getBatchWithDetails(selected.batch.batch_id);
    expect(reloaded.artifacts).toHaveLength(2);
    const artifacts = await db('accounting_export_artifacts').where({ tenant: tenantA, batch_id: selected.batch.batch_id });
    const updatedIif = artifacts.find((row: any) => row.filename.endsWith('.iif'));
    expect(Buffer.from(updatedIif.content)).not.toEqual(previousIifBytes);
    expect(Buffer.from(updatedIif.content).toString('utf8')).toContain('DESKTOP-SERVICE');
    expect(artifacts.find((row: any) => row.filename === 'supplemental.csv')).toMatchObject({ file_id: null, storage_fallback: true });
    expect(artifacts.find((row: any) => row.filename === 'supplemental.csv').content.toString()).toBe('second exact file\r\n');
    expect(reloaded.artifacts.map((file) => file.filename)).toEqual(expect.arrayContaining(['supplemental.csv', updatedIif.filename]));
    expect(upload).toHaveBeenCalledTimes(3);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    const { downloadAccountingExportArtifact } = await import('../../actions/accountingExportActions');
    const download = vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({ buffer: Buffer.from(updatedIif.content) } as any);
    const primaryDownload = await (downloadAccountingExportArtifact as any)(
      { user_id: randomUUID() }, { tenant: tenantA }, selected.batch.batch_id, updatedIif.artifact_id,
    );
    expect(download).toHaveBeenCalledWith(updatedIif.file_id);
    expect(Buffer.from(primaryDownload.contentBase64, 'base64')).toEqual(Buffer.from(updatedIif.content));
    download.mockRestore();
    upload.mockRestore();
    deleteFile.mockRestore();
  });

  it('persists exact real CSV adapter bytes during executeBatch and reloads them without a provider transport', async () => {
    const { invoiceId, serviceId, clientId } = await seedInvoice();
    for (const [entityType, entityId, externalId] of [
      ['service', serviceId, 'CSV-SERVICE'],
      ['client', clientId, 'CSV-CUSTOMER'],
    ] as const) {
      await db('tenant_external_entity_mappings').insert({
        id: randomUUID(), tenant: tenantA, integration_type: 'quickbooks_csv',
        alga_entity_type: entityType, alga_entity_id: entityId, external_entity_id: externalId,
        sync_status: 'manual_link', created_at: db.fn.now(), updated_at: db.fn.now(),
      });
    }
    const selected = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_csv', filters: { invoiceIds: [invoiceId] },
    });
    await db('invoices').where({ tenant: tenantA, invoice_id: invoiceId }).update({ status: 'draft', finalized_at: null });
    const service = await AccountingExportService.createForTenant(tenantA);
    const result = await service.executeBatch(selected.batch.batch_id);
    const adapterFile = (result.metadata as any).files[0];
    const reloaded = await service.getBatchWithDetails(selected.batch.batch_id);
    const stored = await db('accounting_export_artifacts')
      .where({ tenant: tenantA, batch_id: selected.batch.batch_id }).first();

    expect(result.failedDocuments).toBeUndefined();
    expect(reloaded.batch?.status).toBe('delivered');
    expect(reloaded.artifacts).toHaveLength(1);
    expect(Buffer.from(stored.content).toString('utf8')).toBe(adapterFile.content);
    expect(adapterFile.content).toContain('CSV-SERVICE');
    expect(adapterFile.content).toContain('50.00');
    expect((await inspectInvoiceEditable(db, tenantA, invoiceId)).capability).toMatchObject({ editable: false, code: 'exported' });
  });

  it('does not publish CSV artifacts while mapping postProcess is pending or after it fails', async () => {
    const { invoiceId, serviceId, clientId } = await seedInvoice();
    for (const [entityType, entityId, externalId] of [
      ['service', serviceId, 'CSV-PUBLISH-SERVICE'], ['client', clientId, 'CSV-PUBLISH-CUSTOMER'],
    ] as const) {
      await db('tenant_external_entity_mappings').insert({
        id: randomUUID(), tenant: tenantA, integration_type: 'quickbooks_csv',
        alga_entity_type: entityType, alga_entity_id: entityId, external_entity_id: externalId,
        sync_status: 'manual_link', created_at: db.fn.now(), updated_at: db.fn.now(),
      });
    }
    const selected = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_csv', filters: { invoiceIds: [invoiceId] },
    });
    const service = await AccountingExportService.createForTenant(tenantA);
    const adapter = (service as any).adapterRegistry.get('quickbooks_csv');
    let enterPostProcess!: () => void;
    let releasePostProcess!: () => void;
    const entered = new Promise<void>((resolve) => { enterPostProcess = resolve; });
    const gate = new Promise<void>((resolve) => { releasePostProcess = resolve; });
    adapter.postProcess = async () => { enterPostProcess(); await gate; throw new Error('mapping commit failure'); };

    const executing = service.executeBatch(selected.batch.batch_id);
    await entered;
    const during = await service.getBatchWithDetails(selected.batch.batch_id);
    expect(during.artifacts).toHaveLength(0);
    expect(await db('accounting_export_artifacts').where({ tenant: tenantA, batch_id: selected.batch.batch_id, committed: true })).toHaveLength(0);
    releasePostProcess();
    await expect(executing).rejects.toThrow('mapping commit failure');
    expect((await service.getBatchWithDetails(selected.batch.batch_id)).artifacts).toHaveLength(0);
    expect(await db('accounting_export_artifacts').where({ tenant: tenantA, batch_id: selected.batch.batch_id })).toHaveLength(0);
  });

  it('makes CSV mapping delivery atomic when one invoice fails, leaving the other draft editable', async () => {
    const first = await seedInvoice();
    const second = await seedInvoice();
    for (const fixture of [first, second]) {
      for (const [entityType, entityId, externalId] of [
        ['service', fixture.serviceId, `CSV-SERVICE-${fixture.serviceId}`],
        ['client', fixture.clientId, `CSV-CUSTOMER-${fixture.clientId}`],
      ] as const) {
        await db('tenant_external_entity_mappings').insert({
          id: randomUUID(), tenant: tenantA, integration_type: 'quickbooks_csv',
          alga_entity_type: entityType, alga_entity_id: entityId, external_entity_id: externalId,
          sync_status: 'manual_link', created_at: db.fn.now(), updated_at: db.fn.now(),
        });
      }
    }
    const selected = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_csv', filters: { invoiceIds: [first.invoiceId, second.invoiceId] },
    });
    const editableInvoiceId = first.invoiceId < second.invoiceId ? first.invoiceId : second.invoiceId;
    const cancelledInvoiceId = editableInvoiceId === first.invoiceId ? second.invoiceId : first.invoiceId;
    await db('invoices').where({ tenant: tenantA }).whereIn('invoice_id', [first.invoiceId, second.invoiceId])
      .update({ status: 'draft', finalized_at: null });
    await db('invoices').where({ tenant: tenantA, invoice_id: cancelledInvoiceId }).update({ status: 'cancelled' });

    const service = await AccountingExportService.createForTenant(tenantA);
    await expect(service.executeBatch(selected.batch.batch_id)).rejects.toThrow(/voided|cancelled/i);
    expect(await db('tenant_external_entity_mappings').where({
      tenant: tenantA, alga_entity_type: 'invoice', alga_entity_id: editableInvoiceId,
    })).toHaveLength(0);
    expect(await db('accounting_export_artifacts').where({ tenant: tenantA, batch_id: selected.batch.batch_id })).toHaveLength(0);
    expect((await inspectInvoiceEditable(db, tenantA, editableInvoiceId)).capability).toMatchObject({ editable: true, code: null });
  });

  it('delivers a QBO batch to the selected realm with that realm\'s mappings even when Xero B is default', async () => {
    const { invoiceId, serviceId, clientId } = await seedInvoice();
    // Realm isolation: decoy service mapping in another realm must not be used.
    await seedServiceMapping(serviceId, 'qbo-realm-decoy', 'SVC-DECOY');
    await seedServiceMapping(serviceId, 'qbo-realm-a', 'SVC-QBO-A');
    await seedClientMapping(clientId, 'qbo-realm-a');

    const batch = await new AccountingExportInvoiceSelector(db, tenantA).createBatchFromFilters({
      adapterType: 'quickbooks_online',
      targetRealm: 'qbo-realm-a',
      filters: { invoiceIds: [invoiceId] }
    });

    expect(batch.batch.adapter_type).toBe('quickbooks_online');
    expect(batch.batch.target_realm).toBe('qbo-realm-a');

    // Execute through the real service + real QBO adapter + real resolver.
    const service = await AccountingExportService.createForTenant(tenantA);
    const result = await service.executeBatch(batch.batch.batch_id);

    expect(result.failedDocuments ?? []).toHaveLength(0);
    expect(qboVendor.deliveryCalls).toHaveLength(1);
    expect(qboVendor.deliveryCalls[0].realm).toBe('qbo-realm-a');
    // Correct mapping usage: the selected realm's item, not the decoy.
    expect(qboVendor.deliveryCalls[0].itemRefs).toEqual(['SVC-QBO-A']);

    const delivered = await db('accounting_export_batches')
      .where({ batch_id: batch.batch.batch_id, tenant: tenantA })
      .first();
    expect(delivered?.status).toBe('delivered');

    const persistedMapping = await new KnexInvoiceMappingRepository(db).findInvoiceMapping({
      tenantId: tenantA,
      adapterType: 'quickbooks_online',
      invoiceId,
      targetRealm: 'qbo-realm-a'
    });
    expect(persistedMapping?.externalInvoiceId).toBe('QB-INV-A-1');
    expect(persistedMapping?.externalRealmId).toBe('qbo-realm-a');
  });

  it('resolves a selected Xero connection\'s mappings and not another connection\'s', async () => {
    const { invoiceId, serviceId } = await seedInvoice();
    const selector = new AccountingExportInvoiceSelector(db, tenantA);

    const { batch } = await selector.createBatchFromFilters({
      adapterType: 'xero',
      targetRealm: 'conn-a',
      filters: { invoiceIds: [invoiceId] }
    });
    expect(batch.target_realm).toBe('conn-a');

    await db('tenant_external_entity_mappings').insert({
      id: randomUUID(),
      tenant: tenantA,
      integration_type: 'xero',
      alga_entity_type: 'service',
      alga_entity_id: serviceId,
      external_entity_id: 'REVENUE-CONN-A',
      external_realm_id: 'conn-a',
      sync_status: 'manual_link',
      created_at: db.fn.now(),
      updated_at: db.fn.now()
    });

    // `ensureMappingsForBatch` uses the same realm-scoped resolver; run it to
    // prove the selected connection's mapping is the one found (and the realm
    // without a mapping fails closed instead of borrowing conn-a's).
    const { AccountingExportValidation } = await import('../accountingExportValidation');
    await AccountingExportValidation.ensureMappingsForBatch(batch.batch_id);
    const ready = await db('accounting_export_batches')
      .where({ batch_id: batch.batch_id, tenant: tenantA })
      .first();
    expect(ready?.status).toBe('ready');
  });

  it('rejects an invalid explicit target before writing any batch row', async () => {
    await seedInvoice();
    const before = Number(
      ((await db('accounting_export_batches').where({ tenant: tenantA }).count('* as count').first()) as { count?: string } | undefined)?.count ?? 0
    );
    const selector = new AccountingExportInvoiceSelector(db, tenantA);

    await expect(
      selector.createBatchFromFilters({
        adapterType: 'quickbooks_online',
        targetRealm: 'conn-a',
        filters: {}
      })
    ).rejects.toMatchObject({ code: 'ACCOUNTING_EXPORT_TARGET_UNAVAILABLE' });

    const after = Number(
      ((await db('accounting_export_batches').where({ tenant: tenantA }).count('* as count').first()) as { count?: string } | undefined)?.count ?? 0
    );
    expect(after).toBe(before);
  });
});
