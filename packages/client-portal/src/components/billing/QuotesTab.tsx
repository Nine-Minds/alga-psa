'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import type { ColumnDefinition, IQuote, IQuoteItem, IQuoteWithClient, QuoteStatus } from '@alga-psa/types';
import { QUOTE_STATUS_METADATA } from '@alga-psa/types';
import { acceptClientQuote, downloadClientQuotePdf, getClientQuoteById, getClientQuotes, rejectClientQuote, updateClientQuoteSelections } from '@alga-psa/client-portal/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, X } from 'lucide-react';

interface QuotesTabProps {
  formatCurrency: (amount: number, currencyCode?: string) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
}

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

function getQuoteItemAmount(item: IQuoteItem): number {
  return Number(item.total_price ?? (Number(item.quantity ?? 0) * Number(item.unit_price ?? 0)));
}

function getScopedDiscountBaseAmount(
  item: IQuoteItem,
  baseSubtotal: number,
  baseItemTotals: Map<string, number>,
  baseServiceTotals: Map<string, number>
): number {
  if (item.applies_to_item_id) {
    return baseItemTotals.get(item.applies_to_item_id) ?? 0;
  }

  if (item.applies_to_service_id) {
    return baseServiceTotals.get(item.applies_to_service_id) ?? 0;
  }

  return baseSubtotal;
}

function getResolvedQuoteItemAmount(
  item: IQuoteItem,
  baseSubtotal: number,
  baseItemTotals: Map<string, number>,
  baseServiceTotals: Map<string, number>
): number {
  if (!item.is_discount) {
    return getQuoteItemAmount(item);
  }

  const scopedBaseAmount = getScopedDiscountBaseAmount(item, baseSubtotal, baseItemTotals, baseServiceTotals);
  if (item.discount_type === 'percentage') {
    return Math.round(scopedBaseAmount * ((Number(item.discount_percentage) || 0) / 100));
  }

  return getQuoteItemAmount(item);
}

function calculateQuoteTotals(items: IQuoteItem[]): Pick<IQuote, 'subtotal' | 'discount_total' | 'tax' | 'total_amount'> {
  const includedBaseItems = items.filter((item) => !item.is_discount && itemIsIncluded(item));
  const baseSubtotal = includedBaseItems.reduce((sum, item) => sum + getQuoteItemAmount(item), 0);
  const baseItemTotals = new Map(includedBaseItems.map((item) => [item.quote_item_id, getQuoteItemAmount(item)]));
  const baseServiceTotals = new Map<string, number>();

  for (const item of includedBaseItems) {
    if (!item.service_id) {
      continue;
    }

    baseServiceTotals.set(item.service_id, (baseServiceTotals.get(item.service_id) ?? 0) + getQuoteItemAmount(item));
  }

  let subtotal = 0;
  let discountTotal = 0;
  let tax = 0;

  for (const item of items) {
    if (!itemIsIncluded(item)) {
      continue;
    }

    const resolvedAmount = getResolvedQuoteItemAmount(item, baseSubtotal, baseItemTotals, baseServiceTotals);

    if (item.is_discount) {
      discountTotal += resolvedAmount;
      continue;
    }

    subtotal += resolvedAmount;
    if (item.is_taxable !== false && item.tax_rate) {
      tax += Math.round(resolvedAmount * (Number(item.tax_rate) / 100));
    }
  }

  return {
    subtotal,
    discount_total: discountTotal,
    tax,
    total_amount: subtotal - discountTotal + tax,
  };
}

function applyOptionalSelections(
  quote: IQuote,
  selectedOptionalQuoteItemIds: string[]
): IQuote {
  const selectedIds = new Set(selectedOptionalQuoteItemIds);
  const quoteItems = (quote.quote_items || []).map((item) => (
    item.is_optional
      ? { ...item, is_selected: selectedIds.has(item.quote_item_id) }
      : item
  ));

  return {
    ...quote,
    quote_items: quoteItems,
    ...calculateQuoteTotals(quoteItems),
  };
}

