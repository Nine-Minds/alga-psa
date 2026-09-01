import { describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import type { InvoiceTerminalStatusParams } from './invoiceTerminalStatusHandlers';

/**
 * CE safety for the cold-start lazy load: in a CE build `@enterprise/lib/payments`
 * resolves to the CE stub (or, if the alias is unresolved, the import rejects),
 * and neither registers a handler. The registry must treat that as a logged
 * no-op — `notifyInvoiceTerminalStatus` must never throw because of it, and
 * any handler registered by a manual caller must still be invoked.
 */

function paidParams(overrides: Partial<InvoiceTerminalStatusParams> = {}): InvoiceTerminalStatusParams {
  return {
    knex: undefined as unknown as Knex,
    tenantId: 'tenant-ce',
    invoiceId: 'invoice-ce',
    newStatus: 'paid',
    ...overrides,
  };
}

describe('invoiceTerminalStatusHandlers — CE no-op safety', () => {
  it('a CE build (no EE handler) is a silent no-op: notify resolves and manual registrations still run', async () => {
    vi.resetModules();
    const { notifyInvoiceTerminalStatus, registerInvoiceTerminalStatusHandler } = await import(
      './invoiceTerminalStatusHandlers'
    );

    const manual = vi.fn(async () => undefined);
    registerInvoiceTerminalStatusHandler(manual);

    // The lazy load ran against the CE stub (billing test alias) and neither
    // threw nor wiped the registry.
    await expect(notifyInvoiceTerminalStatus(paidParams())).resolves.toBeUndefined();
    expect(manual).toHaveBeenCalledTimes(1);
    expect(manual).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-ce', invoiceId: 'invoice-ce', newStatus: 'paid' })
    );
  });

  it('stays a no-op across repeats: the memoized load never throws on subsequent notifies', async () => {
    vi.resetModules();
    const { notifyInvoiceTerminalStatus } = await import('./invoiceTerminalStatusHandlers');

    await expect(notifyInvoiceTerminalStatus(paidParams())).resolves.toBeUndefined();
    await expect(notifyInvoiceTerminalStatus(paidParams({ invoiceId: 'invoice-2' }))).resolves.toBeUndefined();
  });
});
