'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import type { ColumnDefinition, IQuoteWithClient, QuoteStatus } from '@alga-psa/types';
import { useFormatQuoteStatus } from '@alga-psa/ui/hooks/useQuoteEnumOptions';
import { getClientQuotes } from '@alga-psa/client-portal/actions';
import { useRouter } from 'next/navigation';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface QuotesTabProps {
  formatCurrency: (amount: number, currencyCode?: string) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
}

const isBillingActionError = (
  value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

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

const QuotesTab: React.FC<QuotesTabProps> = React.memo(({ formatCurrency, formatDate }) => {
  const { t } = useTranslation('client-portal');
  const router = useRouter();
  const formatQuoteStatus = useFormatQuoteStatus();
  const [quotes, setQuotes] = useState<IQuoteWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetchedQuotes = await getClientQuotes();
        if (isBillingActionError(fetchedQuotes)) {
          setQuotes([]);
          setError(getErrorMessage(fetchedQuotes));
          return;
        }
        setQuotes(fetchedQuotes);
      } catch (err) {
        console.error('Error loading quotes:', err);
        setError(t('billing.quotes.errors.loadFailed', { defaultValue: 'Failed to load quotes' }));
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [t]);

  const quoteColumns: ColumnDefinition<IQuoteWithClient>[] = useMemo(() => [
    {
      title: t('billing.quotes.columns.quoteNumber', { defaultValue: 'Quote #' }),
      dataIndex: 'quote_number',
      render: (value, record) =>
        value || t('billing.quotes.draftQuote', { defaultValue: 'Draft {{quoteId}}', quoteId: record.quote_id }),
    },
    {
      title: t('billing.quotes.columns.title', { defaultValue: 'Title' }),
      dataIndex: 'title',
    },
    {
      title: t('billing.quotes.columns.amount', { defaultValue: 'Amount' }),
      dataIndex: 'total_amount',
      render: (value, record) => formatCurrency(Number(value) || 0, record.currency_code),
    },
    {
      title: t('billing.quotes.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (value) => {
        const status = (value || 'draft') as QuoteStatus;
        return (
          <Badge variant={STATUS_VARIANTS[status] || 'secondary'}>
            {formatQuoteStatus(status)}
          </Badge>
        );
      },
    },
    {
      title: t('billing.quotes.columns.date', { defaultValue: 'Date' }),
      dataIndex: 'quote_date',
      render: (value) => formatDate(value),
    },
  ], [formatCurrency, formatDate, formatQuoteStatus, t]);

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
        pageSize={pageSize}
        onItemsPerPageChange={(size) => {
          setPageSize(size);
          setCurrentPage(1);
        }}
        onRowClick={(quote) => router.push(`/client-portal/billing/quotes/${quote.quote_id}`)}
      />
      {quotes.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-gray-500">{t('billing.quotes.empty', { defaultValue: 'No quotes found' })}</p>
        </div>
      )}
    </div>
  );
});

export default QuotesTab;
