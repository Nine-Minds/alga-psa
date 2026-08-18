'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  acceptClientQuote,
  downloadClientQuotePdf,
  getClientQuoteById,
  getLocationsForClientQuote,
  rejectClientQuote,
  updateClientQuoteSelections,
  type ClientPortalLocationSummary,
} from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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

function itemIsIncluded(item: IQuoteItem): boolean {
  return !item.is_optional || item.is_selected !== false;
}

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
    if (typeof field === 'string' && field.trim().length > 0) lines.push(field.trim());
  }
  const parts = [location.city, location.state_province, location.postal_code]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v.length > 0);
  if (parts.length > 0) lines.push(parts.join(', '));
  const country = (location.country_name || location.country_code || '').trim();
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
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isUpdatingSelections, setIsUpdatingSelections] = useState(false);
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'accept' | 'reject' | null>(null);
  const { money } = useCurrencyFormat();

  // money() takes minor units and formats with the tenant's locale + currency
  // from CurrencyFormatProvider.
  const formatCurrency = useCallback((amountInCents: number, currencyCode?: string) => {
    return money(amountInCents, currencyCode);
  }, [money]);

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
      if (isBillingActionError(persistedQuote)) {
        setSelectionError(getErrorMessage(persistedQuote));
        return;
      }
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
        link.download = '';
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
                {formatCurrency(quote.total_amount || 0, quote.currency_code)}
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
            {(() => {
              const items = quote.quote_items || [];
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
                        const isIncluded = itemIsIncluded(item);
                        return (
                          <tr key={item.quote_item_id} className={!isIncluded ? 'opacity-60' : undefined}>
                            <td className="px-3 py-2">
                              <div className="flex flex-col gap-1">
                                <span>{item.description}</span>
                                {item.is_optional && (
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <Badge variant="outline" className="text-[10px]">{t('quotes.detail.optional', { defaultValue: 'Optional' })}</Badge>
                                    <span>
                                      {item.is_selected !== false
                                        ? t('quotes.detail.included', { defaultValue: 'Included' })
                                        : t('quotes.detail.excluded', { defaultValue: 'Excluded' })}
                                    </span>
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
                                      label={item.is_selected !== false
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
                              {formatCurrency(item.total_price || 0, quote.currency_code)}
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
                      // Live per-group subtotal honours the optional-item toggle.
                      const subtotal = group.items
                        .filter((i) => !i.is_discount && itemIsIncluded(i))
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
            {isUpdatingSelections && (
              <p className="mt-2 text-sm text-muted-foreground">{t('quotes.detail.savingSelections', { defaultValue: 'Saving optional item selections...' })}</p>
            )}
          </div>

          {/* Totals */}
          <div className="grid gap-2 md:max-w-sm md:ml-auto">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('quotes.detail.subtotal', { defaultValue: 'Subtotal' })}</span>
              <span>{formatCurrency(quote.subtotal || 0, quote.currency_code)}</span>
            </div>
            {(quote.discount_total ?? 0) !== 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('quotes.detail.discounts', { defaultValue: 'Discounts' })}</span>
                <span>-{formatCurrency(Math.abs(quote.discount_total || 0), quote.currency_code)}</span>
              </div>
            )}
            {(quote.tax ?? 0) !== 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t('quotes.detail.tax', { defaultValue: 'Tax' })}</span>
                <span>{formatCurrency(quote.tax || 0, quote.currency_code)}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
              <span>{t('quotes.detail.total', { defaultValue: 'Total' })}</span>
              <span>{formatCurrency(quote.total_amount || 0, quote.currency_code)}</span>
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
                  disabled={isUpdatingSelections || isSubmittingDecision}
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
                  disabled={isUpdatingSelections || isSubmittingDecision}
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
                    disabled={isUpdatingSelections || isSubmittingDecision}
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

          {quote.terms_and_conditions && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('quotes.detail.termsAndConditions', { defaultValue: 'Terms & Conditions' })}</h3>
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
