'use client';

/**
 * Public, read-only quote review (email-link page). Props are serializable view
 * data only: the server page strips tokens, link rows, tenant and contact ids
 * before anything reaches this client component.
 */

import React, { useMemo } from 'react';
import type { IQuoteItem } from '@alga-psa/types';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { I18nProvider, useTranslation, type PreloadedNamespaceResources } from '@alga-psa/ui/lib/i18n/client';
import type { SupportedLocale } from '@alga-psa/core/i18n/config';
import type { ClientPortalLocationSummary } from '@alga-psa/client-portal/actions';
import { QuoteDocumentView, type QuoteDocumentQuote } from './QuoteDocumentView';

export type PublicQuoteReviewItem = Pick<
  IQuoteItem,
  | 'quote_item_id'
  | 'description'
  | 'quantity'
  | 'unit_price'
  | 'total_price'
  | 'display_order'
  | 'is_optional'
  | 'is_selected'
  | 'is_discount'
  | 'location_id'
>;

export interface PublicQuoteReviewProps {
  quote: QuoteDocumentQuote & {
    subtotal: number;
    discount_total: number;
    tax: number;
    total_amount: number;
  };
  items: PublicQuoteReviewItem[];
  locations: ClientPortalLocationSummary[];
  locale: SupportedLocale;
  resources?: PreloadedNamespaceResources;
  branding: { name: string | null; logoUrl: string | null };
  pdfHref: string;
  /** Neutral status notice for quotes that have already been decided. */
  decidedNotice: 'accepted' | 'declined' | 'converted' | null;
}

function Inner({ quote, items, locations, branding, pdfHref, decidedNotice }: PublicQuoteReviewProps) {
  const { t } = useTranslation('features/billing');

  const noticeText =
    decidedNotice === 'accepted'
      ? t('quotes.public.notice.accepted', { defaultValue: 'This quote has been accepted. It is shown here for your records.' })
      : decidedNotice === 'declined'
        ? t('quotes.public.notice.declined', { defaultValue: 'This quote has been declined. It is shown here for your records.' })
        : decidedNotice === 'converted'
          ? t('quotes.public.notice.converted', { defaultValue: 'This quote has been accepted and is being fulfilled. It is shown here for your records.' })
          : t('quotes.public.notice.readOnly', { defaultValue: 'This is a read-only view of your quote.' });

  const totals = useMemo(
    () => ({
      subtotal: quote.subtotal || 0,
      discountTotal: quote.discount_total || 0,
      tax: quote.tax || 0,
      totalAmount: quote.total_amount || 0,
    }),
    [quote],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      {(branding.name || branding.logoUrl) && (
        <div className="flex items-center gap-3" data-testid="public-quote-branding">
          {branding.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- same-origin tenant logo, validated server-side
            <img src={branding.logoUrl} alt={branding.name ?? ''} className="h-10 w-auto" />
          )}
          {branding.name && <span className="text-lg font-semibold">{branding.name}</span>}
        </div>
      )}
      <QuoteDocumentView
        quote={quote}
        items={items as IQuoteItem[]}
        locations={locations}
        totals={totals}
        pdfHref={pdfHref}
        termsId="public-quote-terms-content"
        topSlot={
          <div
            id="public-quote-notice"
            className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
          >
            {noticeText}
          </div>
        }
      />
    </div>
  );
}

export const PublicQuoteReview: React.FC<PublicQuoteReviewProps> = (props) => (
  <I18nProvider
    initialLocale={props.locale}
    portal="client"
    namespaces={['common', 'features/billing']}
    preloadedResources={props.resources}
  >
    <CurrencyFormatProvider currencyCode={props.quote.currency_code} locale={props.locale}>
      <Inner {...props} />
    </CurrencyFormatProvider>
  </I18nProvider>
);

export default PublicQuoteReview;
