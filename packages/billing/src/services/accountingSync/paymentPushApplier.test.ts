import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: {
    create: vi.fn()
  }
}));

vi.mock('./accountingSyncSettings', () => ({
  getDepositAccountRef: vi.fn(async () => null)
}));

import { drainRecordPaymentOps } from './paymentPushApplier';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- mocks the QuickBooks client the applier bridges to
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getDepositAccountRef } from './accountingSyncSettings';
import { emptyCycleStats } from './accountingSync.types';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFakeLedger(overrides: Partial<Record<string, any>> = {}) {
  const base: any = {
    findByAlgaId: vi.fn(async () => undefined),
    findByExternalId: vi.fn(async () => undefined),
    insert: vi.fn(async () => ({})),
    update: vi.fn(async () => undefined),
    withKnex: vi.fn().mockReturnThis()
  };
  return { ...base, ...overrides };
}

function makeFakeOps(pendingOps: any[] = []) {
  return {
    listPending: vi.fn(async () => pendingOps),
    markInProgress: vi.fn(async () => undefined),
    markDone: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => 'pending'),
    enqueue: vi.fn(async () => ({})),
    satisfyPending: vi.fn(async () => 0)
  };
}

function makeFakeExceptions() {
  return {
    createOrUpdate: vi.fn(async () => ({ created: true })),
    resolve: vi.fn(async () => undefined)
  };
}

/** Build a fake knex that can answer invoices+mappings queries. */
function makeKnex(invoiceRow: { client_id: string } | null = { client_id: 'client-1' }) {
  const first = vi.fn(async () => invoiceRow);
  const select = vi.fn(() => ({ first }));
  const where = vi.fn(() => ({ select }));
  const table = vi.fn(() => ({ where }));
  return Object.assign(table, { fn: { now: vi.fn() } }) as any;
}

function makeQboClient(paymentResponse: any = { Id: 'qbo-pay-1', SyncToken: '5' }) {
  return {
    create: vi.fn(async () => paymentResponse),
    read: vi.fn(async () => null)
  };
}

