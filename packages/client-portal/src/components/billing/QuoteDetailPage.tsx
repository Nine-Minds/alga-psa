'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { computeQuoteTotals, isOptional, isQuoteItemIncluded } from '@alga-psa/core';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ArrowLeft, Download } from 'lucide-react';
import { Card } from '@alga-psa/ui/components/Card';
import type { IQuote } from '@alga-psa/types';
import {
  acceptClientQuote,
  downloadClientQuotePdf,
  getClientQuoteById,
  getLocationsForClientQuote,
  rejectClientQuote,
  type ClientPortalLocationSummary,
} from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { QuoteDocumentView, UNASSIGNED_KEY } from './QuoteDocumentView';

const isBillingActionError = (
  value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

interface QuoteDetailPageProps {
  quoteId: string;
}

const QuoteDetailPage: React.FC<QuoteDetailPageProps> = ({ quoteId }) => {
  const router = useRouter();
  const { t } = useTranslation('features/billing');
  const [quote, setQuote] = useState<IQuote | null>(null);
  const [clientLocations, setClientLocations] = useState<ClientPortalLocationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  // Local-only optional-item selection. Toggling never touches the server; the
  // selection is persisted solely by Accept.
  const [selectedOptionalIds, setSelectedOptionalIds] = useState<Set<string>>(new Set());
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'accept' | 'reject' | null>(null);
  useEffect(() => {
    const fetchQuote = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [fetched, locations] = await Promise.all([
          getClientQuoteById(quoteId),
          getLocationsForClientQuote(quoteId).catch(() => [] as ClientPortalLocationSummary[]),
        ]);

        if (isBillingActionError(fetched)) {
          setQuote(null);
          setClientLocations([]);
          setError(getErrorMessage(fetched));
          return;
        }

        if (isBillingActionError(locations)) {
          setQuote(null);
          setClientLocations([]);
          setError(getErrorMessage(locations));
          return;
        }

        setQuote(fetched);
        setClientLocations(Array.isArray(locations) ? locations : []);
      } catch (err) {
        console.error('Error loading quote:', err);
        setError('Failed to load quote details. You may not have access to this quote.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchQuote();
  }, [quoteId]);

  // (Re)initialise the local selection from the persisted `is_selected` values
  // whenever a quote is loaded or replaced (e.g. after Accept/Reject).
  useEffect(() => {
    setSelectedOptionalIds(
      new Set(
        (quote?.quote_items || [])
          .filter((item) => isOptional(item) && isQuoteItemIncluded(item))
          .map((item) => item.quote_item_id)
      )
    );
  }, [quote]);

  const hasOptionalItems = useMemo(() => {
    return (quote?.quote_items || []).some((item) => item.is_optional);
  }, [quote]);

  const canEditSelections = quote?.status === 'sent';

  const handleSelectionToggle = (quoteItemId: string, checked: boolean) => {
    setSelectedOptionalIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(quoteItemId);
      } else {
        next.delete(quoteItemId);
      }
      return next;
    });
  };

  // Items as the client currently sees them: persisted rows with optional
  // `is_selected` overridden by the local selection.
  const previewItems = useMemo(
    () =>
      (quote?.quote_items || []).map((item) =>
        item.is_optional ? { ...item, is_selected: selectedOptionalIds.has(item.quote_item_id) } : item
      ),
    [quote, selectedOptionalIds]
  );

  // Preview totals come from the same pure function the server's
  // recalculateQuoteFinancials uses. If any base row lacks the server-resolved
  // tax input, fall back to the persisted totals (never to a write).
  const preview = useMemo(() => {
    if (!quote || !canEditSelections || !hasOptionalItems) return null;
    const baseRows = previewItems.filter((item) => !item.is_discount);
    if (baseRows.some((item) => typeof item.tax_amount_if_included !== 'number')) return null;
    return computeQuoteTotals(
      previewItems.map((item) => ({
        ...item,
        id: item.quote_item_id,
        groupKey: item.location_id && item.location_id.trim().length > 0 ? item.location_id : UNASSIGNED_KEY,
        taxAmountIfIncluded: item.tax_amount_if_included ?? 0,
      }))
    );
  }, [quote, canEditSelections, hasOptionalItems, previewItems]);

  // LEVERAGE: friction quote-tax-resolution — tax is only resolvable through the DB-backed engine, so the portal needs a server-resolved per-row tax input instead of deriving it from tax_rate
  const previewUnavailable = canEditSelections && hasOptionalItems && preview === null;

  const displayTotals = {
    subtotal: preview ? preview.subtotal : quote?.subtotal || 0,
    discountTotal: preview ? preview.discountTotal : quote?.discount_total || 0,
    tax: preview ? preview.tax : quote?.tax || 0,
    totalAmount: preview ? preview.totalAmount : quote?.total_amount || 0,
  };

  const handleAcceptQuote = async () => {
    if (!quote || quote.status !== 'sent') return;

    setDecisionError(null);
    setIsSubmittingDecision(true);

    try {
      const acceptedQuote = await acceptClientQuote(quote.quote_id, [...selectedOptionalIds]);
      if (isBillingActionError(acceptedQuote)) {
        setDecisionError(getErrorMessage(acceptedQuote));
        setConfirmAction(null);
        return;
      }
      setQuote(acceptedQuote);
      setRejectionReason('');
      setConfirmAction(null);
    } catch (err) {
      console.error('Error accepting quote:', err);
      setDecisionError('Failed to accept the quote. Please try again.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const handleRejectQuote = async () => {
    if (!quote || quote.status !== 'sent') return;

    if (!rejectionReason.trim()) {
      setDecisionError('Please add a short comment before rejecting this quote.');
      setConfirmAction(null);
      return;
    }

    setDecisionError(null);
    setIsSubmittingDecision(true);

    try {
      const rejectedQuote = await rejectClientQuote(quote.quote_id, rejectionReason);
      if (isBillingActionError(rejectedQuote)) {
        setDecisionError(getErrorMessage(rejectedQuote));
        setConfirmAction(null);
        return;
      }
      setQuote(rejectedQuote);
      setRejectionReason('');
      setConfirmAction(null);
    } catch (err) {
      console.error('Error rejecting quote:', err);
      setDecisionError('Failed to reject the quote. Please try again.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quote) return;

    setIsDownloadingPdf(true);
    try {
      const result = await downloadClientQuotePdf(quote.quote_id);
      if (isBillingActionError(result)) {
        setDecisionError(getErrorMessage(result));
        return;
      }
      if (result.success && result.fileId) {
        const downloadUrl = `/api/documents/download/${result.fileId}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = result.fileName ?? '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        setDecisionError(result.error || t('quotes.detail.downloadFailed', { defaultValue: 'Failed to download PDF.' }));
      }
    } catch (err) {
      console.error('Error downloading quote PDF:', err);
      setDecisionError(t('quotes.detail.downloadFailedRetry', { defaultValue: 'Failed to download PDF. Please try again.' }));
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  if (isLoading) {
    return (
      <div className="py-12">
        <LoadingIndicator
          className="text-muted-foreground"
          layout="stacked"
          spinnerProps={{ size: 'md' }}
          text={t('quotes.detail.loading', { defaultValue: 'Loading quote...' })}
          textClassName="text-muted-foreground"
        />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="space-y-4 py-4">
        <Button id="quote-detail-back" variant="outline" onClick={() => router.push('/client-portal/billing?tab=quotes')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('quotes.detail.backToQuotes', { defaultValue: 'Back to Quotes' })}
        </Button>
        <Card className="p-6">
          <p className="text-destructive">{error || t('quotes.detail.notFound', { defaultValue: 'Quote not found' })}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button id="quote-detail-back" variant="outline" onClick={() => router.push('/client-portal/billing?tab=quotes')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t('quotes.detail.backToQuotes', { defaultValue: 'Back to Quotes' })}
        </Button>
        <Button
          id="quote-detail-download-pdf"
          variant="outline"
          onClick={() => void handleDownloadPdf()}
          disabled={isDownloadingPdf}
        >
          <Download className="mr-2 h-4 w-4" />
          {isDownloadingPdf
            ? t('quotes.detail.downloading', { defaultValue: 'Downloading...' })
            : t('quotes.detail.downloadPdf', { defaultValue: 'Download PDF' })}
        </Button>
      </div>

      <QuoteDocumentView
        quote={quote}
        items={previewItems}
        locations={clientLocations}
        totals={displayTotals}
        preview={preview}
        selection={{
          canEdit: canEditSelections,
          disabled: isSubmittingDecision,
          previewUnavailable,
          onToggle: handleSelectionToggle,
        }}
        topSlot={
          decisionError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {decisionError}
            </div>
          ) : null
        }
        footerSlot={
          <>
          {/* Accept / Reject actions */}
          {quote.status === 'sent' && (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-4">
              <div className="sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <p className="text-sm font-medium">{t('quotes.detail.readyToRespond', { defaultValue: 'Ready to respond?' })}</p>
                  <p className="text-sm text-muted-foreground">
                    {hasOptionalItems
                      ? t('quotes.detail.acceptHintOptional', { defaultValue: 'Accepting sends your optional-item selections to the MSP for review.' })
                      : t('quotes.detail.acceptHint', { defaultValue: 'Accepting confirms this quote. The MSP will proceed accordingly.' })}
                  </p>
                </div>
                <Button
                  id="accept-quote-button"
                  onClick={() => setConfirmAction('accept')}
                  disabled={isSubmittingDecision}
                  className="mt-2 sm:mt-0"
                >
                  {t('quotes.detail.acceptQuote', { defaultValue: 'Accept Quote' })}
                </Button>
              </div>

              <div className="space-y-2 rounded-md border bg-background/70 p-3">
                <p className="text-sm text-muted-foreground">
                  {t('quotes.detail.rejectPrompt', { defaultValue: "If this quote doesn't work for you, leave a comment so the MSP can revise it." })}
                </p>
                <TextArea
                  id="reject-quote-comment"
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder={t('quotes.detail.rejectPlaceholder', { defaultValue: 'Tell the MSP what needs to change' })}
                  disabled={isSubmittingDecision}
                  className="min-h-24"
                />
                <div className="flex justify-end">
                  <Button
                    id="reject-quote-button"
                    variant="outline"
                    onClick={() => {
                      if (!rejectionReason.trim()) {
                        setDecisionError(t('quotes.detail.rejectCommentRequired', { defaultValue: 'Please add a short comment before rejecting this quote.' }));
                        return;
                      }
                      setConfirmAction('reject');
                    }}
                    disabled={isSubmittingDecision}
                  >
                    {t('quotes.detail.rejectQuote', { defaultValue: 'Reject Quote' })}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {quote.status === 'accepted' && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm">
              {hasOptionalItems
                ? t('quotes.detail.acceptedBannerOptional', { defaultValue: 'Quote accepted. Your selected optional items have been shared with the MSP.' })
                : t('quotes.detail.acceptedBanner', { defaultValue: 'Quote accepted.' })}
            </div>
          )}

          {quote.status === 'rejected' && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm">
              {quote.rejection_reason
                ? t('quotes.detail.rejectedBannerWithReason', { defaultValue: 'Quote rejected: {{reason}}', reason: quote.rejection_reason })
                : t('quotes.detail.rejectedBanner', { defaultValue: 'Quote rejected.' })}
            </div>
          )}
          </>
        }
      />


      {/* Confirm dialog */}
      <Dialog
        id="quote-confirm-dialog"
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={confirmAction === 'accept'
          ? t('quotes.detail.acceptQuote', { defaultValue: 'Accept Quote' })
          : t('quotes.detail.rejectQuote', { defaultValue: 'Reject Quote' })}
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              id="quote-confirm-cancel"
              variant="outline"
              onClick={() => setConfirmAction(null)}
              disabled={isSubmittingDecision}
            >
              {t('quotes.detail.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="quote-confirm-submit"
              onClick={() => void (confirmAction === 'accept' ? handleAcceptQuote() : handleRejectQuote())}
              disabled={isSubmittingDecision}
            >
              {isSubmittingDecision
                ? t('quotes.detail.submitting', { defaultValue: 'Submitting...' })
                : confirmAction === 'accept'
                  ? t('quotes.detail.accept', { defaultValue: 'Accept' })
                  : t('quotes.detail.reject', { defaultValue: 'Reject' })}
            </Button>
          </div>
        }
      >
        <DialogContent>
          <DialogDescription>
            {confirmAction === 'accept'
              ? hasOptionalItems
                ? t('quotes.detail.confirmAcceptOptional', { defaultValue: 'Accept this quote with your current optional item selections? Your choices will be sent to the MSP for review.' })
                : t('quotes.detail.confirmAccept', { defaultValue: 'Accept this quote? The MSP will be notified.' })
              : t('quotes.detail.confirmReject', { defaultValue: 'Reject this quote and send your comment to the MSP? They may revise and resend the quote.' })}
          </DialogDescription>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QuoteDetailPage;
