'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import type { ColumnDefinition, IQuote, IQuoteWithClient, QuoteStatus } from '@alga-psa/types';
import { QUOTE_STATUS_METADATA } from '@alga-psa/types';
import { getClientQuoteById, getClientQuotes } from '@alga-psa/client-portal/actions';
import { useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';

interface QuotesTabProps {
  formatCurrency: (amount: number, currencyCode?: string) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
}

const STATUS_VARIANTS: Record<QuoteStatus, BadgeVariant> = {
  draft: 'warning',
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
  const searchParams = useSearchParams();
  const [quotes, setQuotes] = useState<IQuoteWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedQuote, setSelectedQuote] = useState<IQuote | null>(null);

  const selectedQuoteId = searchParams?.get('quoteId');

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
        const quote = await getClientQuoteById(selectedQuoteId);
        setSelectedQuote(quote);
      } catch (err) {
        console.error('Error loading quote detail:', err);
        setSelectedQuote(null);
      }
    };

    fetchDetail();
  }, [selectedQuoteId]);

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
            <Button id="close-quote-details" variant="ghost" size="sm" onClick={() => updateUrlParams({ quoteId: null })}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-6 p-4">
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
                    {(selectedQuote.quote_items || []).map((item) => (
                      <tr key={item.quote_item_id}>
                        <td className="px-3 py-2 text-gray-900">
                          <div className="flex flex-col gap-1">
                            <span>{item.description}</span>
                            {item.is_optional && (
                              <span className="text-xs text-amber-600">Optional item</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-700">{item.quantity}</td>
                        <td className="px-3 py-2 text-gray-700">
                          {formatCurrency(item.unit_price || 0, selectedQuote.currency_code)}
                        </td>
                        <td className="px-3 py-2 text-gray-900">
                          {formatCurrency(item.total_price || 0, selectedQuote.currency_code)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
