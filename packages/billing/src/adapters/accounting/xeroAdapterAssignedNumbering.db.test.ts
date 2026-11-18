import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../actions/_dbTestUtils';
import { XeroAdapter } from './xeroAdapter';
import type { AccountingExportAdapterContext, AccountingExportTransformResult } from '@alga-psa/types';

/**
 * alga-2026-0002746: Xero-assigned invoice numbers. Drives XeroAdapter.deliver
 * against the real schema with the Xero client mocked: the settle step (number
 * write-back, PDF rename, mapping metadata), the unique-conflict path, Reference
 * recovery after a lost response, duplicate references and a missing number.
 */

const createInvoicesSpy = vi.hoisted(() => vi.fn());
const findByReferenceSpy = vi.hoisted(() => vi.fn());
const publishEventSpy = vi.hoisted(() => vi.fn(async () => undefined));
const startAutopaySpy = vi.hoisted(() => vi.fn(async () => undefined));
const afterCommitHooks = vi.hoisted(() => [] as Array<() => unknown>);

const refs = vi.hoisted(() => ({ knex: null as any, tenant: '' as string }));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: refs.knex, tenant: refs.tenant })),
    withTransaction: vi.fn(async (knex: Knex, callback: (trx: Knex) => Promise<unknown>) => callback(knex)),
    registerAfterCommit: vi.fn((_trx: unknown, hook: () => unknown) => {
      afterCommitHooks.push(hook);
    }),
  };
});

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: unknown[]) => (publishEventSpy as any)(...args),
}));

vi.mock('../../services/autopayBridge', () => ({
  startInvoiceAutopay: (...args: unknown[]) => (startAutopaySpy as any)(...args),
}));

vi.mock('@alga-psa/integrations/lib/xero/xeroClientService', () => ({
  XeroClientService: {
    create: vi.fn(async () => ({
      createInvoices: createInvoicesSpy,
      findInvoicesByReference: findByReferenceSpy,
    })),
  },
}));

const tenantId = uuidv4();
const userId = uuidv4();
const clientId = uuidv4();
const REALM = 'conn-realm-1';
const CONTACT = 'xero-contact-1';

let db: Knex;
let adapter: XeroAdapter;

function makeContext(lineIds: string[]): AccountingExportAdapterContext {
  return {
    batch: {
      tenant: tenantId,
      batch_id: 'batch-xero-num',
      adapter_type: 'xero',
      target_realm: REALM,
      export_type: 'invoice',
      status: 'pending',
      queued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    lines: lineIds.map((id) => ({ line_id: id, document_id: 'x', document_line_id: 'c' })),
  } as unknown as AccountingExportAdapterContext;
}

async function seedInvoice(opts: {
  number: string;
  source?: 'alga' | 'pending_external' | 'external';
  withPdf?: boolean;
}) {
  const invoiceId = uuidv4();
  await db('invoices').insert({
    invoice_id: invoiceId, tenant: tenantId, client_id: clientId, invoice_number: opts.number,
    invoice_date: new Date().toISOString(), due_date: new Date().toISOString(),
    total_amount: 1000, subtotal: 1000, tax: 0, status: 'sent', finalized_at: new Date().toISOString(),
    is_manual: true, is_prepayment: false, credit_applied: 0,
    invoice_number_source: opts.source ?? 'pending_external',
  });
  let documentId: string | null = null;
  if (opts.withPdf !== false) {
    documentId = uuidv4();
    await db('documents').insert({
      tenant: tenantId, document_id: documentId, document_name: `Invoice_${opts.number}.pdf`,
      user_id: userId, created_by: userId, is_client_visible: false,
    });
    await db('document_associations').insert({
      tenant: tenantId, association_id: uuidv4(), document_id: documentId, entity_id: invoiceId, entity_type: 'invoice',
    });
  }
  return { invoiceId, documentId };
}

function transformFor(
  invoiceId: string,
  provisional: string,
  overrides: { externalInvoiceId?: string | null; numberSource?: string } = {}
): AccountingExportTransformResult {
  const lineId = uuidv4();
  const payload = {
    tenantId,
    connectionId: REALM,
    invoice: {
      invoiceId,
      externalInvoiceId: overrides.externalInvoiceId ?? null,
      contactId: CONTACT,
      currency: 'USD',
      invoiceNumber: null,
      reference: provisional,
      amountCents: 1000,
      lines: [{ lineId: 'l1', quantity: 1, unitAmountCents: 1000, amountCents: 1000, description: 'Consulting' }],
    },
    chargeIds: ['c1'],
    chargeLineage: [{ parentChargeId: 'c1' }],
    numberSource: overrides.numberSource ?? 'pending_external',
    provisionalInvoiceNumber: provisional,
    invoiceUpdatedAt: new Date().toISOString(),
    mapping: { clientId },
  };
  return { documents: [{ documentId: invoiceId, lineIds: [lineId], payload }], metadata: {} } as unknown as AccountingExportTransformResult;
}

const created = (invoiceId: string, xeroInvoiceId: string, number: string | undefined) => ({
  status: 'success',
  invoiceId: xeroInvoiceId,
  documentId: invoiceId,
  invoiceNumber: number,
  raw: { InvoiceID: xeroInvoiceId, ...(number ? { InvoiceNumber: number } : {}), Total: 10, LineItems: [{ LineItemID: 'xero-line-1' }] },
});

const mappingFor = (invoiceId: string) =>
  db('tenant_external_entity_mappings')
    .where({ tenant: tenantId, alga_entity_type: 'invoice', alga_entity_id: invoiceId, integration_type: 'xero' })
    .first();

const invoiceRow = (invoiceId: string) => db('invoices').where({ tenant: tenantId, invoice_id: invoiceId }).first();

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  refs.knex = db;
  refs.tenant = tenantId;
  adapter = new XeroAdapter();

  await db('tenants').insert({
    tenant: tenantId, client_name: 'Xero Numbering Test',
    email: `xero-num-${tenantId.slice(0, 8)}@example.com`, created_at: db.fn.now(), updated_at: db.fn.now(),
  });
  await db('clients').insert({ tenant: tenantId, client_id: clientId, client_name: 'Acme Pty' });
  await db('users').insert({
    tenant: tenantId, user_id: userId, username: `xnum-${userId.slice(0, 8)}`, first_name: 'X', last_name: 'Num',
    email: `xnum-${userId.slice(0, 8)}@test.local`, hashed_password: 'x', user_type: 'internal', is_inactive: false,
  });
});

