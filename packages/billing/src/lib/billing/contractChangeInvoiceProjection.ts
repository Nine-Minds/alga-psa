import { describeContractChange } from './contractChangeDescription';

/** Apply canonical display values to an invoice read model without mutating rows. */
export function applyContractChangeDescriptionSources<T extends {
  item_id: string;
  description?: string | null;
}>(charges: T[], sources: Array<{
  item_id: string;
  service_name?: string | null;
  service_id?: string | null;
  currency_code?: string | null;
  adjustment_period_start?: unknown;
  adjustment_period_end?: unknown;
  mid_period_effective_date?: unknown;
  quantity_delta?: unknown;
  unit_rate_cents?: unknown;
  covered_days?: unknown;
  full_period_days?: unknown;
  amount_cents?: unknown;
}>): T[] {
  const byItem = new Map(sources.map((source) => [String(source.item_id), source]));
  return charges.map((charge) => {
    const source = byItem.get(String(charge.item_id));
    if (!source) return charge;
    const description = describeContractChange(
      source.service_name ?? source.service_id ?? 'recurring item',
      source,
      source.currency_code,
    );
    if (description.startsWith('Mid-period quantity change: ')) return charge;
    return {
      ...charge,
      description,
    };
  });
}
