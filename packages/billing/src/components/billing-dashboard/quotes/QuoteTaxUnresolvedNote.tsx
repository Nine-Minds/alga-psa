'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isQuoteItemIncluded } from '../../../lib/quoteItemInclusion';
import type { DraftQuoteItem } from './quoteLineItemDraft';

/**
 * A taxable, included line whose region had no active tax rate when the quote
 * was last calculated: its tax is 0 because it could not be worked out.
 */
export const isTaxUnresolvedLine = (item: DraftQuoteItem): boolean =>
  item.tax_unresolved === true
  && !item.is_discount
  && item.is_taxable !== false
  && isQuoteItemIncluded(item);

export const hasUnresolvedTax = (items: DraftQuoteItem[]): boolean => items.some(isTaxUnresolvedLine);

/** Note shown under the tax total when any included line's tax could not be calculated. */
export const QuoteTaxUnresolvedNote: React.FC<{ items: DraftQuoteItem[] }> = ({ items }) => {
  const { t } = useTranslation('msp/quotes');
  if (!hasUnresolvedTax(items)) return null;
  return (
    <p id="quote-tax-unresolved-note" className="text-xs text-warning">
      {t('quoteLineItems.taxUnresolved.totalsNote', {
        defaultValue: 'Tax could not be calculated for some lines. Those lines show 0 tax.',
      })}
    </p>
  );
};

