'use client';

/**
 * Public, read-only quote review (email-link page). Props are serializable view
 * data only: the server page strips tokens, link rows, tenant and contact ids
 * before anything reaches this client component.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { isOptional, isQuoteItemIncluded } from '@alga-psa/core';
import type { IQuoteItem } from '@alga-psa/types';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import { I18nProvider, useTranslation, type PreloadedNamespaceResources } from '@alga-psa/ui/lib/i18n/client';
import type { SupportedLocale } from '@alga-psa/core/i18n/config';
import type { ClientPortalLocationSummary } from '@alga-psa/client-portal/actions';
import { QuoteDocumentView, type QuoteDocumentQuote } from './QuoteDocumentView';
import { computePublicQuotePreview } from './publicQuotePreview';
import QuoteLinkDecisionPanel, { type QuoteLinkAgreement, type QuoteLinkCommittedSnapshot, type QuoteLinkSettledOutcome } from './QuoteLinkDecisionPanel';

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
  const initialSelectedIds = useMemo(
    () => new Set(items.filter((i) => isOptional(i as IQuoteItem) && isQuoteItemIncluded(i as IQuoteItem)).map((i) => i.quote_item_id)),
    [items],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(initialSelectedIds));
  const [submitting, setSubmitting] = useState(false);
  const [settled, setSettled] = useState(false);
  // Status the server confirmed through the decision route; null until then (or for changed / invalid).
  const [confirmedStatus, setConfirmedStatus] = useState<'accepted' | 'rejected' | null>(null);
  // Set only by a fresh `decided` outcome: the quote exactly as the server persisted it.
  const [committed, setCommitted] = useState<QuoteLinkCommittedSnapshot | null>(null);
  // A fresh accept that came back without a snapshot: the submitted selection is the one the
  // server committed, so keep it and keep previewing its totals instead of reverting.
  const [acceptedWithoutSnapshot, setAcceptedWithoutSnapshot] = useState(false);
  const onSettled = useCallback((outcome: QuoteLinkSettledOutcome) => {
    setSettled(true);
    if (outcome.kind === 'decided' || outcome.kind === 'already_decided') setConfirmedStatus(outcome.decision);
    if (outcome.kind === 'decided' && outcome.decision === 'accepted' && outcome.committed) {
      setCommitted(outcome.committed);
      setAcceptedWithoutSnapshot(false);
      setSelectedIds(new Set(outcome.committed.selectedOptionalQuoteItemIds));
    } else if (outcome.kind === 'decided' && outcome.decision === 'accepted') {
      setCommitted(null);
      setAcceptedWithoutSnapshot(true);
    } else {
      setAcceptedWithoutSnapshot(false);
      // Rejected, already decided, changed, invalid: the local toggles were never committed.
      // Show the server-rendered selection and totals so rows and totals agree.
      setCommitted(null);
      setSelectedIds(new Set(initialSelectedIds));
    }
  }, [initialSelectedIds]);
  const displayQuote = useMemo(
    () => (confirmedStatus ? { ...quote, status: confirmedStatus } : quote),
    [quote, confirmedStatus],
  );

  const canDecide = quote.status === 'sent' && !decidedNotice && !!token && !!agreement && !!quoteFingerprint && !settled;
  const hasOptionalItems = items.some((i) => i.is_optional);
  const canEditSelections = canDecide && hasOptionalItems;

  const previewItems = useMemo(
    () => items.map((i) => (i.is_optional ? { ...i, is_selected: selectedIds.has(i.quote_item_id) } : i)) as IQuoteItem[],
    [items, selectedIds],
  );
  // Same pure function the server uses; if any base row lacks its tax input, fall back to persisted totals.
  const preview = useMemo(
    () => (canEditSelections || (acceptedWithoutSnapshot && hasOptionalItems) ? computePublicQuotePreview(previewItems) : null),
    [canEditSelections, acceptedWithoutSnapshot, hasOptionalItems, previewItems],
  );
  const previewUnavailable = canEditSelections && preview === null;

  const handleToggle = useCallback((id: string, checked: boolean) => {
    setSelectedIds((cur) => {
      const next = new Set(cur);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  // No notice above an active form: "read-only" would contradict the Accept / Decline controls.
  // After a settled decision the panel itself shows the outcome, so no notice either.
  const noticeText = canDecide || settled
    ? null
    : decidedNotice === 'accepted'
      ? t('quotes.public.notice.accepted', { defaultValue: 'This quote has been accepted. It is shown here for your records.' })
      : decidedNotice === 'declined'
        ? t('quotes.public.notice.declined', { defaultValue: 'This quote has been declined. It is shown here for your records.' })
        : decidedNotice === 'converted'
          ? t('quotes.public.notice.converted', { defaultValue: 'This quote has been accepted and is being fulfilled. It is shown here for your records.' })
          : t('quotes.public.notice.readOnly', { defaultValue: 'This is a read-only view of your quote.' });

  const totals = useMemo(
    () => ({
      subtotal: committed ? committed.subtotal : preview ? preview.subtotal : quote.subtotal || 0,
      discountTotal: committed ? committed.discount_total : preview ? preview.discountTotal : quote.discount_total || 0,
      tax: committed ? committed.tax : preview ? preview.tax : quote.tax || 0,
      totalAmount: committed ? committed.total_amount : preview ? preview.totalAmount : quote.total_amount || 0,
    }),
    [quote, preview, committed],
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
        quote={displayQuote}
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
          noticeText ? (
            <div
              id="public-quote-notice"
              className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm"
            >
              {noticeText}
            </div>
          ) : null
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
