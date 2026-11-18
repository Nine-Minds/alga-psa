import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * alga-2026-0002746: an auto-issued replenishment invoice that waits for its
 * Xero number is emailed only once the number is written back.
 */

const state = vi.hoisted(() => ({
  invoice: undefined as Record<string, unknown> | undefined,
  pendingAlerts: 0,
  alertUpdates: [] as Array<{ where: Record<string, unknown>; values: Record<string, unknown> }>,
  enqueue: vi.fn(),
}));

vi.mock('@alga-psa/core', () => ({ enqueueImmediateJob: state.enqueue }));
vi.mock('@alga-psa/billing/lib/prepaidAutoReplenishment', () => ({ createPrepaidReplenishmentInvoice: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ finalizeInvoiceWithKnex: vi.fn() }));
vi.mock('@alga-psa/billing/services/prepaidBlockLifecycleService', () => ({
  EXPIRY_REPLACED_BY_USAGE_BLOCK_REASON: 'x',
  supersedeExpiryIssuancesForLine: vi.fn(),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (name: string) => {
      let where: Record<string, unknown> = {};
      const chain: any = {
        where: (criteria: Record<string, unknown>) => {
          where = { ...where, ...criteria };
          return chain;
        },
        first: async () => (name === 'invoices' ? state.invoice : undefined),
        update: async (values: Record<string, unknown>) => {
          state.alertUpdates.push({ where, values });
          if (where.replenishment_status === 'pending') {
            const claimed = state.pendingAlerts;
            state.pendingAlerts = 0;
            return claimed;
          }
          return 1;
        },
      };
      return chain;
    },
  }),
}));

import { issueReplenishmentAwaitingInvoiceNumber } from 'server/src/lib/eventBus/subscribers/prepaidAutoReplenishment';

const knex: any = { fn: { now: () => 'now()' }, raw: (sql: string) => sql };

describe('issueReplenishmentAwaitingInvoiceNumber', () => {
  beforeEach(() => {
    state.invoice = { finalized_at: '2026-11-18', invoice_number_source: 'external' };
    state.pendingAlerts = 1;
    state.alertUpdates = [];
    state.enqueue.mockReset();
    state.enqueue.mockResolvedValue(undefined);
  });

  it('sends the held-back email once the Xero number is on the invoice, and marks the alert issued', async () => {
    await expect(issueReplenishmentAwaitingInvoiceNumber(knex, 'tenant-1', 'invoice-1')).resolves.toBe(true);

    expect(state.alertUpdates[0]).toEqual({
      where: { replenishment_invoice_id: 'invoice-1', replenishment_status: 'pending' },
      values: expect.objectContaining({ replenishment_status: 'issued' }),
    });
    expect(state.enqueue).toHaveBeenCalledWith('invoice_email', expect.objectContaining({
      invoiceIds: ['invoice-1'],
      tenantId: 'tenant-1',
    }));
  });

  it('does nothing while the invoice is still waiting for its number', async () => {
    state.invoice = { finalized_at: '2026-11-18', invoice_number_source: 'pending_external' };

    await expect(issueReplenishmentAwaitingInvoiceNumber(knex, 'tenant-1', 'invoice-1')).resolves.toBe(false);
    expect(state.alertUpdates).toHaveLength(0);
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('does nothing for an invoice that owes no replenishment email (redelivered event, manual finalize, unrelated invoice)', async () => {
    state.pendingAlerts = 0;

    await expect(issueReplenishmentAwaitingInvoiceNumber(knex, 'tenant-1', 'invoice-1')).resolves.toBe(false);
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('does nothing for an unfinalized invoice', async () => {
    state.invoice = { finalized_at: null, invoice_number_source: 'alga' };

    await expect(issueReplenishmentAwaitingInvoiceNumber(knex, 'tenant-1', 'invoice-1')).resolves.toBe(false);
    expect(state.enqueue).not.toHaveBeenCalled();
  });

  it('marks the alert failed and rethrows when the email job cannot be queued', async () => {
    state.enqueue.mockRejectedValue(new Error('queue down'));

    await expect(issueReplenishmentAwaitingInvoiceNumber(knex, 'tenant-1', 'invoice-1')).rejects.toThrow('queue down');
    expect(state.alertUpdates.at(-1)?.values).toEqual(expect.objectContaining({
      replenishment_status: 'failed',
      replenishment_error: 'queue down',
    }));
  });
});