beforeEach(() => {
  createInvoicesSpy.mockReset();
  findByReferenceSpy.mockReset();
  findByReferenceSpy.mockResolvedValue([]);
  publishEventSpy.mockClear();
  startAutopaySpy.mockClear();
  afterCommitHooks.length = 0;
});

afterAll(async () => {
  for (const table of ['document_associations', 'documents', 'tenant_external_entity_mappings', 'invoices', 'users', 'clients']) {
    await db(table).where({ tenant: tenantId }).del().catch(() => undefined);
  }
  await db('tenants').where({ tenant: tenantId }).del().catch(() => undefined);
  await db.destroy().catch(() => undefined);
});

describe('XeroAdapter Xero-assigned numbering delivery', () => {
  it('rejects values outside the invoice_number_source CHECK constraint', async () => {
    const { invoiceId } = await seedInvoice({ number: 'CHK-1', source: 'alga', withPdf: false });
    await expect(
      db('invoices').where({ tenant: tenantId, invoice_id: invoiceId }).update({ invoice_number_source: 'bogus' })
    ).rejects.toThrow();
  });

  it('a successful create writes the Xero number, marks external, renames the PDF and fills the mapping metadata', async () => {
    const { invoiceId, documentId } = await seedInvoice({ number: 'PROV-000001' });
    const transform = transformFor(invoiceId, 'PROV-000001');
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-inv-1', 'INV-0042')]);

    const result = await adapter.deliver(transform, makeContext(transform.documents[0].lineIds));

    expect(result.failedDocuments).toBeUndefined();
    expect(result.deliveredLines).toHaveLength(1);

    // Reference lookup ran once for the pending create; the POST carried a key and no number.
    expect(findByReferenceSpy).toHaveBeenCalledTimes(1);
    expect(findByReferenceSpy).toHaveBeenCalledWith(['PROV-000001']);
    const [postedPayloads, options] = createInvoicesSpy.mock.calls[0];
    expect(postedPayloads[0].invoiceNumber).toBeNull();
    expect(postedPayloads[0].reference).toBe('PROV-000001');
    expect(typeof options.idempotencyKey).toBe('string');
    expect(options.idempotencyKey.length).toBeLessThanOrEqual(128);

    const invoice = await invoiceRow(invoiceId);
    expect(invoice.invoice_number).toBe('INV-0042');
    expect(invoice.invoice_number_source).toBe('external');

    const doc = await db('documents').where({ tenant: tenantId, document_id: documentId }).first();
    expect(doc.document_name).toBe('Invoice_INV-0042.pdf');

    const mapping = await mappingFor(invoiceId);
    expect(mapping.external_entity_id).toBe('xero-inv-1');
    const metadata = typeof mapping.metadata === 'string' ? JSON.parse(mapping.metadata) : mapping.metadata;
    expect(metadata.doc_number).toBe('INV-0042');
    expect(metadata.algaInvoiceNumber).toBe('INV-0042');
    expect(metadata.provisionalAlgaInvoiceNumber).toBe('PROV-000001');

    // Event + deferred autopay run only after commit.
    expect(publishEventSpy).not.toHaveBeenCalled();
    expect(afterCommitHooks).toHaveLength(1);
    await afterCommitHooks[0]();
    expect(publishEventSpy).toHaveBeenCalledWith({
      eventType: 'INVOICE_NUMBER_ASSIGNED',
      payload: expect.objectContaining({
        tenantId, invoiceId, previousNumber: 'PROV-000001', invoiceNumber: 'INV-0042', source: 'xero',
      }),
    });
    expect(startAutopaySpy).toHaveBeenCalledWith(db, tenantId, invoiceId);
  });

  it('a unique-number conflict keeps the mapping, leaves the invoice pending, reports XERO_NUMBER_CONFLICT, and a retry settles once cleared', async () => {
    const other = await seedInvoice({ number: 'INV-0100', source: 'alga', withPdf: false });
    const { invoiceId, documentId } = await seedInvoice({ number: 'PROV-000002' });
    const transform = transformFor(invoiceId, 'PROV-000002');
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-inv-2', 'INV-0100')]);

    const result = await adapter.deliver(transform, makeContext(transform.documents[0].lineIds));

    expect(result.deliveredLines).toHaveLength(0);
    expect(result.failedDocuments).toHaveLength(1);
    expect(result.failedDocuments![0].code).toBe('XERO_NUMBER_CONFLICT');
    expect(result.failedDocuments![0].message).toContain('Xero numbered this invoice INV-0100');
    expect(result.failedDocuments![0].message).toContain('Rename one of them, then retry the export.');
    // Lets the export service mark the batch needs_attention instead of failed.
    expect(result.failedDocuments![0].metadata?.remoteDocumentCreated).toBe(true);

    expect((await mappingFor(invoiceId)).external_entity_id).toBe('xero-inv-2');
    const pending = await invoiceRow(invoiceId);
    expect(pending.invoice_number).toBe('PROV-000002');
    expect(pending.invoice_number_source).toBe('pending_external');
    expect((await db('documents').where({ tenant: tenantId, document_id: documentId }).first()).document_name)
      .toBe('Invoice_PROV-000002.pdf');
    expect(afterCommitHooks).toHaveLength(0);

    // Clear the conflict, then retry: the mapping makes it an update by InvoiceID.
    await db('invoices').where({ tenant: tenantId, invoice_id: other.invoiceId }).update({ invoice_number: 'INV-0100-renamed' });
    createInvoicesSpy.mockReset();
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-inv-2', 'INV-0100')]);
    const retry = await adapter.deliver(
      transformFor(invoiceId, 'PROV-000002', { externalInvoiceId: 'xero-inv-2' }),
      makeContext(['l'])
    );
    expect(retry.failedDocuments).toBeUndefined();
    expect(createInvoicesSpy.mock.calls[0][0][0].externalInvoiceId).toBe('xero-inv-2');
    const settled = await invoiceRow(invoiceId);
    expect(settled.invoice_number).toBe('INV-0100');
    expect(settled.invoice_number_source).toBe('external');
  });

  it('after a lost response the Reference lookup adopts the existing Xero invoice; no second create', async () => {
    const { invoiceId } = await seedInvoice({ number: 'PROV-000003' });
    const transform = transformFor(invoiceId, 'PROV-000003');
    findByReferenceSpy.mockResolvedValue([
      {
        invoiceId: 'xero-existing', invoiceNumber: 'INV-0200', reference: 'PROV-000003', status: 'DRAFT',
        total: 1000, totalTax: 0, subTotal: 1000, lineItems: [{ lineItemId: 'xero-line-9' }],
        raw: { Contact: { ContactID: CONTACT } },
      },
    ]);
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-existing', 'INV-0200')]);

    const result = await adapter.deliver(transform, makeContext(transform.documents[0].lineIds));

    expect(result.failedDocuments).toBeUndefined();
    expect(createInvoicesSpy).toHaveBeenCalledTimes(1);
    const [payloads, options] = createInvoicesSpy.mock.calls[0];
    expect(payloads[0].externalInvoiceId).toBe('xero-existing');
    expect(payloads[0].lines[0].externalLineItemId).toBe('xero-line-9');
    expect(payloads[0].invoiceNumber).toBeNull();
    // An adopted create is an update: no Idempotency-Key for it.
    expect(options.idempotencyKey).toBeUndefined();
    expect((await invoiceRow(invoiceId)).invoice_number).toBe('INV-0200');
  });

  it('ignores deleted/voided matches and creates normally', async () => {
    const { invoiceId } = await seedInvoice({ number: 'PROV-000004' });
    const transform = transformFor(invoiceId, 'PROV-000004');
    findByReferenceSpy.mockResolvedValue([
      { invoiceId: 'x-old', reference: 'PROV-000004', status: 'VOIDED', lineItems: [], total: 0, totalTax: 0, subTotal: 0, raw: { Contact: { ContactID: CONTACT } } },
    ]);
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-new', 'INV-0300')]);

    await adapter.deliver(transform, makeContext(transform.documents[0].lineIds));

    expect(createInvoicesSpy.mock.calls[0][0][0].externalInvoiceId).toBeNull();
    expect((await invoiceRow(invoiceId)).invoice_number).toBe('INV-0300');
  });

  it('more than one Reference match gives XERO_DUPLICATE_REFERENCE and posts nothing', async () => {
    const { invoiceId } = await seedInvoice({ number: 'PROV-000005' });
    const transform = transformFor(invoiceId, 'PROV-000005');
    const match = (id: string) => ({
      invoiceId: id, invoiceNumber: `INV-${id}`, reference: 'PROV-000005', status: 'DRAFT',
      lineItems: [], total: 0, totalTax: 0, subTotal: 0, raw: { Contact: { ContactID: CONTACT } },
    });
    findByReferenceSpy.mockResolvedValue([match('a'), match('b')]);

    const result = await adapter.deliver(transform, makeContext(transform.documents[0].lineIds));

    expect(createInvoicesSpy).not.toHaveBeenCalled();
    expect(result.deliveredLines).toHaveLength(0);
    expect(result.failedDocuments).toHaveLength(1);
    expect(result.failedDocuments![0].code).toBe('XERO_DUPLICATE_REFERENCE');
    expect(result.failedDocuments![0].metadata?.xeroInvoiceIds).toEqual(['a', 'b']);
    expect(await mappingFor(invoiceId)).toBeUndefined();
    expect((await invoiceRow(invoiceId)).invoice_number_source).toBe('pending_external');
  });

  it('a response with no number gives XERO_NUMBER_NOT_RETURNED, keeps the mapping, and the next delivery settles', async () => {
    const { invoiceId } = await seedInvoice({ number: 'PROV-000006' });
    const transform = transformFor(invoiceId, 'PROV-000006');
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-inv-6', undefined)]);

    const result = await adapter.deliver(transform, makeContext(transform.documents[0].lineIds));

    expect(result.failedDocuments).toHaveLength(1);
    expect(result.failedDocuments![0].code).toBe('XERO_NUMBER_NOT_RETURNED');
    expect(result.failedDocuments![0].metadata?.remoteDocumentCreated).toBe(true);
    expect((await mappingFor(invoiceId)).external_entity_id).toBe('xero-inv-6');
    const pending = await invoiceRow(invoiceId);
    expect(pending.invoice_number).toBe('PROV-000006');
    expect(pending.invoice_number_source).toBe('pending_external');

    createInvoicesSpy.mockReset();
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-inv-6', 'INV-0400')]);
    const retry = await adapter.deliver(
      transformFor(invoiceId, 'PROV-000006', { externalInvoiceId: 'xero-inv-6' }),
      makeContext(['l'])
    );
    expect(retry.failedDocuments).toBeUndefined();
    const settled = await invoiceRow(invoiceId);
    expect(settled.invoice_number).toBe('INV-0400');
    expect(settled.invoice_number_source).toBe('external');
    // No lookup for an update.
    expect(findByReferenceSpy).toHaveBeenCalledTimes(1);
  });

  it('never settles, looks up or sends a key for an alga-numbered invoice', async () => {
    const { invoiceId } = await seedInvoice({ number: 'INV-ALGA-1', source: 'alga', withPdf: false });
    const transform = transformFor(invoiceId, 'INV-ALGA-1', { numberSource: 'alga' });
    (transform.documents[0].payload as any).invoice.invoiceNumber = 'INV-ALGA-1';
    createInvoicesSpy.mockResolvedValue([created(invoiceId, 'xero-inv-a', 'INV-ALGA-1')]);

    const result = await adapter.deliver(transform, makeContext(transform.documents[0].lineIds));

    expect(result.failedDocuments).toBeUndefined();
    expect(findByReferenceSpy).not.toHaveBeenCalled();
    expect(createInvoicesSpy.mock.calls[0][1].idempotencyKey).toBeUndefined();
    const row = await invoiceRow(invoiceId);
    expect(row.invoice_number).toBe('INV-ALGA-1');
    expect(row.invoice_number_source).toBe('alga');
    expect(afterCommitHooks).toHaveLength(0);
  });
});
