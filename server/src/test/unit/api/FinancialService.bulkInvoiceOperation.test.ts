/**
 * FinancialService.bulkInvoiceOperation — lifecycle authority + canonical dispatch
 * (alga-2026-0003005).
 *
 * Before the fix this method gated on invoice:update only and wrote
 * `status='sent'/'cancelled'` with raw UPDATEs, bypassing invoice:finalize and
 * every canonical invariant. These tests run the REAL FinancialService and the
 * REAL InvoiceService dispatch/void wiring against an in-memory invoices table
 * (so a raw UPDATE from the bulk method is visible as state change) and mock only
 * the leaf collaborators: RBAC, the finalize engine, the void core and the
 * accounting/event side channels.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
  invoices: {} as Record<string, any>,
  /** Every write that reached the `invoices` table through tenantDb (i.e. not through a mocked engine). */
  rawInvoiceUpdates: [] as Array<{ filters: any; data: any }>,
  audit: [] as any[],
  connected: false,
  exportInProgress: false,
  blocker: null as string | null,
  voidOutcome: { ok: true } as { ok: true } | { ok: false; error: string },
}));

const mocks = vi.hoisted(() => ({
  finalizeEngine: vi.fn(),
  voidCore: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('../../../lib/auth/rbac', () => ({
  hasPermission: (...args: any[]) => mocks.hasPermission(...args),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  const table = (name: string) => {
    const filters: Record<string, any> = {};
    const b: any = {
      where: (a: any, v?: any) => {
        if (typeof a === 'object') Object.assign(filters, a);
        else filters[a] = v;
        return b;
      },
      forUpdate: () => b,
      first: async () => {
        if (name === 'invoices') {
          const row = state.invoices[filters.invoice_id];
          return row ? { ...row } : undefined;
        }
        return undefined;
      },
      update: (data: any) => {
        if (name === 'invoices') {
          state.rawInvoiceUpdates.push({ filters: { ...filters }, data });
          const row = state.invoices[filters.invoice_id];
          if (row) Object.assign(row, data);
        }
        const p: any = Promise.resolve(1);
        p.returning = async () => [state.invoices[filters.invoice_id]];
        return p;
      },
    };
    return b;
  };
  return {
    ...actual,
    withTransaction: async (_knex: unknown, cb: (trx: unknown) => unknown) => cb({}),
    tenantDb: () => ({ table }),
    writeAccountingAudit: vi.fn(),
  };
});

vi.mock('../../../lib/logging/auditLog', () => ({
  auditLog: vi.fn(async (_trx: unknown, params: any) => {
    state.audit.push(params);
  }),
}));
vi.mock('../../../lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));

vi.mock('@alga-psa/billing/actions/invoiceModification', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  finalizeInvoiceWithKnex: (...args: any[]) => mocks.finalizeEngine(...args),
}));
vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: { getInvoiceCharges: vi.fn(async () => [{ item_id: 'li-1' }]) },
}));
vi.mock('@alga-psa/billing/lib/invoiceVoidCore', () => ({
  findLocalVoidBlocker: vi.fn(async () => state.blocker),
  voidInvoiceLocally: (...args: any[]) => mocks.voidCore(...args),
}));
vi.mock('@alga-psa/billing/services/accountingSync/invoiceExportGuards', () => ({
  assertInvoiceNotExported: vi.fn(),
  findInvoiceExportInProgress: vi.fn(async () => state.exportInProgress),
}));
vi.mock('@alga-psa/billing/services/accountingSync/accountingSyncSettings', () => ({
  hasConnectedQboRealm: vi.fn(async () => state.connected),
}));
vi.mock('@alga-psa/billing/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceVoid: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services/autopayBridge', () => ({
  signalAutopayInvoiceSettled: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  notifyInvoiceTerminalStatus: vi.fn(async () => undefined),
}));

import { FinancialService } from '../../../lib/api/services/FinancialService';
import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { bulkInvoiceOperationSchema } from '../../../lib/api/schemas/financialSchemas';

const TENANT = 'tenant-1';
const DRAFT = '11111111-1111-4111-8111-111111111111';
const SENT = '22222222-2222-4222-8222-222222222222';
const PAID = '33333333-3333-4333-8333-333333333333';
const FINAL = '44444444-4444-4444-8444-444444444444';

const VOID_REMOTE_MUTATE_DENIAL =
  'Permission denied: voiding invoices while the accounting integration is connected requires the accounting remote-mutate permission.';

function seedInvoices() {
  state.invoices = {
    [DRAFT]: { invoice_id: DRAFT, client_id: 'c1', status: 'draft', finalized_at: null, total_amount: 100 },
    [SENT]: { invoice_id: SENT, client_id: 'c1', status: 'sent', finalized_at: '2026-01-01', total_amount: 100 },
    [PAID]: { invoice_id: PAID, client_id: 'c1', status: 'paid', finalized_at: '2026-01-01', total_amount: 100 },
    [FINAL]: { invoice_id: FINAL, client_id: 'c1', status: 'sent', finalized_at: '2026-01-01', total_amount: 100 },
  };
}

