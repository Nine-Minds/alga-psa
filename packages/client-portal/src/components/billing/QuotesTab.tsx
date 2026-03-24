'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import type { ColumnDefinition, IQuoteWithClient, QuoteStatus } from '@alga-psa/types';
import { QUOTE_STATUS_METADATA } from '@alga-psa/types';
import { getClientQuotes } from '@alga-psa/client-portal/actions';
import { useRouter } from 'next/navigation';

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

const QuotesTab: React.FC<QuotesTabProps> = React.memo(({ formatCurrency, formatDate }) => {
  const router = useRouter();
  const [quotes, setQuotes] = useState<IQuoteWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

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
      render: (value, record) => formatCurrency(Number(value) || 0, record.currency_code),
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
        onRowClick={(quote) => router.push(`/client-portal/billing/quotes/${quote.quote_id}`)}
      />
      {quotes.length === 0 && (
        <div className="py-10 text-center">
          <p className="text-gray-500">No quotes found</p>
        </div>
      )}
    </div>
  );
});

export default QuotesTab;
