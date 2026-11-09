/**
 * InvoiceService.voidInvoice — thin API wrapper over invoiceVoidCore
 * (alga-2026-0003005). The core's own behavior (hour blocks, credit claw-back)
 * is covered by its suites; here the core is mocked and the wiring is pinned:
 * permission gates, lock order / lockedInvoice hand-off, blocker -> ConflictError,
 * rollback on refusal, audit row, post-commit enqueue gating.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
  invoice: null as any,
  /** Ordered trace of lock / core / audit calls. */
  trace: [] as string[],
  connected: false,
  exportInProgress: false,
  blocker: null as string | null,
  voidOutcome: { ok: true } as { ok: true } | { ok: false; error: string },
  mapping: null as any,
  revokeRemoteMutateInTransaction: false,
}));

const mocks = vi.hoisted(() => ({
  voidCore: vi.fn(),
  enqueue: vi.fn(),
  audit: vi.fn(),
  accountingAudit: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/auth/rbac', () => ({
  hasPermission: async (_user: any, resource: string, action: string, conn?: any) => {
    if (conn?.isTrx && state.revokeRemoteMutateInTransaction && action === 'remote_mutate') return false;
    return state.granted.has(`${resource}:${action}`);
  },
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  const table = (name: string) => {
    const b: any = {
      where: () => b,
      forUpdate: () => {
        state.trace.push(`lock:${name}`);
        return b;
      },
      first: async () => {
        if (name === 'invoices') return state.invoice ? { ...state.invoice } : undefined;
        if (name === 'tenant_external_entity_mappings') return state.mapping;
        return undefined;
      },
    };
    return b;
  };
  return {
    ...actual,
    withTransaction: async (_knex: unknown, cb: (trx: unknown) => unknown) => {
      state.trace.push('tx:begin');
      try {
        const result = await cb({ isTrx: true });
        state.trace.push('tx:commit');
        return result;
      } catch (error) {
        state.trace.push('tx:rollback');
        throw error;
      }
    },
    tenantDb: () => ({ table }),
    writeAccountingAudit: (...args: any[]) => mocks.accountingAudit(...args),
  };
});

vi.mock('../../../lib/logging/auditLog', () => ({
  auditLog: async (_trx: unknown, params: any) => {
    state.trace.push('audit');
    mocks.audit(params);
  },
}));
vi.mock('../../../lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(),
  publishUnregisteredEventType: vi.fn(),
  publishWorkflowEvent: vi.fn(),
}));
vi.mock('@alga-psa/billing/lib/invoiceVoidCore', () => ({
  findLocalVoidBlocker: vi.fn(async () => state.blocker),
  voidInvoiceLocally: async (...args: any[]) => {
    state.trace.push('core');
    return mocks.voidCore(...args);
  },
}));
vi.mock('@alga-psa/billing/services/accountingSync/invoiceExportGuards', () => ({
  assertInvoiceNotExported: vi.fn(),
  findInvoiceExportInProgress: vi.fn(async () => state.exportInProgress),
}));
vi.mock('@alga-psa/billing/services/accountingSync/accountingSyncSettings', () => ({
  hasConnectedQboRealm: vi.fn(async () => state.connected),
}));
vi.mock('@alga-psa/billing/services/accountingSync/syncProducers', () => ({
  enqueueInvoiceVoid: (...args: any[]) => mocks.enqueue(...args),
}));
vi.mock('@alga-psa/billing/services/autopayBridge', () => ({
  signalAutopayInvoiceSettled: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/billing/services', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  notifyInvoiceTerminalStatus: vi.fn(async () => undefined),
}));

import { InvoiceService } from '../../../lib/api/services/InvoiceService';

const VOID_REMOTE_MUTATE_DENIAL =
  'Permission denied: voiding invoices while the accounting integration is connected requires the accounting remote-mutate permission.';

const context = (overrides: Record<string, unknown> = {}) =>
  ({ tenant: 'tenant-1', userId: 'user-1', user: { user_id: 'user-1', user_type: 'internal' }, ...overrides }) as any;

