import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> | undefined;
const rows = vi.hoisted(() => ({
  client: { client_name: 'Acme', payment_terms: 'net_30' } as Row,
  profile: { billing_profile_id: 'profile-1', payment_terms: null } as Row,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    tenantDb: () => ({
      table: (name: string) => ({
        // Tenant default (Billing Settings): none configured in these tests.
        first: async () => undefined,
        where: () => ({
          first: async () => (name === 'clients' ? rows.client : rows.profile),
        }),
      }),
    }),
  };
});

// The REST invoice create/update path (InvoiceService) takes its due date from
// resolveInvoiceBillingTerms: profile terms first, then the client's.
import { resolveInvoiceBillingTerms } from '@alga-psa/billing/lib/billing/invoiceDueDate';

async function dueDate(
  clientTerms: string | null | undefined,
  profileTerms: string | null = null,
  invoiceDate = '2026-09-22',
) {
  rows.client = { client_name: 'Acme', payment_terms: clientTerms };
  rows.profile = { billing_profile_id: 'profile-1', payment_terms: profileTerms };
  const terms = await resolveInvoiceBillingTerms({} as any, 'tenant-1', 'client-1', invoiceDate, 'profile-1');
  return terms.dueDate;
}

describe('REST invoice due date from payment terms', () => {
  it('honors Net 7 and Net 14 instead of falling back to 30 days', async () => {
    expect(await dueDate('net_7')).toBe('2026-09-29');
    expect(await dueDate('net_14')).toBe('2026-10-06');
  });

  it('honors Net 7 and Net 14 set on the billing profile over the client terms', async () => {
    expect(await dueDate('net_30', 'net_7')).toBe('2026-09-29');
    expect(await dueDate('due_on_receipt', 'net_14')).toBe('2026-10-06');
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
    expect(await dueDate(undefined, 'Net 45 days')).toBe('2026-10-22');
  });
});
