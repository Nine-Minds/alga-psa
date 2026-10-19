'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { computeQuoteTotals, displayAddressField, displayCountry, isOptional, isQuoteItemIncluded } from '@alga-psa/core';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useRouter } from 'next/navigation';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ArrowLeft, Download } from 'lucide-react';
import type { IQuote, IQuoteItem, QuoteStatus } from '@alga-psa/types';
import { useFormatQuoteStatus } from '@alga-psa/ui/hooks/useQuoteEnumOptions';
import { QuoteTermsContent, hasQuoteTermsContent } from '@alga-psa/ui/editor';
import {
  acceptClientQuote,
  downloadClientQuotePdf,
  getClientQuoteById,
  getLocationsForClientQuote,
  rejectClientQuote,
  type ClientPortalLocationSummary,
} from '@alga-psa/client-portal/actions';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

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


const isBillingActionError = (
  value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

interface QuoteDetailPageProps {
  quoteId: string;
}

type LocationGroup = {
  key: string;
  locationId: string | null;
  location: ClientPortalLocationSummary | null;
  items: IQuoteItem[];
};

const UNASSIGNED_KEY = '__unassigned__';

function groupQuoteItemsByLocation(
  items: IQuoteItem[],
  locations: ClientPortalLocationSummary[],
): LocationGroup[] {
  const locationById = new Map<string, ClientPortalLocationSummary>();
  for (const location of locations) {
    if (location.location_id) locationById.set(location.location_id, location);
  }
  const order: string[] = [];
  const grouped = new Map<string, LocationGroup>();

  for (const item of items) {
    const id = item.location_id ?? null;
    const key = id && id.trim().length > 0 ? id : UNASSIGNED_KEY;
    let entry = grouped.get(key);
    if (!entry) {
      entry = {
        key,
        locationId: key === UNASSIGNED_KEY ? null : key,
        location: key === UNASSIGNED_KEY ? null : locationById.get(key) ?? null,
        items: [],
      };
      grouped.set(key, entry);
      order.push(key);
    }
    entry.items.push(item);
  }
  return order.map((key) => grouped.get(key)!);
}

function distinctLocationCount(items: IQuoteItem[]): number {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.location_id) seen.add(item.location_id);
  }
  return seen.size;
}

function formatClientPortalLocationLines(location: ClientPortalLocationSummary | null | undefined): string[] {
  if (!location) return [];
  const lines: string[] = [];
  for (const field of [location.address_line1, location.address_line2, location.address_line3]) {
    const trimmed = displayAddressField(field);
    if (trimmed) lines.push(trimmed);
  }
  const parts = [location.city, location.state_province, location.postal_code]
    .map(displayAddressField)
    .filter((v) => v.length > 0);
  if (parts.length > 0) lines.push(parts.join(', '));
  const country = displayCountry(location.country_name, location.country_code);
  if (country) lines.push(country);
  return lines;
}

