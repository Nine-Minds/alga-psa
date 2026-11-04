type EditableLine = {
  item_id?: string;
  quantity: number;
  rate: number;
  unit_price?: number | null;
  net_amount?: number | null;
  total_price?: number | null;
  is_manual?: boolean | null;
  is_discount?: boolean | null;
  discount_type?: string | null;
  discount_percentage?: number | null;
  applies_to_item_id?: string | null;
  isRemoved?: boolean;
  is_manual_credit?: boolean | null;
};

/** Manual editor contribution in minor units; generated totals remain in the invoice projection. */
export function calculateManualInvoiceEditorTotal(
  editableItems: EditableLine[],
  invoiceItems: EditableLine[] = [],
): number {
  const active = editableItems.filter((item) => !item.isRemoved);
  const charges = active.filter((item) => !item.is_discount);
  const discounts = active.filter((item) => item.is_discount);
  const manualSubtotal = charges.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.rate),
    0,
  );
  const generatedSubtotal = invoiceItems
    .filter((item) => !item.is_manual && !item.is_discount)
    .reduce((sum, item) => sum + Number(item.net_amount ?? item.total_price ?? 0), 0);

  let total = manualSubtotal;
  for (const discount of discounts) {
    if (discount.discount_type === 'percentage' && discount.discount_percentage != null) {
      let base = manualSubtotal + generatedSubtotal;
      if (discount.applies_to_item_id) {
        const target = charges.find((item) => item.item_id === discount.applies_to_item_id)
          ?? invoiceItems.find((item) => item.item_id === discount.applies_to_item_id
            && !item.is_manual && !item.is_discount);
        base = target
          ? target.is_manual
            ? Math.round(Number(target.quantity || 0) * Number(target.unit_price ?? target.rate ?? 0))
            : Number(target.net_amount ?? target.total_price ?? 0)
          : 0;
      }
      total -= Math.round((base * discount.discount_percentage) / 100);
    } else if (discount.discount_type === 'fixed') {
      const rate = Number(discount.unit_price ?? discount.rate ?? 0);
      total += discount.is_manual_credit
        ? Number(discount.quantity || 0) * rate
        : -Math.abs(rate);
    }
  }
  return Math.round(total);
}
