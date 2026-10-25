import { describe, expect, it, vi } from 'vitest';

// computeDueDate delegates to the shared resolver, which resolves the effective
// billing identity (profile → client → tenant default → Net 30). Mock the
// identity and run the real resolver arithmetic so REST and UI cannot drift.
const identity = vi.hoisted(() => ({ paymentTerms: 'net_30' as string }));

vi.mock('@alga-psa/shared/billingClients/billingProfileSettings', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    resolveEffectiveBillingIdentity: async () => ({ paymentTerms: identity.paymentTerms }),
  };
});

import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { resolveInvoiceDueDate } from '@alga-psa/billing/lib/billing/invoiceDueDate';

async function dueDate(paymentTerms: string, invoiceDate = '2026-09-22') {
  identity.paymentTerms = paymentTerms;
  const service = Object.create(InvoiceService.prototype) as any;
  return service.computeDueDate({}, 'tenant-1', 'client-1', invoiceDate);
}

describe('InvoiceService.computeDueDate (REST invoice path)', () => {
  it('honors Net 7 and Net 14 instead of falling back to 30 days', async () => {
    expect(await dueDate('net_7')).toBe('2026-09-29');
    expect(await dueDate('net_14')).toBe('2026-10-06');
  });

  it('keeps the existing terms', async () => {
    expect(await dueDate('net_15')).toBe('2026-10-07');
    expect(await dueDate('net_30')).toBe('2026-10-22');
    expect(await dueDate('due_on_receipt')).toBe('2026-09-22');
  });

  it('uses the tier the identity resolved, e.g. a Net 14 tenant default', async () => {
    // The identity already folded profile → client → tenant; a client with no
    // terms of its own arrives here as the tenant default.
    expect(await dueDate('net_14')).toBe('2026-10-06');
  });

  it('falls back to Net 30 for an unrecognised resolved term', async () => {
    expect(await dueDate('Net 45 days')).toBe('2026-10-22');
  });

  it('agrees with resolveInvoiceDueDate for every term', async () => {
    for (const terms of ['net_30', 'net_15', 'net_14', 'net_7', 'due_on_receipt']) {
      identity.paymentTerms = terms;
      expect(await dueDate(terms)).toBe(await resolveInvoiceDueDate({} as any, 'tenant-1', 'client-1', '2026-09-22'));
    }
  });
});
