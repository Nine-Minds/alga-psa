import type { InvoiceBundlePresentation, IInvoiceBundleComponentAmount, WasmInvoiceBundleComponent } from '@alga-psa/types';

export interface BundleComponentBuildOptions {
  /**
   * Include `unitPrice`/`total`. Client-visible data sets this only when the
   * rendering template binds a component price (`templateUsesComponentPricing`).
   */
  includePricing: boolean;
  /** Detail-row money keyed by item_detail_id; required for priced output. */
  amounts?: Record<string, IInvoiceBundleComponentAmount> | null;
}

export interface BuiltBundleComponents {
  subtitle: string | null;
  hasComponents: boolean;
  components: WasmInvoiceBundleComponent[];
}

const sameNumber = (a: number | null, b: number | null) => a === b;

/**
 * Pure mapper from a generation-time snapshot (plus optional detail amounts)
 * to the template-facing component rows. The persisted-invoice mapper, the
 * draft preview and the designer samples all use it so they cannot drift.
 *
 * A service whose quantity and change are identical in every covered period
 * collapses to a single row; otherwise each period gets its own row labelled
 * with the period. (Prices sum per service when collapsing.)
 */
export function buildBundleComponents(
  snapshot: InvoiceBundlePresentation | null | undefined,
  options: BundleComponentBuildOptions,
): BuiltBundleComponents | null {
  if (!snapshot || !Array.isArray(snapshot.components)) return null;

  const change = (quantity: number | null, previous: number | null, comparison: string): number | null => {
    if (comparison !== 'compared' || quantity === null || previous === null) return null;
    const delta = quantity - previous;
    return delta === 0 ? null : delta;
  };

  const priceOf = (detailItemIds: string[]) => {
    if (!options.includePricing) return null;
    const amounts = options.amounts ?? {};
    let total = 0;
    let rate: number | null = null;
    let found = false;
    for (const id of detailItemIds) {
      const entry = amounts[id];
      if (!entry) continue;
      found = true;
      total += Number(entry.allocated_amount) || 0;
      rate = Number(entry.rate);
    }
    return found || detailItemIds.length === 0 ? { total, rate } : null;
  };

  const byService = new Map<string, typeof snapshot.components>();
  for (const component of [...snapshot.components].sort((a, b) => a.order - b.order)) {
    const list = byService.get(component.serviceId) ?? [];
    list.push(component);
    byService.set(component.serviceId, list);
  }

  const components: WasmInvoiceBundleComponent[] = [];
  for (const entries of byService.values()) {
    const sorted = [...entries].sort((a, b) => String(a.servicePeriodStart ?? '').localeCompare(String(b.servicePeriodStart ?? '')));
    const first = sorted[0];
    const uniform = sorted.every((entry) =>
      sameNumber(entry.quantity, first.quantity)
      && sameNumber(change(entry.quantity, entry.previousQuantity, entry.comparison), change(first.quantity, first.previousQuantity, first.comparison)));
    const groups = uniform ? [sorted] : sorted.map((entry) => [entry]);
    for (const group of groups) {
      const head = group[0];
      const row: WasmInvoiceBundleComponent = {
        name: head.name,
        quantity: head.quantity,
        quantityChange: change(head.quantity, head.previousQuantity, head.comparison),
        pricingBasis: head.pricingBasis,
      };
      if (!uniform) {
        row.periodLabelStart = head.servicePeriodStart;
        row.periodLabelEnd = head.servicePeriodEnd;
      }
      if (options.includePricing) {
        const prices = priceOf(group.flatMap((entry) => entry.detailItemIds));
        row.total = prices?.total ?? 0;
        if (head.pricingBasis === 'unit' && prices?.rate !== null && prices?.rate !== undefined) {
          row.unitPrice = prices.rate;
        }
      }
      components.push(row);
    }
  }

  return {
    subtitle: snapshot.subtitle ?? null,
    hasComponents: components.length > 0,
    components,
  };
}
