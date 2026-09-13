import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

// Controlled provider client boundary: the adapter's single client entry point is
// mocked while everything else (DB, ledger, reconciliation appliers) is real.
const xeroCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XeroClientService: {
    create: xeroCreateMock
  }
}));

import {
  AccountingAdapterRegistry,
  AccountingExportRepository,
  AccountingExportService,
  XeroAdapter,
  WorkflowTaskSyncExceptionService,
  runAccountingSyncCycle
} from '@alga-psa/billing/services';
import { SyncMappingLedger } from '@alga-psa/billing/services';

import { TestContext } from '../../../../test-utils/testContext';
import { createMockUser, mockGetCurrentUser, setupCommonMocks } from '../../../../test-utils/testMocks';
import { createTestService } from '../../../../test-utils/billingTestHelpers';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;
const REALM = 'xero-conn-1';

describe('Xero inbound reconciliation (DB + controlled provider boundary)', () => {
  let ctx: TestContext;
  let repository: AccountingExportRepository;
  let service: AccountingExportService;
  let adapter: XeroAdapter;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'accounting_export_errors',
        'accounting_export_lines',
        'accounting_export_batches',
        'tenant_external_entity_mappings',
        'invoice_payments',
        'transactions',
        'invoice_charges',
        'invoices',
        'service_catalog',
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
    await ctx.db('invoice_payments').where({ tenant: ctx.tenantId }).del();
    await ctx.db('transactions').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoice_charges').where({ tenant: ctx.tenantId }).del();
    await ctx.db('invoices').where({ tenant: ctx.tenantId }).del();
    await ctx.db('service_catalog').where({ tenant: ctx.tenantId }).del();
    await ctx.db('client_billing_profiles').where({ tenant: ctx.tenantId }).del();
    await ctx.db('clients').where({ tenant: ctx.tenantId }).del();

    const financeUser = createMockUser('internal', {
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      roles: ctx.user.roles && ctx.user.roles.length > 0 ? ctx.user.roles : [
        { role_id: 'finance-admin-role', tenant: ctx.tenantId, role_name: 'Finance Admin', permissions: [] }
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
    const algaDbModule = await import('@alga-psa/db');
    vi.spyOn(algaDbModule, 'createTenantKnex').mockResolvedValue({ knex: ctx.db, tenant: ctx.tenantId });

    repository = new AccountingExportRepository(ctx.db, ctx.tenantId);
    adapter = new XeroAdapter();
    service = new AccountingExportService(repository, new AccountingAdapterRegistry([adapter]));
    vi.spyOn(AccountingExportRepository, 'create').mockResolvedValue(repository);
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    vi.restoreAllMocks();
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  async function seedInvoiceAndExport(): Promise<string> {
    const serviceId = await createTestService(ctx, {
      service_name: 'Managed Endpoint',
      billing_method: 'fixed',
      default_rate: 5000,
      unit_of_measure: 'device',
      description: 'Endpoint management service'
    });

    const now = new Date().toISOString();
    await ctx.db('clients').insert({
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      client_name: 'Acme Holdings',
      created_at: now,
      updated_at: now,
      is_inactive: false
    });

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
        external_realm_id: REALM,
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
        external_realm_id: REALM,
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
      status: 'sent',
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
      target_realm: REALM,
      filters: { start_date: '2025-01-01', end_date: '2025-01-31' },
      created_by: ctx.user.user_id
    });
    await service.appendLines(batch.batch_id, {
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
          payload: { service_period_source: 'invoice_header_fallback' }
        }
      ]
    });

    xeroCreateMock.mockResolvedValueOnce({
      createInvoices: vi.fn(async (payloads: Array<Record<string, any>>) => [
        {
          status: 'success',
          invoiceId: 'xero-invoice-1',
          documentId: payloads[0].invoiceId,
          invoiceNumber: 'XERO-INV-1',
          raw: {
            InvoiceID: 'xero-invoice-1',
            InvoiceNumber: 'XERO-INV-1',
            Total: 50,
            UpdatedDateUTC: '2026-03-01T00:00:00.000Z',
            LineItems: [{ LineItemID: 'xero-line-1' }]
          }
        }
      ])
    });

    await service.executeBatch(batch.batch_id);
    return invoiceId;
  }

  function makeFakeExceptions() {
    return {
      createOrUpdate: vi.fn(async () => ({ created: true })),
      resolve: vi.fn(async () => undefined)
    };
  }

  function makeFakeNotifications() {
    return {
      notifyConnectionExpired: vi.fn(async () => undefined),
      notifyTokenExpiring: vi.fn(async () => undefined),
      notifyNewExceptions: vi.fn(async () => undefined)
    };
  }

  function xeroClient(overrides: Record<string, unknown> = {}) {
    return {
      listChangedInvoices: vi.fn(async () => ({ records: [], hasMore: false })),
      listChangedPayments: vi.fn(async () => ({ records: [], hasMore: false })),
      listChangedCreditNotes: vi.fn(async () => ({ records: [], hasMore: false })),
      ...overrides
    };
  }

  it('stores the delivery baseline so an unchanged poll is a no-op and a material change becomes drift without touching Alga lines', async () => {
    const invoiceId = await seedInvoiceAndExport();

    const mapping = await ctx.db('tenant_external_entity_mappings')
      .where({ tenant: ctx.tenantId, integration_type: 'xero', alga_entity_type: 'invoice', alga_entity_id: invoiceId })
      .first();
    expect(mapping.metadata.exported_total).toBe(50);
    expect(mapping.metadata.doc_number).toBe('XERO-INV-1');
    expect(mapping.metadata.sync_token).toBe('2026-03-01T00:00:00.000Z');

    // Unchanged poll → no drift, token retained.
    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({
        listChangedInvoices: vi.fn(async () => ({
          records: [
            {
              InvoiceID: 'xero-invoice-1',
              InvoiceNumber: 'XERO-INV-1',
              Status: 'AUTHORISED',
              Total: 50,
              UpdatedDateUTC: '2026-03-01T00:00:00.000Z'
            }
          ],
          hasMore: false
        }))
      })
    );
    const exceptions = makeFakeExceptions();
    const first = await runAccountingSyncCycle({
      knex: ctx.db,
      tenantId: ctx.tenantId,
      adapterType: 'xero',
      targetRealm: REALM,
      adapter,
      force: true,
      exceptions: exceptions as any,
      notifications: makeFakeNotifications() as any
    });
    expect(first.status).toBe('succeeded');
    expect(exceptions.createOrUpdate).not.toHaveBeenCalled();
    const cycle = await ctx.db('accounting_sync_cycles')
      .where({ tenant: ctx.tenantId, adapter_type: 'xero', target_realm: REALM, status: 'succeeded' })
      .orderBy('started_at', 'desc')
      .first();
    expect(cycle.cursor_after).toBeTruthy();

    // Material change → drift exception, and the Alga invoice lines are intact.
    const chargeBefore = await ctx.db('invoice_charges').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).select('*');
    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({
        listChangedInvoices: vi.fn(async () => ({
          records: [
            {
              InvoiceID: 'xero-invoice-1',
              InvoiceNumber: 'XERO-INV-1-EDITED',
              Status: 'AUTHORISED',
              Total: 75,
              UpdatedDateUTC: '2026-03-02T00:00:00.000Z'
            }
          ],
          hasMore: false
        }))
      })
    );
    const driftExceptions = makeFakeExceptions();
    await runAccountingSyncCycle({
      knex: ctx.db,
      tenantId: ctx.tenantId,
      adapterType: 'xero',
      targetRealm: REALM,
      adapter,
      force: true,
      exceptions: driftExceptions as any,
      notifications: makeFakeNotifications() as any
    });
    expect(driftExceptions.createOrUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'accounting_sync_drift' })
    );
    const driftMapping = await ctx.db('tenant_external_entity_mappings')
      .where({ tenant: ctx.tenantId, integration_type: 'xero', alga_entity_type: 'invoice', alga_entity_id: invoiceId })
      .first();
    expect(driftMapping.sync_status).toBe('drift');
    const chargeAfter = await ctx.db('invoice_charges').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).select('*');
    expect(chargeAfter).toEqual(chargeBefore);
  }, HOOK_TIMEOUT);

  it('applies an external payment once, persists the AR rows, and replays without duplicate financial effect', async () => {
    await seedInvoiceAndExport();

    const paymentRecord = {
      PaymentID: 'xero-pay-1',
      Status: 'AUTHORISED',
      Amount: 50,
      Reference: 'STRIPE-1',
      Date: '2026-03-03T00:00:00.000Z',
      Invoice: { InvoiceID: 'xero-invoice-1' },
      UpdatedDateUTC: '2026-03-03T00:00:00.000Z'
    };

    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({ listChangedPayments: vi.fn(async () => ({ records: [paymentRecord], hasMore: false })) })
    );
    const first = await runAccountingSyncCycle({
      knex: ctx.db,
      tenantId: ctx.tenantId,
      adapterType: 'xero',
      targetRealm: REALM,
      adapter,
      force: true,
      exceptions: makeFakeExceptions() as any,
      notifications: makeFakeNotifications() as any
    });
    expect(first.stats?.paymentsApplied).toBe(1);

    const payments = await ctx.db('invoice_payments').where({ tenant: ctx.tenantId }).select('*');
    expect(payments).toHaveLength(1);
    expect(payments[0].payment_method).toBe('xero');
    // The provider's bookkeeping date is persisted (not "now").
    expect(new Date(payments[0].payment_date).toISOString()).toBe('2026-03-03T00:00:00.000Z');

    const ledger = new SyncMappingLedger(ctx.db, ctx.tenantId, 'xero');
    const mappingRow = await ledger.findByExternalId('invoice_payment', 'xero-pay-1', REALM);
    expect(mappingRow).toBeTruthy();

    // Replay the same change: mapping token unchanged → no second payment.
    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({ listChangedPayments: vi.fn(async () => ({ records: [paymentRecord], hasMore: false })) })
    );
    await runAccountingSyncCycle({
      knex: ctx.db,
      tenantId: ctx.tenantId,
      adapterType: 'xero',
      targetRealm: REALM,
      adapter,
      force: true,
      exceptions: makeFakeExceptions() as any,
      notifications: makeFakeNotifications() as any
    });
    const paymentsAfterReplay = await ctx.db('invoice_payments').where({ tenant: ctx.tenantId }).select('*');
    expect(paymentsAfterReplay).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('reverses a deleted external payment', async () => {
    await seedInvoiceAndExport();
    const pay = {
      PaymentID: 'xero-pay-del',
      Status: 'AUTHORISED',
      Amount: 50,
      Reference: 'STRIPE-DEL',
      Date: '2026-03-03T00:00:00.000Z',
      Invoice: { InvoiceID: 'xero-invoice-1' },
      UpdatedDateUTC: '2026-03-03T00:00:00.000Z'
    };
    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({ listChangedPayments: vi.fn(async () => ({ records: [pay], hasMore: false })) })
    );
    await runAccountingSyncCycle({
      knex: ctx.db, tenantId: ctx.tenantId, adapterType: 'xero', targetRealm: REALM,
      adapter, force: true, exceptions: makeFakeExceptions() as any, notifications: makeFakeNotifications() as any
    });

    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({ listChangedPayments: vi.fn(async () => ({ records: [{ ...pay, Status: 'DELETED' }], hasMore: false })) })
    );
    const reversed = await runAccountingSyncCycle({
      knex: ctx.db, tenantId: ctx.tenantId, adapterType: 'xero', targetRealm: REALM,
      adapter, force: true, exceptions: makeFakeExceptions() as any, notifications: makeFakeNotifications() as any
    });
    expect(reversed.stats?.paymentsReversed).toBe(1);
    const ledger = new SyncMappingLedger(ctx.db, ctx.tenantId, 'xero');
    const row = await ledger.findByExternalId('invoice_payment', 'xero-pay-del', REALM);
    expect(row?.sync_status).toBe('reversed');
  }, HOOK_TIMEOUT);

  it('runs the real allocation query: emits a deletion for a removed credit allocation, scoped to the organisation', async () => {
    await seedInvoiceAndExport();

    const now = new Date().toISOString();
    await ctx.db('tenant_external_entity_mappings').insert([
      {
        id: uuidv4(),
        tenant: ctx.tenantId,
        integration_type: 'xero',
        alga_entity_type: 'invoice_payment',
        alga_entity_id: uuidv4(),
        external_entity_id: 'creditnote:cn-1:alloc:a1',
        external_realm_id: REALM,
        sync_status: 'synced',
        metadata: { xero_credit_note_id: 'cn-1' },
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        tenant: ctx.tenantId,
        integration_type: 'xero',
        alga_entity_type: 'invoice_payment',
        alga_entity_id: uuidv4(),
        external_entity_id: 'creditnote:cn-1:alloc:other-realm',
        external_realm_id: 'xero-conn-2',
        sync_status: 'synced',
        metadata: { xero_credit_note_id: 'cn-1' },
        created_at: now,
        updated_at: now
      }
    ]);

    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({
        listChangedCreditNotes: vi.fn(async () => ({
          records: [
            {
              CreditNoteID: 'cn-1',
              CreditNoteNumber: 'CN-0001',
              Status: 'AUTHORISED',
              Total: 10,
              UpdatedDateUTC: '2026-03-04T00:00:00.000Z',
              Allocations: []
            }
          ],
          hasMore: false
        }))
      })
    );

    const result = await adapter.fetchChanges(ctx.tenantId, '2026-01-01T00:00:00Z', REALM);
    const removed = result.changes.filter((change) => change.deleted);
    expect(removed.map((change) => change.externalId)).toEqual(['creditnote:cn-1:alloc:a1']);
    // The other organisation's row is untouched.
    expect(removed.some((change) => change.externalId === 'creditnote:cn-1:alloc:other-realm')).toBe(false);
  }, HOOK_TIMEOUT);

  function creditNoteWithAllocations(allocations: any[], updatedAt = '2026-03-03T00:00:00.000Z') {
    return {
      CreditNoteID: 'replacement-cn',
      CreditNoteNumber: 'CN-REPLACE',
      Status: 'AUTHORISED',
      Total: 50,
      UpdatedDateUTC: updatedAt,
      Allocations: allocations
    };
  }

  async function runCreditNotePoll(record: any) {
    xeroCreateMock.mockResolvedValueOnce(
      xeroClient({
        listChangedCreditNotes: vi.fn(async () => ({ records: [record], hasMore: false }))
      })
    );
    return runAccountingSyncCycle({
      knex: ctx.db,
      tenantId: ctx.tenantId,
      adapterType: 'xero',
      targetRealm: REALM,
      adapter,
      force: true,
      exceptions: makeFakeExceptions() as any,
      notifications: makeFakeNotifications() as any
    });
  }

  async function invoicePaymentsTotal(invoiceId: string): Promise<number> {
    const rows = await ctx.db('invoice_payments').where({ tenant: ctx.tenantId, invoice_id: invoiceId });
    return rows.reduce((sum, row) => sum + Number(row.amount), 0);
  }

  it('counts open health exceptions only for the selected organisation', async () => {
    const exceptions = new WorkflowTaskSyncExceptionService(ctx.db, ctx.tenantId);
    const ids = [uuidv4(), uuidv4()];
    try {
      for (const [index, realm] of [REALM, 'other-xero-connection'].entries()) {
        await exceptions.createOrUpdate({
          type: 'accounting_connection_expired', entityType: 'connection', entityId: ids[index],
          title: 'Reconnect required', context: { realm, adapter_type: 'xero' }
        });
      }
      expect(await exceptions.countOpen(REALM)).toBe(1);
      expect(await exceptions.countOpen('other-xero-connection')).toBe(1);
      expect(await exceptions.countOpen('unconnected-realm')).toBe(0);
    } finally {
      await ctx.db('workflow_tasks').where({ tenant: ctx.tenantId })
        .whereRaw("context_data->>'entity_id' = ANY(?)", [ids]).del();
    }
  }, HOOK_TIMEOUT);

  it('replacing a fully settling credit allocation preserves the paid balance', async () => {
    const invoiceId = await seedInvoiceAndExport();

    const settled = await runCreditNotePoll(
      creditNoteWithAllocations(
        [{ AllocationID: 'old-allocation', Amount: 50, Date: '/Date(1772496000000+0000)/', Invoice: { InvoiceID: 'xero-invoice-1' } }],
        '2026-03-03T00:00:00.000Z'
      )
    );
    expect(settled.status).toBe('succeeded');
    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);

    const replaced = await runCreditNotePoll(
      creditNoteWithAllocations(
        [{ AllocationID: 'new-allocation', Amount: 50, Date: '/Date(1772496000000+0000)/', Invoice: { InvoiceID: 'xero-invoice-1' } }],
        '2026-03-04T00:00:00.000Z'
      )
    );
    expect(replaced.status).toBe('succeeded');

    // Net financial effect is unchanged: the replacement freed the balance by
    // reversing the old allocation BEFORE applying the new one.
    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);
    const invoice = await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first();
    expect(invoice.status).toBe('paid');

    const ledger = new SyncMappingLedger(ctx.db, ctx.tenantId, 'xero');
    expect(
      (await ledger.findByExternalId('invoice_payment', 'creditnote:replacement-cn:alloc:old-allocation', REALM))
        ?.sync_status
    ).toBe('reversed');
    expect(
      (await ledger.findByExternalId('invoice_payment', 'creditnote:replacement-cn:alloc:new-allocation', REALM))
        ?.sync_status
    ).toBe('synced');

    const transactions = await ctx.db('transactions').where({ tenant: ctx.tenantId, invoice_id: invoiceId });
    const types = transactions.map((row) => row.type);
    expect(types).toContain('payment');
    expect(types).toContain('payment_reversal');
  }, HOOK_TIMEOUT);

  it('replays a replacement without duplicate financial effect', async () => {
    const invoiceId = await seedInvoiceAndExport();
    await runCreditNotePoll(
      creditNoteWithAllocations(
        [{ AllocationID: 'old-allocation', Amount: 50, Invoice: { InvoiceID: 'xero-invoice-1' } }],
        '2026-03-03T00:00:00.000Z'
      )
    );
    const replacement = creditNoteWithAllocations(
      [{ AllocationID: 'new-allocation', Amount: 50, Invoice: { InvoiceID: 'xero-invoice-1' } }],
      '2026-03-04T00:00:00.000Z'
    );

    await runCreditNotePoll(replacement);
    await runCreditNotePoll(replacement);

    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);
    const invoice = await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first();
    expect(invoice.status).toBe('paid');
  }, HOOK_TIMEOUT);

  it('replaces multiple allocations on one invoice without netting the balance away', async () => {
    const invoiceId = await seedInvoiceAndExport();
    await runCreditNotePoll(
      creditNoteWithAllocations(
        [
          { AllocationID: 'old-1', Amount: 25, Invoice: { InvoiceID: 'xero-invoice-1' } },
          { AllocationID: 'old-2', Amount: 25, Invoice: { InvoiceID: 'xero-invoice-1' } }
        ],
        '2026-03-03T00:00:00.000Z'
      )
    );
    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);

    await runCreditNotePoll(
      creditNoteWithAllocations(
        [
          { AllocationID: 'new-1', Amount: 30, Invoice: { InvoiceID: 'xero-invoice-1' } },
          { AllocationID: 'new-2', Amount: 20, Invoice: { InvoiceID: 'xero-invoice-1' } }
        ],
        '2026-03-04T00:00:00.000Z'
      )
    );

    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);
    const invoice = await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first();
    expect(invoice.status).toBe('paid');
  }, HOOK_TIMEOUT);

  it('migrates a legacy aggregate allocation id to per-AllocationID identity without losing the balance', async () => {
    const invoiceId = await seedInvoiceAndExport();
    // Legacy: two allocations with no AllocationID → one aggregate change.
    await runCreditNotePoll({
      CreditNoteID: 'replacement-cn',
      CreditNoteNumber: 'CN-REPLACE',
      Status: 'AUTHORISED',
      Total: 50,
      UpdatedDateUTC: '2026-03-03T00:00:00.000Z',
      Allocations: [
        { Amount: 25, Invoice: { InvoiceID: 'xero-invoice-1' } },
        { Amount: 25, Invoice: { InvoiceID: 'xero-invoice-1' } }
      ]
    });
    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);
    const legacyId = 'creditnote:replacement-cn:inv:xero-invoice-1';

    // Xero now returns AllocationIDs. The aggregate is removed, the new
    // per-allocation change is applied.
    await runCreditNotePoll(
      creditNoteWithAllocations(
        [{ AllocationID: 'new-allocation', Amount: 50, Invoice: { InvoiceID: 'xero-invoice-1' } }],
        '2026-03-04T00:00:00.000Z'
      )
    );

    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);
    const ledger = new SyncMappingLedger(ctx.db, ctx.tenantId, 'xero');
    expect((await ledger.findByExternalId('invoice_payment', legacyId, REALM))?.sync_status).toBe('reversed');
    const invoice = await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first();
    expect(invoice.status).toBe('paid');
  }, HOOK_TIMEOUT);

  it('rolls back a failed replacement application and recovers after the committed reversal', async () => {
    const invoiceId = await seedInvoiceAndExport();
    await runCreditNotePoll(creditNoteWithAllocations([
      { AllocationID: 'old-allocation', Amount: 50, Invoice: { InvoiceID: 'xero-invoice-1' } }
    ]));
    const replacement = creditNoteWithAllocations([
      { AllocationID: 'new-allocation', Amount: 50, Invoice: { InvoiceID: 'xero-invoice-1' } }
    ], '2026-03-04T00:00:00.000Z');

    // Fail after the new payment/transaction writes but before their ledger
    // insert. Those writes must roll back together; the preceding reversal
    // is already committed and must not repeat when the original poll replays.
    const insert = SyncMappingLedger.prototype.insert;
    const failure = vi.spyOn(SyncMappingLedger.prototype, 'insert').mockImplementation(async function (input) {
      if (input.externalEntityId === 'creditnote:replacement-cn:alloc:new-allocation') {
        throw new Error('Injected replacement ledger failure');
      }
      return insert.call(this, input);
    });
    const failed = await runCreditNotePoll(replacement);
    failure.mockRestore();
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('Injected replacement ledger failure');
    const failedCycle = await ctx.db('accounting_sync_cycles').where({ tenant: ctx.tenantId, cycle_id: failed.cycleId }).first();
    expect(failedCycle.cursor_after).toBeNull();
    expect(await invoicePaymentsTotal(invoiceId)).toBe(0);
    expect((await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first()).status).not.toBe('paid');
    const payments = () => ctx.db('transactions').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).whereIn('type', ['payment', 'payment_reversal']);
    expect(await payments()).toHaveLength(2);

    expect((await runCreditNotePoll(replacement)).status).toBe('succeeded');
    expect((await runCreditNotePoll(replacement)).status).toBe('succeeded');
    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);
    expect((await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first()).status).toBe('paid');
    const transactions = await payments();
    expect(transactions.filter((row) => row.type === 'payment')).toHaveLength(2);
    expect(transactions.filter((row) => row.type === 'payment_reversal')).toHaveLength(1);
  }, HOOK_TIMEOUT);

  it('recovers when the replacement is split across polls (reversal then application)', async () => {
    const invoiceId = await seedInvoiceAndExport();
    await runCreditNotePoll(
      creditNoteWithAllocations(
        [{ AllocationID: 'old-allocation', Amount: 50, Invoice: { InvoiceID: 'xero-invoice-1' } }],
        '2026-03-03T00:00:00.000Z'
      )
    );

    // Poll 2: the allocation disappears entirely (reversal only).
    const reversedOnly = await runCreditNotePoll(creditNoteWithAllocations([], '2026-03-04T00:00:00.000Z'));
    expect(reversedOnly.status).toBe('succeeded');
    expect(await invoicePaymentsTotal(invoiceId)).toBe(0);
    const afterReversal = await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first();
    expect(afterReversal.status).not.toBe('paid');

    // Poll 3: the replacement arrives and settles the invoice.
    await runCreditNotePoll(
      creditNoteWithAllocations(
        [{ AllocationID: 'new-allocation', Amount: 50, Invoice: { InvoiceID: 'xero-invoice-1' } }],
        '2026-03-05T00:00:00.000Z'
      )
    );
    expect(await invoicePaymentsTotal(invoiceId)).toBe(5000);
    const finalInvoice = await ctx.db('invoices').where({ tenant: ctx.tenantId, invoice_id: invoiceId }).first();
    expect(finalInvoice.status).toBe('paid');
  }, HOOK_TIMEOUT);
});