describe('InvoiceService.voidInvoice', () => {
  let service: InvoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
    state.granted = new Set(['invoice:update', 'accounting_integrations:remote_mutate']);
    state.invoice = {
      invoice_id: 'inv-1',
      client_id: 'client-1',
      status: 'sent',
      finalized_at: '2026-01-01',
      total_amount: 100,
      credit_applied: 5,
    };
    state.trace = [];
    state.connected = false;
    state.exportInProgress = false;
    state.blocker = null;
    state.voidOutcome = { ok: true };
    state.mapping = null;
    state.revokeRemoteMutateInTransaction = false;
    mocks.voidCore.mockImplementation(async () => state.voidOutcome);

    service = new InvoiceService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });
    vi.spyOn(service as any, 'getInvoiceRecurringProvenance').mockResolvedValue(null);
    vi.spyOn(service, 'getById').mockResolvedValue({ invoice_id: 'inv-1', status: 'cancelled' } as any);
  });

  it('locks the row FIRST, hands the re-read row to the core as lockedInvoice, audits, and returns the invoice', async () => {
    const result = await service.voidInvoice('inv-1', context(), { reason: '  duplicate  ' });

    expect(result).toMatchObject({ invoice_id: 'inv-1', status: 'cancelled' });
    // Lock order contract: invoice row lock precedes the core (which locks credit rows).
    expect(state.trace).toEqual(['tx:begin', 'lock:invoices', 'core', 'audit', 'tx:commit']);
    const params = mocks.voidCore.mock.calls[0][2];
    expect(params).toMatchObject({
      reason: 'duplicate',
      actorUserId: 'user-1',
      invoice: expect.objectContaining({ invoice_id: 'inv-1', total_amount: 100 }),
      lockedInvoice: expect.objectContaining({ status: 'sent', credit_applied: 5 }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'inv-1',
        tableName: 'invoices',
        details: expect.objectContaining({ action: 'invoice.voided', reason: 'duplicate', previous_status: 'sent' }),
      })
    );
  });

  it('enqueues the remote void only with the actor remote-mutate capability', async () => {
    await service.voidInvoice('inv-1', context());
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'inv-1', {
      actorUserId: 'user-1',
      allowRemoteMutate: true,
    });

    mocks.enqueue.mockClear();
    state.granted = new Set(['invoice:update']);
    await service.voidInvoice('inv-1', context());
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'inv-1', {
      actorUserId: 'user-1',
      allowRemoteMutate: false,
    });
  });

  it('audits the remote-affecting branch in the same transaction when a mapping exists and the actor may mutate remotely', async () => {
    state.mapping = { id: 'm1', external_entity_id: 'qbo-9' };
    await service.voidInvoice('inv-1', context());
    expect(mocks.accountingAudit).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'accounting_remote_void',
      expect.objectContaining({ recordId: 'qbo-9' })
    );
  });

  describe('guards', () => {
    it('requires invoice:update', async () => {
      state.granted = new Set();
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({ statusCode: 403 });
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });

    it('refuses client-portal principals', async () => {
      await expect(
        service.voidInvoice('inv-1', context({ user: { user_id: 'u', user_type: 'client' } }))
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('404s a missing invoice', async () => {
      state.invoice = null;
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({ statusCode: 404 });
    });

    it('409s a draft and an already-voided invoice', async () => {
      state.invoice = { ...state.invoice, finalized_at: null, status: 'draft' };
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({
        statusCode: 409,
        message: 'Drafts must be deleted, not voided.',
      });

      state.invoice = { ...state.invoice, finalized_at: '2026-01-01', status: 'cancelled' };
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({
        statusCode: 409,
        message: 'Invoice is already voided.',
      });
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });

    it('refuses a paid invoice (recorded payments) with the canonical blocker as a 409', async () => {
      state.blocker = 'Unwind payments before voiding.';
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({
        statusCode: 409,
        message: 'Unwind payments before voiding.',
      });
      expect(state.trace).toEqual([]); // fast-fail: no transaction opened
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });

    it('refuses a credit note with applied credit', async () => {
      state.blocker = 'This credit note has applied credit. Unapply the credit before voiding.';
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('applied credit'),
      });
    });

    it('turns a core refusal (used hour block) into a 409 and rolls back without auditing', async () => {
      state.voidOutcome = { ok: false, error: 'An hour block from this invoice has been used and cannot be voided.' };
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({
        statusCode: 409,
        message: 'An hour block from this invoice has been used and cannot be voided.',
      });
      expect(state.trace).toEqual(['tx:begin', 'lock:invoices', 'core', 'tx:rollback']);
      expect(mocks.audit).not.toHaveBeenCalled();
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it('refuses while an accounting export is being prepared', async () => {
      state.exportInProgress = true;
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({ statusCode: 409 });
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });

    it('denies without accounting_integrations:remote_mutate when an integration is connected (fast-fail, identical text to the action)', async () => {
      state.granted = new Set(['invoice:update']);
      state.connected = true;
      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({
        statusCode: 403,
        message: VOID_REMOTE_MUTATE_DENIAL,
      });
      expect(state.trace).toEqual([]);
    });

    it('re-checks remote-mutate under the lock (capability revoked / connection added mid-flight)', async () => {
      state.connected = false;
      // The actor holds remote_mutate at the fast-fail, so the fast-fail never consults the connection
      // (short-circuit). Under the lock the capability is revoked AND a connection has appeared: the
      // first hasConnectedQboRealm call is the in-transaction one.
      const settings = await import('@alga-psa/billing/services/accountingSync/accountingSyncSettings');
      vi.mocked(settings.hasConnectedQboRealm).mockResolvedValueOnce(true);
      state.revokeRemoteMutateInTransaction = true;

      await expect(service.voidInvoice('inv-1', context())).rejects.toMatchObject({
        statusCode: 403,
        message: VOID_REMOTE_MUTATE_DENIAL,
      });
      expect(state.trace).toEqual(['tx:begin', 'lock:invoices', 'tx:rollback']);
      expect(mocks.voidCore).not.toHaveBeenCalled();
    });

    it('allows invoice:update alone on an unconnected tenant', async () => {
      state.granted = new Set(['invoice:update']);
      await expect(service.voidInvoice('inv-1', context())).resolves.toBeDefined();
    });
  });
});
