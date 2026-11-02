import type { OverdueAdvanceVendorReturn } from './dashboardQueries';

export interface OverdueVendorReturnAttentionItem {
  id: string;
  kind: 'rma_vendor_return';
  band: 'red' | 'amber';
  category: 'fulfillment';
  name: string;
  href: string;
  params: Record<string, string | number>;
  amount_cents: null;
  age_days: number | null;
  action: { key: 'view'; href: string };
}

/** Build dashboard attention rows for visible approaching and overdue advance-track vendor returns. */
export function overdueVendorReturnAttention(rows: readonly OverdueAdvanceVendorReturn[]): OverdueVendorReturnAttentionItem[] {
  return rows.map((r) => {
    const href = `/msp/inventory/rma?rmaId=${encodeURIComponent(r.rma_id)}`;
    return {
      id: `rma-vendor-return-${r.rma_id}`,
      kind: 'rma_vendor_return',
      band: Number(r.overdue_days) > 0 ? 'red' : 'amber',
      category: 'fulfillment',
      name: r.rma_number,
      href,
      params: {
        ...(r.rma_reference ? { rma_reference: r.rma_reference } : {}),
        return_by: r.return_by,
        ...(Number(r.overdue_days) > 0 ? { overdue_days: Number(r.overdue_days) } : { days_until_due: Number(r.days_until_due) }),
      },
      amount_cents: null,
      age_days: Number(r.overdue_days) > 0 ? Number(r.overdue_days) : null,
      action: { key: 'view', href },
    };
  });
}
