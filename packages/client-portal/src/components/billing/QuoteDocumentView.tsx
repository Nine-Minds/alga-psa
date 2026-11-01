'use client';

/**
 * Pure, props-only renderer for a client-facing quote document.
 *
 * Shared by the authenticated client-portal quote page and the public
 * email-link quote review page. It performs no fetching, calls no server
 * actions and reads nothing from session or app context beyond i18n and the
 * currency/date formatters. Anything interactive (optional-item toggles,
 * accept/reject, banners, PDF buttons) is owned by the caller and fed in via
 * props or slots.
 */

import { UNASSIGNED_KEY } from './quoteLocationGroups';
import React, { useCallback } from 'react';
import {
  computeQuoteTotals,
  displayAddressField,
  displayCountry,
  isQuoteItemIncluded,
} from '@alga-psa/core';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Card } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Download } from 'lucide-react';
import type { IQuoteItem, QuoteStatus, QuoteTermsBlockContent } from '@alga-psa/types';
import { useFormatQuoteStatus } from '@alga-psa/ui/hooks/useQuoteEnumOptions';
import { QuoteTermsContent, hasQuoteTermsContent } from '@alga-psa/ui/editor';
import type { ClientPortalLocationSummary } from '@alga-psa/client-portal/actions';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

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

export type LocationGroup = {
  key: string;
  locationId: string | null;
  location: ClientPortalLocationSummary | null;
  items: IQuoteItem[];
};

export { UNASSIGNED_KEY };

export function groupQuoteItemsByLocation(
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

export function distinctLocationCount(items: IQuoteItem[]): number {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.location_id) seen.add(item.location_id);
  }
  return seen.size;
}

