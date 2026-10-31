'use client';

/**
 * Public, read-only quote review (email-link page). Props are serializable view
 * data only: the server page strips tokens, link rows, tenant and contact ids
 * before anything reaches this client component.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { computeQuoteTotals, isOptional, isQuoteItemIncluded } from '@alga-psa/core';
import type { IQuoteItem } from '@alga-psa/types';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { I18nProvider, useTranslation, type PreloadedNamespaceResources } from '@alga-psa/ui/lib/i18n/client';
import type { SupportedLocale } from '@alga-psa/core/i18n/config';
import type { ClientPortalLocationSummary } from '@alga-psa/client-portal/actions';
import { QuoteDocumentView, UNASSIGNED_KEY, type QuoteDocumentQuote } from './QuoteDocumentView';
import QuoteLinkDecisionPanel, { type QuoteLinkAgreement } from './QuoteLinkDecisionPanel';

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
  | 'tax_amount_if_included'
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
  /** Raw URL token, used only to address the decision route. Absent => read-only page. */
  token?: string;
  /** Current agreement wording; required for the decision panel to mount. */
  agreement?: QuoteLinkAgreement;
  /** Fingerprint of the content rendered here; the server refuses a signature if the quote changed since. */
  quoteFingerprint?: string;
  /** Optional signer prefill (recipient name). */
  defaultSignerName?: string;
}

function Inner({ quote, items, locations, branding, pdfHref, decidedNotice, token, agreement, quoteFingerprint, defaultSignerName }: PublicQuoteReviewProps) {
  const { t } = useTranslation('features/billing');

  // Optional-item selection is local until Accept commits it (same model as the portal).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => isOptional(i as IQuoteItem) && isQuoteItemIncluded(i as IQuoteItem)).map((i) => i.quote_item_id)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [settled, setSettled] = useState(false);
  const onSettled = useCallback(() => setSettled(true), []);

  const canDecide = quote.status === 'sent' && !decidedNotice && !!token && !!agreement && !!quoteFingerprint && !settled;
  const hasOptionalItems = items.some((i) => i.is_optional);
  const canEditSelections = canDecide && hasOptionalItems;

  const previewItems = useMemo(
    () => items.map((i) => (i.is_optional ? { ...i, is_selected: selectedIds.has(i.quote_item_id) } : i)) as IQuoteItem[],
    [items, selectedIds],
  );
  // Same pure function the server uses; if any base row lacks its tax input, fall back to persisted totals.
  const preview = useMemo(() => {
    if (!canEditSelections) return null;
    if (previewItems.some((i) => !i.is_discount && typeof i.tax_amount_if_included !== 'number')) return null;
    return computeQuoteTotals(
      previewItems.map((i) => ({
        ...i,
        id: i.quote_item_id,
        groupKey: i.location_id && i.location_id.trim().length > 0 ? i.location_id : UNASSIGNED_KEY,
        taxAmountIfIncluded: i.tax_amount_if_included ?? 0,
      })),
    );
  }, [canEditSelections, previewItems]);
  const previewUnavailable = canEditSelections && preview === null;

  const handleToggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

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
      subtotal: preview ? preview.subtotal : quote.subtotal || 0,
      discountTotal: preview ? preview.discountTotal : quote.discount_total || 0,
      tax: preview ? preview.tax : quote.tax || 0,
      totalAmount: preview ? preview.totalAmount : quote.total_amount || 0,
    }),
    [quote, preview],
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
        items={previewItems}
        locations={locations}
        totals={totals}
        preview={preview}
        selection={{
          canEdit: canEditSelections,
          disabled: submitting,
          previewUnavailable,
          onToggle: handleToggle,
        }}
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
        footerSlot={
          // Keep the panel mounted after a result so the confirmation / outcome stays on screen.
          (canDecide || settled) && token && agreement && quoteFingerprint ? (
            <QuoteLinkDecisionPanel
              token={token}
              agreement={agreement}
              quoteFingerprint={quoteFingerprint}
              selectedOptionalIds={[...selectedIds]}
              defaultSignerName={defaultSignerName}
              onSubmittingChange={setSubmitting}
              onSettled={onSettled}
            />
          ) : null
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
