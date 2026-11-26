'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isQuoteItemIncluded } from '../../../lib/quoteItemInclusion';
import type { QuoteDraftRowTax } from '../../../services/quoteCalculationService';
import { draftTaxRowKey, type DraftQuoteItem } from './quoteLineItemDraft';

/** The engine's per-row tax for the draft, keyed by `draftTaxRowKey`. */
export type DraftRowTaxById = Record<string, QuoteDraftRowTax>;

/**
 * A taxable, included line whose region has no active tax rate (per the
 * engine's latest resolution of the draft): its tax is 0 because it could not
 * be worked out, not because it is nil.
 */
export const isTaxUnresolvedLine = (item: DraftQuoteItem, rowTaxById?: DraftRowTaxById | null): boolean =>
  rowTaxById?.[draftTaxRowKey(item)]?.taxUnresolved === true
  && !item.is_discount
  && item.is_taxable !== false
  && isQuoteItemIncluded(item);

export const hasUnresolvedTax = (items: DraftQuoteItem[], rowTaxById?: DraftRowTaxById | null): boolean =>
  items.some((item) => isTaxUnresolvedLine(item, rowTaxById));

/** Note shown under the tax total when any included line's tax could not be calculated. */
export const QuoteTaxUnresolvedNote: React.FC<{ items: DraftQuoteItem[]; rowTaxById?: DraftRowTaxById | null }> = ({ items, rowTaxById }) => {
  const { t } = useTranslation('msp/quotes');
  if (!hasUnresolvedTax(items, rowTaxById)) return null;
  return (
    <p id="quote-tax-unresolved-note" className="text-xs text-warning">
      {t('quoteLineItems.taxUnresolved.totalsNote', {
        defaultValue: 'Tax could not be calculated for some lines. Those lines show 0 tax.',
      })}
    </p>
  );
};