function grant(...perms: string[]) {
  state.granted = new Set(perms);
}

function makeContext() {
  return { tenant: TENANT, userId: 'user-1', user: { user_id: 'user-1', user_type: 'internal' } } as any;
}

function bulk(op: 'finalize' | 'send' | 'cancel', ids: string[], parameters?: Record<string, any>) {
  const svc = new FinancialService();
  vi.spyOn(svc as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: TENANT });
  return svc.bulkInvoiceOperation({ invoice_ids: ids, operation: op, parameters } as any, makeContext());
}

describe('FinancialService.bulkInvoiceOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedInvoices();
    state.rawInvoiceUpdates = [];
    state.audit = [];
    state.connected = false;
    state.exportInProgress = false;
    state.blocker = null;
    state.voidOutcome = { ok: true };
    grant('invoice:update', 'invoice:finalize', 'invoice:send', 'accounting_integrations:remote_mutate');

    mocks.hasPermission.mockImplementation(async (_user: any, resource: string, action: string) =>
      state.granted.has(`${resource}:${action}`)
    );
    // The canonical finalize engine: flips draft -> sent, stamps finalized_at, writes its own audit row.
    mocks.finalizeEngine.mockImplementation(async (invoiceId: string) => {
      state.invoices[invoiceId].status = 'sent';
      state.invoices[invoiceId].finalized_at = '2026-10-31T00:00:00.000Z';
      state.audit.push({ operation: 'finalize', recordId: invoiceId, details: { action: 'invoice.finalized' } });
      return { warnings: [] };
    });
    // The void core: flips to cancelled unless a state-controlled refusal is set.
    mocks.voidCore.mockImplementation(async (_trx: any, _tenant: string, params: any) => {
      if (!state.voidOutcome.ok) return state.voidOutcome;
      state.invoices[params.invoice.invoice_id].status = 'cancelled';
      return { ok: true };
    });

    vi.spyOn(InvoiceService.prototype as any, 'getKnex').mockResolvedValue({ knex: {}, tenant: TENANT });
    vi.spyOn(InvoiceService.prototype as any, 'getInvoiceRecurringProvenance').mockResolvedValue(null);
    vi.spyOn(InvoiceService.prototype, 'getById').mockImplementation(
      async (id: string) => ({ ...state.invoices[id] }) as any
    );
  });

  describe('lifecycle authority (the regression)', () => {
    it('refuses finalize for a principal with invoice:update but WITHOUT invoice:finalize; invoice stays draft', async () => {
      grant('invoice:update');

      await expect(bulk('finalize', [DRAFT])).rejects.toMatchObject({ statusCode: 403 });

      expect(state.invoices[DRAFT].status).toBe('draft');
      expect(state.invoices[DRAFT].finalized_at).toBeNull();
      expect(mocks.finalizeEngine).not.toHaveBeenCalled();
      expect(state.rawInvoiceUpdates).toEqual([]);
    });

    it('checks the permission once, before touching any id (no per-id failures for a denied principal)', async () => {
      grant('invoice:update');
      const lookups = vi.spyOn(InvoiceService.prototype, 'finalizeInvoice');

      await expect(bulk('finalize', [DRAFT, SENT, PAID])).rejects.toMatchObject({ statusCode: 403 });

      expect(lookups).not.toHaveBeenCalled();
    });

    it('refuses send without invoice:send', async () => {
      grant('invoice:update', 'invoice:finalize');
      const send = vi.spyOn(InvoiceService.prototype, 'sendInvoice');

      await expect(bulk('send', [SENT])).rejects.toMatchObject({ statusCode: 403 });
      expect(send).not.toHaveBeenCalled();
    });

    it('refuses cancel without the void authority (no invoice:update); invoice is not cancelled', async () => {
      grant('invoice:finalize');

      await expect(bulk('cancel', [SENT])).rejects.toMatchObject({ statusCode: 403 });

      expect(state.invoices[SENT].status).toBe('sent');
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });

    it('refuses cancel on a connected tenant without remote-mutate, per id, and cancels nothing', async () => {
      grant('invoice:update');
      state.connected = true;

      const { data } = await bulk('cancel', [SENT, FINAL]);

      expect(data.successful).toBe(0);
      expect(data.results.map(r => r.error)).toEqual([VOID_REMOTE_MUTATE_DENIAL, VOID_REMOTE_MUTATE_DENIAL]);
      expect(state.invoices[SENT].status).toBe('sent');
      expect(state.invoices[FINAL].status).toBe('sent');
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });
  });

  describe('finalize', () => {
    it('reports a per-id ConflictError for a non-draft and changes no state', async () => {
      const { data } = await bulk('finalize', [SENT]);

      expect(data).toMatchObject({ total_requested: 1, successful: 0, failed: 1 });
      expect(data.results[0]).toMatchObject({ id: SENT, success: false, error: 'Only draft invoices can be finalized' });
      expect(mocks.finalizeEngine).not.toHaveBeenCalled();
      expect(state.invoices[SENT].status).toBe('sent');
    });

    it('reports a per-id not-found and keeps processing the rest', async () => {
      const missing = '99999999-9999-4999-8999-999999999999';
      const { data } = await bulk('finalize', [missing, DRAFT]);

      expect(data.results[0]).toMatchObject({ id: missing, success: false, error: 'Invoice not found' });
      expect(data.results[1]).toMatchObject({ id: DRAFT, success: true, outcome: 'finalized' });
    });

    it('runs the canonical finalize engine (finalized_at, engine audit row) and never writes invoices itself', async () => {
      const { data } = await bulk('finalize', [DRAFT]);

      expect(mocks.finalizeEngine).toHaveBeenCalledTimes(1);
      expect(mocks.finalizeEngine).toHaveBeenCalledWith(
        DRAFT,
        expect.anything(),
        TENANT,
        'user-1',
        expect.objectContaining({ internalValidation: true })
      );
      expect(state.invoices[DRAFT].status).toBe('sent');
      expect(state.invoices[DRAFT].finalized_at).toBe('2026-10-31T00:00:00.000Z');
      expect(data.results[0]).toMatchObject({ id: DRAFT, success: true, outcome: 'finalized' });
      expect(state.audit).toContainEqual(
        expect.objectContaining({ operation: 'finalize', recordId: DRAFT })
      );
      // No raw UPDATE of `invoices` came from the bulk method itself.
      expect(state.rawInvoiceUpdates).toEqual([]);
    });

    it('records one summary audit row carrying the per-id outcomes', async () => {
      await bulk('finalize', [DRAFT, SENT]);

      const summary = state.audit.filter(a => a.operation === 'bulk_invoice_operation');
      expect(summary).toHaveLength(1);
      expect(summary[0].details).toMatchObject({
        total_requested: 2,
        successful: 1,
        failed: 1,
        results: [
          { id: DRAFT, success: true, outcome: 'finalized' },
          { id: SENT, success: false, error: 'Only draft invoices can be finalized' },
        ],
      });
    });
  });

  describe('send', () => {
    it('delegates to InvoiceService.sendInvoice and reports outcome "sent"', async () => {
      const send = vi.spyOn(InvoiceService.prototype, 'sendInvoice').mockResolvedValue({ status: 'sent' } as any);

      const { data } = await bulk('send', [SENT], { email_addresses: ['a@example.com'] });

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ invoice_id: SENT, email_addresses: ['a@example.com'] }),
        expect.objectContaining({ tenant: TENANT })
      );
      expect(data.results[0]).toMatchObject({ id: SENT, success: true, outcome: 'sent' });
      expect(data.results[0].error).toBeUndefined();
    });
  });

  describe('cancel', () => {
    it('voids through the canonical void core and reports outcome "voided"', async () => {
      const { data } = await bulk('cancel', [SENT], { reason: 'duplicate' });

      expect(mocks.voidCore).toHaveBeenCalledTimes(1);
      expect(mocks.voidCore.mock.calls[0][2]).toMatchObject({ reason: 'duplicate', actorUserId: 'user-1' });
      expect(data.results[0]).toMatchObject({ id: SENT, success: true, outcome: 'voided' });
      expect(state.invoices[SENT].status).toBe('cancelled');
      expect(state.rawInvoiceUpdates).toEqual([]);
    });

    it('refuses a paid invoice with the canonical reason and leaves it paid', async () => {
      state.blocker = 'Unwind payments before voiding.';

      const { data } = await bulk('cancel', [PAID]);

      expect(data.results[0]).toMatchObject({ id: PAID, success: false, error: 'Unwind payments before voiding.' });
      expect(state.invoices[PAID].status).toBe('paid');
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });

    it('refuses an invoice whose accounting export is in progress with the canonical reason', async () => {
      state.exportInProgress = true;

      const { data } = await bulk('cancel', [SENT]);

      expect(data.results[0]).toMatchObject({ success: false });
      expect(data.results[0].error).toContain('An accounting export is being prepared');
      expect(state.invoices[SENT].status).toBe('sent');
    });

    it('refuses a draft (drafts are deleted, not voided)', async () => {
      const { data } = await bulk('cancel', [DRAFT]);

      expect(data.results[0]).toMatchObject({ success: false, error: 'Drafts must be deleted, not voided.' });
      expect(state.invoices[DRAFT].status).toBe('draft');
    });
  });

  describe('schema', () => {
    it('rejects apply_credit with a 400-shaped parse error that points at the credit endpoint', () => {
      const parsed = bulkInvoiceOperationSchema.safeParse({ invoice_ids: [DRAFT], operation: 'apply_credit' });

      expect(parsed.success).toBe(false);
      expect(JSON.stringify((parsed as any).error.issues)).toContain('/api/v1/financial/invoices/:id/credit');
    });

    it.each(['finalize', 'send', 'cancel'])('still accepts %s', (operation) => {
      expect(bulkInvoiceOperationSchema.safeParse({ invoice_ids: [DRAFT], operation }).success).toBe(true);
    });
  });
});