const QuoteDetailPage: React.FC<QuoteDetailPageProps> = ({ quoteId }) => {
  const router = useRouter();
  const { t } = useTranslation('features/billing');
  const formatQuoteStatus = useFormatQuoteStatus();
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
  const { money } = useCurrencyFormat();

  // money() takes minor units and formats with the tenant's locale + currency
  // from CurrencyFormatProvider.
  const formatCurrency = useCallback((amountInCents: number, currencyCode?: string) => {
    return money(amountInCents, currencyCode);
  }, [money]);

  // Central formatter: the client's own country sets the digit order, their
  // language names the month. The hand-rolled 'en-US' build this replaces did
  // neither, and pinned every portal user to US order.
  const { formatDate: formatLocalizedDate } = useFormatters();
  const formatDate = useCallback((date: string | { toString(): string } | undefined | null) => {
    if (!date) return 'N/A';
    try {
      const dateStr = typeof date === 'string' ? date : date.toString();
      if (Number.isNaN(new Date(dateStr).getTime())) {
        return 'Invalid date';
      }
      return formatLocalizedDate(dateStr);
    } catch {
      return 'Invalid date';
    }
  }, [formatLocalizedDate]);

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

      <Card className="overflow-hidden">
        <div className="border-b px-6 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold">
                {quote.quote_number ||
                  t('quotes.detail.fallbackTitle', { defaultValue: 'Quote {{id}}', id: quote.quote_id.slice(0, 8) })}
              </h1>
              <p className="text-sm text-muted-foreground">{quote.title}</p>
            </div>
            <Badge variant={STATUS_VARIANTS[(quote.status || 'draft') as QuoteStatus] || 'secondary'}>
              {formatQuoteStatus((quote.status || 'draft') as QuoteStatus)}
            </Badge>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {decisionError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {decisionError}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.quoteDate', { defaultValue: 'Quote Date' })}</p>
              <p className="mt-1 text-sm">{formatDate(quote.quote_date)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.validUntil', { defaultValue: 'Valid Until' })}</p>
              <p className="mt-1 text-sm">{formatDate(quote.valid_until)}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.poNumber', { defaultValue: 'PO Number' })}</p>
              <p className="mt-1 text-sm">{quote.po_number || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.total', { defaultValue: 'Total' })}</p>
              <p className="mt-1 text-lg font-semibold">
                {formatCurrency(displayTotals.totalAmount, quote.currency_code)}
              </p>
            </div>
          </div>

          {quote.description && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('quotes.detail.scopeOfWork', { defaultValue: 'Scope of Work' })}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.description}</p>
            </div>
          )}

          {quote.client_notes && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('quotes.detail.notes', { defaultValue: 'Notes' })}</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{quote.client_notes}</p>
            </div>
          )}

          {/* Line Items */}
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('quotes.detail.lineItems', { defaultValue: 'Line Items' })}</h3>
            {hasOptionalItems && (
              <p className="mb-3 text-sm text-muted-foreground">
                {canEditSelections
                  ? t('quotes.detail.optionalToggleHint', { defaultValue: 'Toggle optional items to preview your preferred quote total before responding.' })
                  : t('quotes.detail.optionalLockedHint', { defaultValue: 'Optional item selections are locked once the quote is no longer awaiting your response.' })}
              </p>
            )}
            {previewUnavailable && (
              <p className="mb-3 text-sm text-muted-foreground">
                {t('quotes.detail.previewUnavailable', { defaultValue: 'A live preview is unavailable for this quote, so the totals shown are the current saved totals. Your selections are still sent when you accept.' })}
              </p>
            )}
            {(() => {
              const items = previewItems;
              const renderItemsTable = (rowItems: IQuoteItem[]) => (
                <div className="overflow-x-auto rounded-md border">
                  <table className="min-w-full divide-y text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('quotes.detail.columns.description', { defaultValue: 'Description' })}</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('quotes.detail.columns.qty', { defaultValue: 'Qty' })}</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('quotes.detail.columns.rate', { defaultValue: 'Rate' })}</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">{t('quotes.detail.columns.amount', { defaultValue: 'Amount' })}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {rowItems.map((item) => {
                        const isIncluded = isQuoteItemIncluded(item);
                        return (
                          <tr key={item.quote_item_id} className={!isIncluded ? 'opacity-60' : undefined}>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1">
                                <span>{item.description}</span>
                                {item.is_optional && (
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant="outline" className="text-[10px]">{t('quotes.detail.optional', { defaultValue: 'Optional' })}</Badge>
                                    <span>
                                      {isIncluded
                                        ? t('quotes.detail.included', { defaultValue: 'Included' })
                                        : t('quotes.detail.excluded', { defaultValue: 'Excluded' })}
                                    </span>
                                  </div>
                                )}
                                {item.is_optional && (
                                  <div className="pt-1">
                                    <Switch
                                      id={`quote-item-${item.quote_item_id}-selection`}
                                      checked={isIncluded}
                                      disabled={!canEditSelections || isSubmittingDecision}
                                      onCheckedChange={(checked) => handleSelectionToggle(item.quote_item_id, checked)}
                                      className="data-[state=checked]:bg-primary-500"
                                      label={isIncluded
                                        ? t('quotes.detail.include', { defaultValue: 'Include' })
                                        : t('quotes.detail.exclude', { defaultValue: 'Exclude' })}
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
                              {formatCurrency(
                                preview && item.is_discount
                                  ? preview.discountAmountById.get(item.quote_item_id) ?? 0
                                  : item.total_price || 0,
                                quote.currency_code
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              );

              if (distinctLocationCount(items) >= 2) {
                const groups = groupQuoteItemsByLocation(items, clientLocations);
                return (
                  <div className="space-y-4">
                    {groups.map((group) => {
                      // Per-group subtotal honours the local optional-item selection,
                      // via the shared totals function when the preview is available.
                      const subtotal = preview
                        ? preview.perGroup.get(group.key)?.subtotal ?? 0
                        : group.items
                            .filter((i) => !i.is_discount && isQuoteItemIncluded(i))
                            .reduce((sum, i) => sum + (Number(i.total_price) || 0), 0);
                      const addressLines = formatClientPortalLocationLines(group.location);
                      return (
                        <div key={group.key} className="overflow-hidden rounded-md border">
                          <div className="flex flex-col gap-2 border-b bg-muted/40 px-4 py-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {t('quotes.locations.groupHeading', { defaultValue: 'Location' })}
                              </div>
                              {group.location?.location_name ? (
                                <div className="mt-1 font-medium">{group.location.location_name}</div>
                              ) : null}
                              {addressLines.length > 0 ? (
                                <div className="text-xs text-muted-foreground whitespace-pre-line">
                                  {addressLines.join('\n')}
                                </div>
                              ) : !group.location ? (
                                <div className="text-xs text-muted-foreground">
                                  {t('quotes.locations.unassigned', { defaultValue: 'Items without a location' })}
                                </div>
                              ) : null}
                            </div>
                            <div className="text-sm md:text-right">
                              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                {t('quotes.locations.subtotal', { defaultValue: 'Location subtotal' })}
                              </div>
                              <div className="mt-1 font-semibold">
                                {formatCurrency(subtotal, quote.currency_code)}
                              </div>
                            </div>
                          </div>
                          {renderItemsTable(group.items)}
                        </div>
                      );
                    })}
                  </div>
                );
              }

              return renderItemsTable(items);
            })()}
          </div>

          {/* Totals */}
          <div className="grid gap-2 md:max-w-sm md:ml-auto">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('quotes.detail.subtotal', { defaultValue: 'Subtotal' })}</span>
              <span>{formatCurrency(displayTotals.subtotal, quote.currency_code)}</span>
            </div>
            {displayTotals.discountTotal !== 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('quotes.detail.discounts', { defaultValue: 'Discounts' })}</span>
                <span>-{formatCurrency(Math.abs(displayTotals.discountTotal), quote.currency_code)}</span>
              </div>
            )}
            {displayTotals.tax !== 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('quotes.detail.tax', { defaultValue: 'Tax' })}</span>
                <span>{formatCurrency(displayTotals.tax, quote.currency_code)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>{t('quotes.detail.total', { defaultValue: 'Total' })}</span>
              <span>{formatCurrency(displayTotals.totalAmount, quote.currency_code)}</span>
            </div>
          </div>

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

          {hasQuoteTermsContent(quote.terms_and_conditions_block, quote.terms_and_conditions) && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('quotes.detail.termsAndConditions', { defaultValue: 'Terms & Conditions' })}</h3>
              <QuoteTermsContent
                id="client-portal-quote-terms-content"
                block={quote.terms_and_conditions_block}
                text={quote.terms_and_conditions}
                textClassName="text-sm text-muted-foreground"
                richClassName="text-sm text-muted-foreground"
              />
            </div>
          )}
        </div>
      </Card>

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