function makePendingOp(overrides: Partial<any> = {}): any {
  return {
    op_id: 'op-rp-1',
    alga_entity_id: 'pay-alga-1',
    attempts: 0,
    payload: {
      invoiceId: 'inv-1',
      amountCents: 5000,
      referenceNumber: 'ch_stripe_abc',
      provider: 'stripe'
    },
    ...overrides
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('drainRecordPaymentOps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDepositAccountRef).mockResolvedValue(null);
  });

  it('does nothing when no pending ops', async () => {
    const ops = makeFakeOps([]);
    const qboClient = makeQboClient();
    vi.mocked(QboClientService.create).mockResolvedValue(qboClient as any);

    const stats = emptyCycleStats();
    await drainRecordPaymentOps({
      knex: makeKnex(),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: ops as any,
      ledger: makeFakeLedger() as any,
      exceptions: makeFakeExceptions() as any,
      stats
    });

    expect(QboClientService.create).not.toHaveBeenCalled();
    expect(stats.opsProcessed).toBe(0);
  });

  it('happy path: creates QBO Payment with correct CustomerRef, LinkedTxn, PaymentRefNum', async () => {
    const invoiceMapping = {
      id: 'imap-1',
      alga_entity_id: 'inv-1',
      external_entity_id: 'qbo-inv-100',
      sync_status: 'synced',
      metadata: {}
    };
    const customerMapping = {
      id: 'cmap-1',
      alga_entity_id: 'client-1',
      external_entity_id: 'qbo-cust-200',
      sync_status: 'synced',
      metadata: {}
    };

    const ledger = makeFakeLedger({
      findByAlgaId: vi.fn()
        .mockResolvedValueOnce(undefined)      // invoice_payment mapping (idempotency check)
        .mockResolvedValueOnce(invoiceMapping) // invoice mapping
        .mockResolvedValueOnce(customerMapping) // client mapping
    });

    const qboClient = makeQboClient({ Id: 'qbo-pay-999', SyncToken: '7' });
    vi.mocked(QboClientService.create).mockResolvedValue(qboClient as any);

    const ops = makeFakeOps([makePendingOp()]);
    const stats = emptyCycleStats();

    await drainRecordPaymentOps({
      knex: makeKnex({ client_id: 'client-1' }),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions() as any,
      stats
    });

    expect(qboClient.create).toHaveBeenCalledWith(
      'Payment',
      expect.objectContaining({
        CustomerRef: { value: 'qbo-cust-200' },
        TotalAmt: 50, // 5000 cents → 50.00
        PaymentRefNum: 'ch_stripe_abc',
        Line: [
          expect.objectContaining({
            Amount: 50,
            LinkedTxn: [{ TxnId: 'qbo-inv-100', TxnType: 'Invoice' }]
          })
        ]
      })
    );
    expect(stats.opsProcessed).toBe(1);
    expect(ops.markDone).toHaveBeenCalledWith('t1', 'op-rp-1');
  });

  it('truncates PaymentRefNum to 21 characters', async () => {
    const longRef = 'ch_' + 'x'.repeat(30); // 33 chars
    const invoiceMapping = { id: 'im', alga_entity_id: 'inv-1', external_entity_id: 'qbo-inv-1', sync_status: 'synced', metadata: {} };
    const customerMapping = { id: 'cm', alga_entity_id: 'client-1', external_entity_id: 'qbo-cust-1', sync_status: 'synced', metadata: {} };

    const ledger = makeFakeLedger({
      findByAlgaId: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(invoiceMapping)
        .mockResolvedValueOnce(customerMapping)
    });
    const qboClient = makeQboClient();
    vi.mocked(QboClientService.create).mockResolvedValue(qboClient as any);

    await drainRecordPaymentOps({
      knex: makeKnex(),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: makeFakeOps([makePendingOp({ payload: { invoiceId: 'inv-1', amountCents: 1000, referenceNumber: longRef, provider: 'stripe' } })]) as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions() as any,
      stats: emptyCycleStats()
    });

    const createCall = (qboClient.create.mock.calls[0] as any)[1] as any;
    expect(createCall.PaymentRefNum.length).toBe(21);
    expect(createCall.PaymentRefNum).toBe(longRef.slice(0, 21));
  });

  it('includes DepositToAccountRef when deposit account is configured', async () => {
    vi.mocked(getDepositAccountRef).mockResolvedValue({ value: 'acc-42', name: 'Checking' });

    const invoiceMapping = { id: 'im', alga_entity_id: 'inv-1', external_entity_id: 'qbo-inv-1', sync_status: 'synced', metadata: {} };
    const customerMapping = { id: 'cm', alga_entity_id: 'client-1', external_entity_id: 'qbo-cust-1', sync_status: 'synced', metadata: {} };

    const ledger = makeFakeLedger({
      findByAlgaId: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(invoiceMapping)
        .mockResolvedValueOnce(customerMapping)
    });
    const qboClient = makeQboClient();
    vi.mocked(QboClientService.create).mockResolvedValue(qboClient as any);

    await drainRecordPaymentOps({
      knex: makeKnex(),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: makeFakeOps([makePendingOp()]) as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions() as any,
      stats: emptyCycleStats()
    });

    const createCall = (qboClient.create.mock.calls[0] as any)[1] as any;
    expect(createCall.DepositToAccountRef).toEqual({ value: 'acc-42' });
  });

  it('omits DepositToAccountRef when deposit account is not configured', async () => {
    vi.mocked(getDepositAccountRef).mockResolvedValue(null);

    const invoiceMapping = { id: 'im', alga_entity_id: 'inv-1', external_entity_id: 'qbo-inv-1', sync_status: 'synced', metadata: {} };
    const customerMapping = { id: 'cm', alga_entity_id: 'client-1', external_entity_id: 'qbo-cust-1', sync_status: 'synced', metadata: {} };

    const ledger = makeFakeLedger({
      findByAlgaId: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(invoiceMapping)
        .mockResolvedValueOnce(customerMapping)
    });
    const qboClient = makeQboClient();
    vi.mocked(QboClientService.create).mockResolvedValue(qboClient as any);

    await drainRecordPaymentOps({
      knex: makeKnex(),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: makeFakeOps([makePendingOp()]) as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions() as any,
      stats: emptyCycleStats()
    });

    const createCall = (qboClient.create.mock.calls[0] as any)[1] as any;
    expect(createCall).not.toHaveProperty('DepositToAccountRef');
  });

  it('idempotent: existing invoice_payment mapping → markDone, no QBO call', async () => {
    const existingMapping = {
      id: 'pm-1',
      alga_entity_id: 'pay-alga-1',
      external_entity_id: 'qbo-pay-old',
      sync_status: 'synced',
      metadata: { sync_token: '3', pushed: true }
    };

    const ledger = makeFakeLedger({
      findByAlgaId: vi.fn().mockResolvedValueOnce(existingMapping) // invoice_payment mapping exists
    });
    const qboClient = makeQboClient();
    vi.mocked(QboClientService.create).mockResolvedValue(qboClient as any);

    const ops = makeFakeOps([makePendingOp()]);
    const stats = emptyCycleStats();

    await drainRecordPaymentOps({
      knex: makeKnex(),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions() as any,
      stats
    });

    expect(qboClient.create).not.toHaveBeenCalled();
    expect(ops.markDone).toHaveBeenCalledWith('t1', 'op-rp-1');
    expect(stats.opsProcessed).toBe(1);
  });

  it('missing invoice mapping → markFailed', async () => {
    const ledger = makeFakeLedger({
      findByAlgaId: vi.fn()
        .mockResolvedValueOnce(undefined)  // invoice_payment: not found
        .mockResolvedValueOnce(undefined)  // invoice mapping: not found
    });
    const qboClient = makeQboClient();
    vi.mocked(QboClientService.create).mockResolvedValue(qboClient as any);

    const ops = makeFakeOps([makePendingOp()]);
    const stats = emptyCycleStats();

    await drainRecordPaymentOps({
      knex: makeKnex(),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions() as any,
      stats
    });

    expect(qboClient.create).not.toHaveBeenCalled();
    expect(ops.markFailed).toHaveBeenCalledWith('t1', 'op-rp-1', expect.any(String));
    expect(stats.opsFailed).toBe(1);
  });

  it('success writes mapping row with sync_token as string', async () => {
    const invoiceMapping = { id: 'im', alga_entity_id: 'inv-1', external_entity_id: 'qbo-inv-1', sync_status: 'synced', metadata: {} };
    const customerMapping = { id: 'cm', alga_entity_id: 'client-1', external_entity_id: 'qbo-cust-1', sync_status: 'synced', metadata: {} };

    const ledger = makeFakeLedger({
      findByAlgaId: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(invoiceMapping)
        .mockResolvedValueOnce(customerMapping)
    });

    // SyncToken as a number (QBO sometimes returns numeric strings)
    vi.mocked(QboClientService.create).mockResolvedValue(
      makeQboClient({ Id: 'qbo-pay-42', SyncToken: 9 }) as any
    );

    const ops = makeFakeOps([makePendingOp()]);

    await drainRecordPaymentOps({
      knex: makeKnex(),
      tenantId: 't1',
      adapterType: 'quickbooks_online',
      targetRealm: 'r1',
      ops: ops as any,
      ledger: ledger as any,
      exceptions: makeFakeExceptions() as any,
      stats: emptyCycleStats()
    });

    expect(ledger.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        algaEntityType: 'invoice_payment',
        algaEntityId: 'pay-alga-1',
        externalEntityId: 'qbo-pay-42',
        metadata: expect.objectContaining({
          sync_token: '9', // must be a string
          pushed: true,
          allocations: expect.arrayContaining([
            expect.objectContaining({
              algaPaymentId: 'pay-alga-1',
              amountCents: 5000
            })
          ])
        })
      })
    );
  });
});