export function formatClientPortalLocationLines(location: ClientPortalLocationSummary | null | undefined): string[] {
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

/** The subset of a quote this view reads. Both IQuote and the public view model satisfy it. */
export interface QuoteDocumentQuote {
  quote_id: string;
  quote_number?: string | null;
  title: string;
  description?: string | null;
  quote_date?: string | null;
  valid_until?: string | null;
  status?: QuoteStatus | null;
  po_number?: string | null;
  currency_code: string;
  client_notes?: string | null;
  terms_and_conditions?: string | null;
  terms_and_conditions_block?: QuoteTermsBlockContent | null;
}

export interface QuoteDocumentTotals {
  subtotal: number;
  discountTotal: number;
  tax: number;
  totalAmount: number;
}

export interface QuoteDocumentViewProps {
  quote: QuoteDocumentQuote;
  /** Items as they should be displayed (optional-item preview already applied). */
  items: IQuoteItem[];
  locations: ClientPortalLocationSummary[];
  /** Totals to display, in minor units of `quote.currency_code`. */
  totals: QuoteDocumentTotals;
  /** Live optional-item preview, when the caller computed one. */
  preview?: ReturnType<typeof computeQuoteTotals> | null;
  /**
   * Optional-item selection. When `onSelectionToggle` is omitted no switches are
   * rendered (read-only document).
   */
  selection?: {
    canEdit: boolean;
    disabled?: boolean;
    previewUnavailable?: boolean;
    onToggle?: (quoteItemId: string, checked: boolean) => void;
  };
  /** Same-origin href of the quote PDF; renders a download link in the header. */
  pdfHref?: string;
  /** Rendered at the top of the card body (e.g. an error banner). */
  topSlot?: React.ReactNode;
  /** Rendered after the totals (e.g. accept/reject controls and decision banners). */
  footerSlot?: React.ReactNode;
  termsId?: string;
}

export const QuoteDocumentView: React.FC<QuoteDocumentViewProps> = ({
  quote,
  items,
  locations,
  totals,
  preview = null,
  selection,
  pdfHref,
  topSlot,
  footerSlot,
  termsId = 'client-portal-quote-terms-content',
}) => {
  const { t } = useTranslation('features/billing');
  const formatQuoteStatus = useFormatQuoteStatus();
  const { money } = useCurrencyFormat();

  // money() takes minor units and formats with the active locale; the currency
  // is always the quote's own.
  const formatCurrency = useCallback(
    (amountInCents: number, currencyCode?: string) => money(amountInCents, currencyCode),
    [money],
  );

  // Central formatter: the client's own country sets the digit order, their
  // language names the month.
  const { formatDate: formatLocalizedDate } = useFormatters();
  const formatDate = useCallback(
    (date: string | { toString(): string } | undefined | null) => {
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
    },
    [formatLocalizedDate],
  );

  // quote_date / valid_until are calendar dates stored as UTC midnight. Reduce to the
  // YYYY-MM-DD calendar day so useFormatters formats them as a date-only value
  // (UTC) instead of shifting them through the viewer's timezone. Timestamps stay as-is.
  const formatDateOnly = useCallback(
    (date: string | { toString(): string } | undefined | null) => {
      if (!date) return formatDate(date);
      const str = date instanceof Date ? date.toISOString() : typeof date === 'string' ? date : date.toString();
      const match = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:00)?$/.exec(str);
      return formatDate(match ? match[1] : str);
    },
    [formatDate],
  );

  const hasOptionalItems = items.some((item) => item.is_optional);
  const canEditSelections = selection?.canEdit ?? false;
  const onToggle = selection?.onToggle;

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
                    {item.is_optional && onToggle && (
                      <div className="pt-1">
                        <Switch
                          id={`quote-item-${item.quote_item_id}-selection`}
                          checked={isIncluded}
                          disabled={!canEditSelections || selection?.disabled}
                          onCheckedChange={(checked) => onToggle(item.quote_item_id, checked)}
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
                    quote.currency_code,
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderLineItems = () => {
    if (distinctLocationCount(items) >= 2) {
      const groups = groupQuoteItemsByLocation(items, locations);
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
  };

  return (
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
          <div className="flex items-center gap-3">
            {pdfHref && (
              <a
                id="quote-document-download-pdf"
                href={pdfHref}
                className="inline-flex items-center text-sm font-medium text-primary-600 hover:underline"
              >
                <Download className="mr-2 h-4 w-4" />
                {t('quotes.detail.downloadPdf', { defaultValue: 'Download PDF' })}
              </a>
            )}
            <Badge variant={STATUS_VARIANTS[(quote.status || 'draft') as QuoteStatus] || 'secondary'}>
              {formatQuoteStatus((quote.status || 'draft') as QuoteStatus)}
            </Badge>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-6">
        {topSlot}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.quoteDate', { defaultValue: 'Quote Date' })}</p>
            <p className="mt-1 text-sm">{formatDateOnly(quote.quote_date)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.validUntil', { defaultValue: 'Valid Until' })}</p>
            <p className="mt-1 text-sm">{formatDateOnly(quote.valid_until)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.poNumber', { defaultValue: 'PO Number' })}</p>
            <p className="mt-1 text-sm">{quote.po_number || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase text-muted-foreground">{t('quotes.detail.total', { defaultValue: 'Total' })}</p>
            <p className="mt-1 text-lg font-semibold">
              {formatCurrency(totals.totalAmount, quote.currency_code)}
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
          {hasOptionalItems && onToggle && (
            <p className="mb-3 text-sm text-muted-foreground">
              {canEditSelections
                ? t('quotes.detail.optionalToggleHint', { defaultValue: 'Toggle optional items to preview your preferred quote total before responding.' })
                : t('quotes.detail.optionalLockedHint', { defaultValue: 'Optional item selections are locked once the quote is no longer awaiting your response.' })}
            </p>
          )}
          {selection?.previewUnavailable && (
            <p className="mb-3 text-sm text-muted-foreground">
              {t('quotes.detail.previewUnavailable', { defaultValue: 'A live preview is unavailable for this quote, so the totals shown are the current saved totals. Your selections are still sent when you accept.' })}
            </p>
          )}
          {renderLineItems()}
        </div>

        {/* Totals */}
        <div className="grid gap-2 md:max-w-sm md:ml-auto">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t('quotes.detail.subtotal', { defaultValue: 'Subtotal' })}</span>
            <span>{formatCurrency(totals.subtotal, quote.currency_code)}</span>
          </div>
          {totals.discountTotal !== 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('quotes.detail.discounts', { defaultValue: 'Discounts' })}</span>
              <span>-{formatCurrency(Math.abs(totals.discountTotal), quote.currency_code)}</span>
            </div>
          )}
          {totals.tax !== 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t('quotes.detail.tax', { defaultValue: 'Tax' })}</span>
              <span>{formatCurrency(totals.tax, quote.currency_code)}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-2 text-sm font-semibold">
            <span>{t('quotes.detail.total', { defaultValue: 'Total' })}</span>
            <span>{formatCurrency(totals.totalAmount, quote.currency_code)}</span>
          </div>
        </div>

        {footerSlot}

        {hasQuoteTermsContent(quote.terms_and_conditions_block, quote.terms_and_conditions) && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">{t('quotes.detail.termsAndConditions', { defaultValue: 'Terms & Conditions' })}</h3>
            <QuoteTermsContent
              id={termsId}
              block={quote.terms_and_conditions_block}
              text={quote.terms_and_conditions}
              textClassName="text-sm text-muted-foreground"
              richClassName="text-sm text-muted-foreground"
            />
          </div>
        )}
      </div>
    </Card>
  );
};

export default QuoteDocumentView;
