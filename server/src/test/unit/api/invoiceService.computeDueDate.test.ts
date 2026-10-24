import { describe, expect, it, vi } from 'vitest';

const clientRow = vi.hoisted(() => ({ current: { payment_terms: 'net_30' } as { payment_terms?: string | null } | undefined }));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    tenantDb: () => ({
      table: () => ({
        where: () => ({ select: () => ({ first: async () => clientRow.current }) }),
      }),
    }),
  };
});

import { InvoiceService } from '../../../lib/api/services/InvoiceService';

async function dueDate(paymentTerms: string | null | undefined, invoiceDate = '2026-09-22') {
  clientRow.current = { payment_terms: paymentTerms };
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

  it('falls back to Net 30 for unknown, empty, or missing terms', async () => {
    expect(await dueDate('')).toBe('2026-10-22');
    expect(await dueDate('Net 45 days')).toBe('2026-10-22');
    expect(await dueDate(null)).toBe('2026-10-22');
    clientRow.current = undefined;
    const service = Object.create(InvoiceService.prototype) as any;
    expect(await service.computeDueDate({}, 'tenant-1', 'client-1', '2026-09-22')).toBe('2026-10-22');
  });
});
