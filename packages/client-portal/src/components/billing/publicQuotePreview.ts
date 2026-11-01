import { computeQuoteTotals } from '@alga-psa/core';
import type { IQuoteItem } from '@alga-psa/types';

import { UNASSIGNED_KEY } from './quoteLocationGroups';

/**
 * Pure live-preview computation shared by the page and tests. Null when any base row lacks
 * its server-resolved tax input (the page then falls back to the persisted totals).
 */
export function computePublicQuotePreview(previewItems: IQuoteItem[]) {
  if (previewItems.some((i) => !i.is_discount && typeof i.tax_amount_if_included !== 'number')) return null;
  return computeQuoteTotals(
    previewItems.map((i) => ({
      ...i,
      id: i.quote_item_id,
      groupKey: i.location_id && i.location_id.trim().length > 0 ? i.location_id : UNASSIGNED_KEY,
      taxAmountIfIncluded: i.tax_amount_if_included ?? 0,
    })),
  );
}