const QuotesTab: React.FC<QuotesTabProps> = React.memo(({ formatCurrency, formatDate }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quotes, setQuotes] = useState<IQuoteWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedQuote, setSelectedQuote] = useState<IQuote | null>(null);
  const [isUpdatingSelections, setIsUpdatingSelections] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const selectedQuoteId = searchParams?.get('quoteId');

  const optionalSelectedItemIds = useMemo(() => {
    if (!selectedQuote?.quote_items) {
      return [];
    }

    return selectedQuote.quote_items
      .filter((item) => item.is_optional && item.is_selected !== false)
      .map((item) => item.quote_item_id);
  }, [selectedQuote]);

  const canEditSelections = selectedQuote?.status === 'sent';

  const syncQuoteSummary = (nextQuote: IQuote) => {
    setQuotes((currentQuotes) => currentQuotes.map((quote) => (
      quote.quote_id === nextQuote.quote_id
        ? {
            ...quote,
            status: nextQuote.status,
            subtotal: nextQuote.subtotal,
            discount_total: nextQuote.discount_total,
            tax: nextQuote.tax,
            total_amount: nextQuote.total_amount,
            accepted_at: nextQuote.accepted_at,
            accepted_by: nextQuote.accepted_by,
          }
        : quote
    )));
  };

  const updateUrlParams = (params: { [key: string]: string | null }) => {
    const newParams = new URLSearchParams(searchParams?.toString() || '');
    Object.entries(params).forEach(([key, value]) => {
      if (value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });
    router.push(`/client-portal/billing?${newParams.toString()}`);
  };

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetchedQuotes = await getClientQuotes();
        setQuotes(fetchedQuotes);
      } catch (err) {
        console.error('Error loading quotes:', err);
        setError('Failed to load quotes');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (!selectedQuoteId) {
      setSelectedQuote(null);
      return;
    }

    const fetchDetail = async () => {
      try {
        setSelectionError(null);
        setDecisionError(null);
        setRejectionReason('');
        const quote = await getClientQuoteById(selectedQuoteId);
        setSelectedQuote(quote);
      } catch (err) {
        console.error('Error loading quote detail:', err);
        setSelectedQuote(null);
      }
    };

    fetchDetail();
  }, [selectedQuoteId]);

  const handleSelectionToggle = async (quoteItemId: string, checked: boolean) => {
    if (!selectedQuote) {
      return;
    }

    const nextSelectedIds = new Set(optionalSelectedItemIds);
    if (checked) {
      nextSelectedIds.add(quoteItemId);
    } else {
      nextSelectedIds.delete(quoteItemId);
    }

    const nextSelectedList = Array.from(nextSelectedIds);
    const previousQuote = selectedQuote;
    const optimisticQuote = applyOptionalSelections(previousQuote, nextSelectedList);

    setSelectionError(null);
    setSelectedQuote(optimisticQuote);
    syncQuoteSummary(optimisticQuote);
    setIsUpdatingSelections(true);

    try {
      const persistedQuote = await updateClientQuoteSelections(selectedQuote.quote_id, nextSelectedList);
      setSelectedQuote(persistedQuote);
      syncQuoteSummary(persistedQuote);
    } catch (err) {
      console.error('Error updating optional quote selections:', err);
      setSelectedQuote(previousQuote);
      syncQuoteSummary(previousQuote);
      setSelectionError('Failed to save your optional item selections. Please try again.');
    } finally {
      setIsUpdatingSelections(false);
    }
  };

  const handleAcceptQuote = async () => {
    if (!selectedQuote || selectedQuote.status !== 'sent') {
      return;
    }

    const confirmed = window.confirm('Accept this quote with your current optional item selections?');
    if (!confirmed) {
      return;
    }

    setDecisionError(null);
    setIsSubmittingDecision(true);

    try {
      const acceptedQuote = await acceptClientQuote(selectedQuote.quote_id, optionalSelectedItemIds);
      setSelectedQuote(acceptedQuote);
      syncQuoteSummary(acceptedQuote);
      setRejectionReason('');
    } catch (err) {
      console.error('Error accepting quote:', err);
      setDecisionError('Failed to accept the quote. Please try again.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const handleRejectQuote = async () => {
    if (!selectedQuote || selectedQuote.status !== 'sent') {
      return;
    }

    if (!rejectionReason.trim()) {
      setDecisionError('Please add a short comment before rejecting this quote.');
      return;
    }

    const confirmed = window.confirm('Reject this quote and send your comment to the MSP?');
    if (!confirmed) {
      return;
    }

    setDecisionError(null);
    setIsSubmittingDecision(true);

    try {
      const rejectedQuote = await rejectClientQuote(selectedQuote.quote_id, rejectionReason);
      setSelectedQuote(rejectedQuote);
      syncQuoteSummary(rejectedQuote);
      setRejectionReason('');
    } catch (err) {
      console.error('Error rejecting quote:', err);
      setDecisionError('Failed to reject the quote. Please try again.');
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedQuote) {
      return;
    }

    setIsDownloadingPdf(true);
    try {
      const result = await downloadClientQuotePdf(selectedQuote.quote_id);
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

  const quoteColumns: ColumnDefinition<IQuoteWithClient>[] = useMemo(() => [
    {
      title: 'Quote #',
      dataIndex: 'quote_number',
      render: (value, record) => value || `Draft ${record.quote_id}`,
    },
    {
      title: 'Title',
      dataIndex: 'title',
    },
    {
      title: 'Amount',
      dataIndex: 'total_amount',
      render: (value, record) => formatCurrency(typeof value === 'number' ? value : 0, record.currency_code),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value) => {
        const status = (value || 'draft') as QuoteStatus;
        return (
          <Badge variant={STATUS_VARIANTS[status] || 'secondary'}>
            {QUOTE_STATUS_METADATA[status]?.label || status}
          </Badge>
        );
      },
    },
    {
      title: 'Date',
      dataIndex: 'quote_date',
      render: (value) => formatDate(value),
    },
  ], [formatCurrency, formatDate]);

  if (isLoading) {
    return (
      <div id="quotes-loading" className="py-4">
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div id="client-quotes-tab" className="py-4">
      {error && <div className="mb-4 text-red-500">{error}</div>}
      <DataTable
        id="client-portal-quotes"
        data={quotes}
        columns={quoteColumns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={10}
        onRowClick={(quote) => updateUrlParams({ quoteId: quote.quote_id })}
      />
      {quotes.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-gray-500">No quotes found</p>
        </div>
      )}
      {selectedQuote && (
        <div className="mt-8 overflow-hidden rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
            <div>
              <h3 className="text-lg font-semibold">
                Quote Details - {selectedQuote.quote_number || `Draft ${selectedQuote.quote_id}`}
              </h3>
              <p className="text-sm text-gray-500">{selectedQuote.title}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                id="download-quote-pdf"
                variant="outline"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={isDownloadingPdf}
              >
                <Download className="mr-1 h-4 w-4" />
                {isDownloadingPdf ? 'Downloading…' : 'Download PDF'}
              </Button>
              <Button id="close-quote-details" variant="ghost" size="sm" onClick={() => updateUrlParams({ quoteId: null })}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-6 p-4">
            {selectionError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {selectionError}
              </div>
            )}
            {decisionError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {decisionError}
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Status</p>
                <div className="mt-1">
                  <Badge variant={STATUS_VARIANTS[(selectedQuote.status || 'draft') as QuoteStatus] || 'secondary'}>
                    {QUOTE_STATUS_METADATA[(selectedQuote.status || 'draft') as QuoteStatus]?.label || selectedQuote.status}
                  </Badge>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Quote Date</p>
                <p className="mt-1 text-sm text-gray-900">{formatDate(selectedQuote.quote_date)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Valid Until</p>
                <p className="mt-1 text-sm text-gray-900">{formatDate(selectedQuote.valid_until)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Total</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">
                  {formatCurrency(selectedQuote.total_amount || 0, selectedQuote.currency_code)}
                </p>
              </div>
            </div>

            {selectedQuote.description && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Scope of Work</h4>
                <p className="text-sm text-gray-700">{selectedQuote.description}</p>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-sm font-semibold text-gray-900">Line Items</h4>
              {selectedQuote.quote_items?.some((item) => item.is_optional) && (
                <p className="mb-3 text-sm text-gray-600">
                  {canEditSelections
                    ? 'Toggle optional items to preview your preferred quote total before responding.'
                    : 'Optional item selections are locked once the quote is no longer awaiting your response.'}
                </p>
              )}
              <div className="overflow-x-auto rounded-md border">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Description</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Qty</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Rate</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white">
                    {(selectedQuote.quote_items || []).map((item) => {
                      const isIncluded = itemIsIncluded(item);

                      return (
                        <tr key={item.quote_item_id} className={!isIncluded ? 'bg-amber-50/40' : undefined}>
                        <td className="px-3 py-2 text-gray-900">
                          <div className="flex flex-col gap-1">
                            <span>{item.description}</span>
                            {item.is_optional && (
                              <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700">
                                <span>Optional item</span>
                                <span aria-hidden="true">•</span>
                                <span>{item.is_selected !== false ? 'Included in total' : 'Excluded from total'}</span>
                              </div>
                            )}
                            {item.is_optional && (
                              <div className="pt-1">
                                <Switch
                                  id={`quote-item-${item.quote_item_id}-selection`}
                                  checked={item.is_selected !== false}
                                  disabled={!canEditSelections || isUpdatingSelections}
                                  onCheckedChange={(checked) => handleSelectionToggle(item.quote_item_id, checked)}
                                  className="data-[state=checked]:bg-primary-500"
                                  label={item.is_selected !== false ? 'Include' : 'Exclude'}
                                  size="sm"
                                />
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{item.quantity}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {formatCurrency(item.unit_price || 0, selectedQuote.currency_code)}
                        </td>
                        <td className={`px-3 py-2 ${isIncluded ? 'text-gray-900' : 'text-amber-700'}`}>
                          <div className="flex flex-col gap-1">
                            <span>{formatCurrency(item.total_price || 0, selectedQuote.currency_code)}</span>
                            {!isIncluded && (
                              <span className="text-xs">Not counted in current total</span>
                            )}
                          </div>
                        </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {isUpdatingSelections && (
                <p className="mt-2 text-sm text-gray-500">Saving optional item selections…</p>
              )}
            </div>

            <div className="grid gap-2 md:max-w-sm md:ml-auto">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span>{formatCurrency(selectedQuote.subtotal || 0, selectedQuote.currency_code)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Discounts</span>
                <span>{formatCurrency(selectedQuote.discount_total || 0, selectedQuote.currency_code)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Tax</span>
                <span>{formatCurrency(selectedQuote.tax || 0, selectedQuote.currency_code)}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
                <span>Total</span>
                <span>{formatCurrency(selectedQuote.total_amount || 0, selectedQuote.currency_code)}</span>
              </div>
            </div>

            {selectedQuote.status === 'sent' && (
              <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="md:flex md:items-center md:justify-between md:gap-4">
                  <div>
                    <p className="text-sm font-medium text-emerald-900">Ready to respond?</p>
                    <p className="text-sm text-emerald-800">
                      Accepting this quote sends your optional-item selections back to the MSP for review before conversion.
                    </p>
                  </div>
                  <Button
                    id="accept-quote-button"
                    onClick={handleAcceptQuote}
                    disabled={isUpdatingSelections || isSubmittingDecision}
                  >
                    {isSubmittingDecision ? 'Submitting…' : 'Accept Quote'}
                  </Button>
                </div>

                <div className="space-y-2 rounded-md border border-amber-200 bg-white/70 p-3">
                  <p className="text-sm font-medium text-emerald-900">Ready to respond?</p>
                  <p className="text-sm text-gray-700">
                    If this quote does not work for you, leave a short comment so the MSP can revise it.
                  </p>
                  <TextArea
                    id="reject-quote-comment"
                    value={rejectionReason}
                    onChange={(event) => setRejectionReason(event.target.value)}
                    placeholder="Tell the MSP what needs to change"
                    disabled={isUpdatingSelections || isSubmittingDecision}
                    className="min-h-24 bg-white"
                  />
                  <div className="flex justify-end">
                    <Button
                      id="reject-quote-button"
                      variant="outline"
                      onClick={handleRejectQuote}
                      disabled={isUpdatingSelections || isSubmittingDecision}
                    >
                      {isSubmittingDecision ? 'Submitting…' : 'Reject Quote'}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {selectedQuote.status === 'accepted' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                Quote accepted. Your selected optional items have been shared with the MSP for review.
              </div>
            )}

            {selectedQuote.status === 'rejected' && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Quote rejected{selectedQuote.rejection_reason ? `: ${selectedQuote.rejection_reason}` : '.'}
              </div>
            )}

            {selectedQuote.terms_and_conditions && (
              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-900">Terms & Conditions</h4>
                <p className="text-sm text-gray-700">{selectedQuote.terms_and_conditions}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default QuotesTab;
