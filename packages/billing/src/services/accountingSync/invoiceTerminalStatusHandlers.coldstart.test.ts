import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Knex } from 'knex';
import type { InvoiceTerminalStatusParams } from './invoiceTerminalStatusHandlers';

/**
 * Cold-start regression for the draft-review defect: the QBO `paymentApplier`
 * and the alternative-payments route call `recordExternalPayment` without any
 * prior import of the EE payments module in the process, so the sole
 * in-memory terminal-status handler was never registered and paid transitions
 * returned with active Stripe sessions unretired.
 *
 * These tests exercise the registry layer that owns the invariant: the EE
 * module that registers the handler is pulled in lazily, exactly once, and
 * awaited before handlers run. Each test resets the module graph and re-mocks
 * `@enterprise/lib/payments` (`vi.doMock` + `vi.resetModules`), so the lazy
 * load is genuinely cold every time — a pass can never be explained by a
 * handler registered by an earlier import in the process.
 *
 * The mocked `@enterprise/lib/payments` plays the role of the EE build (the
 * production webpack alias): its only observable behavior is the module side
 * effect of registering a handler, which is what an EE build does.
 */

const h = vi.hoisted(() => ({
  eeImports: { value: 0 },
  handler: vi.fn(async () => undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Re-register the EE-module mock for the next (fresh) module graph. The
  // factory runs on the first import of the module in that graph — which, in
  // the cold-start tests, is the lazy load inside `notifyInvoiceTerminalStatus`.
  vi.doMock('@enterprise/lib/payments', async () => {
    h.eeImports.value += 1;
    const { registerInvoiceTerminalStatusHandler } = await import('./invoiceTerminalStatusHandlers');
    registerInvoiceTerminalStatusHandler(h.handler);
    return {
      PaymentService: class {},
      createStripePaymentProvider: () => null,
    };
  });
  vi.resetModules();
});

function paidParams(overrides: Partial<InvoiceTerminalStatusParams> = {}): InvoiceTerminalStatusParams {
  return {
    // The spy handler never touches the connection, so a stub satisfies the shape.
    knex: undefined as unknown as Knex,
    tenantId: 'tenant-1',
    invoiceId: 'invoice-1',
    newStatus: 'paid',
    ...overrides,
  };
}

describe('invoiceTerminalStatusHandlers — cold-start EE registration', () => {
  it('registers the EE handler via the lazy import during the first-ever notify (cold start)', async () => {
    const { notifyInvoiceTerminalStatus } = await import('./invoiceTerminalStatusHandlers');

    const importsBefore = h.eeImports.value;
    await notifyInvoiceTerminalStatus(paidParams());

    // The EE module was imported exactly once, and only during the notify:
    // nothing else in the fresh module graph touched it.
    expect(h.eeImports.value).toBe(importsBefore + 1);
    expect(h.handler).toHaveBeenCalledTimes(1);
    expect(h.handler).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', invoiceId: 'invoice-1', newStatus: 'paid' })
    );
  });

  it('memoizes the load: a second notify in the same process does not re-import and still runs the handler', async () => {
    const { notifyInvoiceTerminalStatus } = await import('./invoiceTerminalStatusHandlers');

    const importsBefore = h.eeImports.value;
    await notifyInvoiceTerminalStatus(paidParams());
    await notifyInvoiceTerminalStatus(paidParams({ invoiceId: 'invoice-2' }));

    expect(h.eeImports.value).toBe(importsBefore + 1);
    expect(h.handler).toHaveBeenCalledTimes(2);
    expect(h.handler).toHaveBeenLastCalledWith(
      expect.objectContaining({ invoiceId: 'invoice-2', newStatus: 'paid' })
    );
  });

  it('is idempotent when the EE module was already imported eagerly (webhook-helper path): no second registration', async () => {
    const importsBefore = h.eeImports.value;

    // Eager import, exactly like `paymentWebhookHelpers` does before settling.
    await import('@enterprise/lib/payments');
    expect(h.eeImports.value).toBe(importsBefore + 1);

    const { notifyInvoiceTerminalStatus } = await import('./invoiceTerminalStatusHandlers');
    await notifyInvoiceTerminalStatus(paidParams());

    // The lazy path short-circuits on the already-registered handler: no
    // re-import, and a single registration means the handler runs exactly once.
    expect(h.eeImports.value).toBe(importsBefore + 1);
    expect(h.handler).toHaveBeenCalledTimes(1);
  });

  it('a failed load (CE build / unresolved alias) is caught and never thrown', async () => {
    vi.doMock('@enterprise/lib/payments', () => Promise.reject(new Error('simulated CE alias unresolved')));
    vi.resetModules();
    const { notifyInvoiceTerminalStatus } = await import('./invoiceTerminalStatusHandlers');

    await expect(notifyInvoiceTerminalStatus(paidParams())).resolves.toBeUndefined();
    expect(h.handler).not.toHaveBeenCalled();
  });
});
