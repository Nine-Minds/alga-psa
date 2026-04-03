'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Dialog, DialogContent, DialogDescription, DialogFooter } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ArrowLeft, Download } from 'lucide-react';
import type { IQuote, IQuoteItem, QuoteStatus } from '@alga-psa/types';
import { QUOTE_STATUS_METADATA } from '@alga-psa/types';
import {
  acceptClientQuote,
  downloadClientQuotePdf,
  getClientQuoteById,
  rejectClientQuote,
  updateClientQuoteSelections,
} from '@alga-psa/client-portal/actions';

const STATUS_VARIANTS: Record<QuoteStatus, BadgeVariant> = {
  draft: 'warning',
  pending_approval: 'warning',
  approved: 'secondary',
  sent: 'secondary',
  accepted: 'success',
  rejected: 'error',
  expired: 'outline',
  converted: 'success',
  cancelled: 'outline',
  superseded: 'outline',
  archived: 'outline',
};

function itemIsIncluded(item: IQuoteItem): boolean {
  return !item.is_optional || item.is_selected !== false;
}

interface QuoteDetailPageProps {
  quoteId: string;
}

const QuoteDetailPage: React.FC<QuoteDetailPageProps> = ({ quoteId }) => {
  const router = useRouter();
  const [quote, setQuote] = useState<IQuote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isUpdatingSelections, setIsUpdatingSelections] = useState(false);
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'accept' | 'reject' | null>(null);

  const formatCurrency = useCallback((amountInCents: number, currencyCode: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(amountInCents / 100);
  }, []);

  const formatDate = useCallback((date: string | { toString(): string } | undefined | null) => {
    if (!date) return 'N/A';
    try {
      const dateStr = typeof date === 'string' ? date : date.toString();
      const dateObj = new Date(dateStr);
      const year = dateObj.getFullYear();
      const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(dateObj);
      const day = dateObj.getDate();
      return `${month} ${day}, ${year}`;
    } catch {
      return 'Invalid date';
    }
  }, []);

  useEffect(() => {
    const fetchQuote = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetched = await getClientQuoteById(quoteId);
        setQuote(fetched);
      } catch (err) {
        console.error('Error loading quote:', err);
        setError('Failed to load quote details. You may not have access to this quote.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchQuote();
  }, [quoteId]);

  const optionalSelectedItemIds = useMemo(() => {
    if (!quote?.quote_items) return [];
    return quote.quote_items
      .filter((item) => item.is_optional && item.is_selected !== false)
      .map((item) => item.quote_item_id);
  }, [quote]);

  const hasOptionalItems = useMemo(() => {
    return (quote?.quote_items || []).some((item) => item.is_optional);
  }, [quote]);

  const canEditSelections = quote?.status === 'sent';

  const handleSelectionToggle = async (quoteItemId: string, checked: boolean) => {
    if (!quote) return;

    const nextSelectedIds = new Set(optionalSelectedItemIds);
    if (checked) {
      nextSelectedIds.add(quoteItemId);
    } else {
      nextSelectedIds.delete(quoteItemId);
    }

    const nextSelectedList = Array.from(nextSelectedIds);
    setSelectionError(null);
    setIsUpdatingSelections(true);

    try {
      const persistedQuote = await updateClientQuoteSelections(quote.quote_id, nextSelectedList);
      setQuote(persistedQuote);
    } catch (err) {
      console.error('Error updating optional quote selections:', err);
      setSelectionError('Failed to save your optional item selections. Please try again.');
    } finally {
      setIsUpdatingSelections(false);
    }
  };

  const handleAcceptQuote = async () => {
    if (!quote || quote.status !== 'sent') return;

    setDecisionError(null);
    setIsSubmittingDecision(true);

    try {
      const acceptedQuote = await acceptClientQuote(quote.quote_id, optionalSelectedItemIds);
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
      if (result.success && result.fileId) {
        const downloadUrl = `/api/documents/download/${result.fileId}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        setDecisionError(result.error || 'Failed to download PDF.');
      }
    } catch (err) {
      console.error('Error downloading quote PDF:', err);
      setDecisionError('Failed to download PDF. Please try again.');
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
          text="Loading quote..."
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
          Back to Quotes
        </Button>
        <Card className="p-6">
          <p className="text-destructive">{error || 'Quote not found'}</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button id="quote-detail-back" variant="outline" onClick={() => router.push('/client-portal/billing?tab=quotes')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Quotes
        </Button>
        <Button
          id="quote-detail-download-pdf"
          variant="outline"
          onClick={() => void handleDownloadPdf()}
          disabled={isDownloadingPdf}
        >
          <Download className="mr-2 h-4 w-4" />
          {isDownloadingPdf ? 'Downloading...' : 'Download PDF'}
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold">
                {quote.quote_number || `Quote ${quote.quote_id.slice(0, 8)}`}
              </h1>
              <p className="text-sm text-muted-foreground">{quote.title}</p>
            </div>
            <Badge variant={STATUS_VARIANTS[(quote.status || 'draft') as QuoteStatus] || 'secondary'}>
              {QUOTE_STATUS_METADATA[(quote.status || 'draft') as QuoteStatus]?.label || quote.status}
            </Badge>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {selectionError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {selectionError}
            </div>
          )}
          {decisionError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {decisionError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Quote Date</p>
              <p className="mt-1 text-sm">{formatDate(quote.quote_date)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Valid Until</p>
              <p className="mt-1 text-sm">{formatDate(quote.valid_until)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">PO Number</p>
              <p className="mt-1 text-sm">{quote.po_number || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Total</p>
              <p className="mt-1 text-lg font-semibold">
                {formatCurrency(quote.total_amount || 0, quote.currency_code)}
              </p>
            </div>
          </div>

          {quote.description && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Scope of Work</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.description}</p>
            </div>
          )}

          {quote.client_notes && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Notes</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.client_notes}</p>
            </div>
          )}

          {/* Line Items */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">Line Items</h3>
            {hasOptionalItems && (
              <p className="mb-3 text-sm text-muted-foreground">
                {canEditSelections
                  ? 'Toggle optional items to preview your preferred quote total before responding.'
                  : 'Optional item selections are locked once the quote is no longer awaiting your response.'}
              </p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-full divide-y text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Qty</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Rate</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(quote.quote_items || []).map((item) => {
                    const isIncluded = itemIsIncluded(item);

                    return (
                      <tr key={item.quote_item_id} className={!isIncluded ? 'opacity-60' : undefined}>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <span>{item.description}</span>
                            {item.is_optional && (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="text-[10px]">Optional</Badge>
                                <span>{item.is_selected !== false ? 'Included' : 'Excluded'}</span>
                              </div>
                            )}
                            {item.is_optional && (
                              <div className="pt-1">
                                <Switch
                                  id={`quote-item-${item.quote_item_id}-selection`}
                                  checked={item.is_selected !== false}
                                  disabled={!canEditSelections || isUpdatingSelections}
                                  onCheckedChange={(checked) => void handleSelectionToggle(item.quote_item_id, checked)}
                                  className="data-[state=checked]:bg-primary-500"
                                  label={item.is_selected !== false ? 'Include' : 'Exclude'}
                                  size="sm"
                                />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{item.quantity}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatCurrency(item.unit_price || 0, quote.currency_code)}
                        </td>
                        <td className="px-3 py-2">
                          {formatCurrency(item.total_price || 0, quote.currency_code)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {isUpdatingSelections && (
              <p className="mt-2 text-sm text-muted-foreground">Saving optional item selections...</p>
            )}
          </div>

          {/* Totals */}
          <div className="grid gap-2 md:max-w-sm md:ml-auto">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(quote.subtotal || 0, quote.currency_code)}</span>
            </div>
            {(quote.discount_total ?? 0) !== 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Discounts</span>
                <span>-{formatCurrency(Math.abs(quote.discount_total || 0), quote.currency_code)}</span>
              </div>
            )}
            {(quote.tax ?? 0) !== 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span>{formatCurrency(quote.tax || 0, quote.currency_code)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>Total</span>
              <span>{formatCurrency(quote.total_amount || 0, quote.currency_code)}</span>
            </div>
          </div>

          {/* Accept / Reject actions */}
          {quote.status === 'sent' && (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 px-4 py-4">
              <div className="sm:flex sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <p className="text-sm font-medium">Ready to respond?</p>
                  <p className="text-sm text-muted-foreground">
                    {hasOptionalItems
                      ? 'Accepting sends your optional-item selections to the MSP for review.'
                      : 'Accepting confirms this quote. The MSP will proceed accordingly.'}
                  </p>
                </div>
                <Button
                  id="accept-quote-button"
                  onClick={() => setConfirmAction('accept')}
                  disabled={isUpdatingSelections || isSubmittingDecision}
                  className="mt-2 sm:mt-0"
                >
                  Accept Quote
                </Button>
              </div>

              <div className="space-y-2 rounded-md border bg-background/70 p-3">
                <p className="text-sm text-muted-foreground">
                  If this quote doesn't work for you, leave a comment so the MSP can revise it.
                </p>
                <TextArea
                  id="reject-quote-comment"
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Tell the MSP what needs to change"
                  disabled={isUpdatingSelections || isSubmittingDecision}
                  className="min-h-24"
                />
                <div className="flex justify-end">
                  <Button
                    id="reject-quote-button"
                    variant="outline"
                    onClick={() => {
                      if (!rejectionReason.trim()) {
                        setDecisionError('Please add a short comment before rejecting this quote.');
                        return;
                      }
                      setConfirmAction('reject');
                    }}
                    disabled={isUpdatingSelections || isSubmittingDecision}
                  >
                    Reject Quote
                  </Button>
                </div>
              </div>
            </div>
          )}

          {quote.status === 'accepted' && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm">
              Quote accepted{hasOptionalItems ? '. Your selected optional items have been shared with the MSP.' : '.'}
            </div>
          )}

          {quote.status === 'rejected' && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm">
              Quote rejected{quote.rejection_reason ? `: ${quote.rejection_reason}` : '.'}
            </div>
          )}

          {quote.terms_and_conditions && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Terms & Conditions</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.terms_and_conditions}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Confirm dialog */}
      <Dialog
        id="quote-confirm-dialog"
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={confirmAction === 'accept' ? 'Accept Quote' : 'Reject Quote'}
      >
        <DialogContent>
          <DialogDescription>
            {confirmAction === 'accept'
              ? hasOptionalItems
                ? 'Accept this quote with your current optional item selections? Your choices will be sent to the MSP for review.'
                : 'Accept this quote? The MSP will be notified.'
              : 'Reject this quote and send your comment to the MSP? They may revise and resend the quote.'}
          </DialogDescription>
          <DialogFooter>
            <Button
              id="quote-confirm-cancel"
              variant="outline"
              onClick={() => setConfirmAction(null)}
              disabled={isSubmittingDecision}
            >
              Cancel
            </Button>
            <Button
              id="quote-confirm-submit"
              onClick={() => void (confirmAction === 'accept' ? handleAcceptQuote() : handleRejectQuote())}
              disabled={isSubmittingDecision}
            >
              {isSubmittingDecision ? 'Submitting...' : confirmAction === 'accept' ? 'Accept' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QuoteDetailPage;
