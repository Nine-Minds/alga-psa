import type { OverdueAdvanceVendorReturn } from './dashboardQueries';

export interface OverdueVendorReturnAttentionItem {
  id: string;
  kind: 'rma_vendor_return';
  band: 'red';
  category: 'fulfillment';
  name: string;
  href: string;
  params: Record<string, string | number>;
  amount_cents: null;
  age_days: number;
  action: { key: 'view'; href: string };
}

/** Build the dashboard row for a visible, overdue advance-track vendor return. */
export function overdueVendorReturnAttention(rows: readonly OverdueAdvanceVendorReturn[]): OverdueVendorReturnAttentionItem[] {
  return rows.map((r) => {
    const href = `/msp/inventory/rma?rmaId=${encodeURIComponent(r.rma_id)}`;
    return {
      id: `rma-vendor-return-${r.rma_id}`,
      kind: 'rma_vendor_return',
      band: 'red',
      category: 'fulfillment',
      name: r.rma_number,
      href,
      params: {
        ...(r.rma_reference ? { rma_reference: r.rma_reference } : {}),
        return_by: r.return_by,
        overdue_days: Number(r.overdue_days),
      },
      amount_cents: null,
      age_days: Number(r.overdue_days),
      action: { key: 'view', href },
    };
  });
}
