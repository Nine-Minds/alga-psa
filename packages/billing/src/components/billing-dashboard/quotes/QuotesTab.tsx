'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import type { ColumnDefinition, IQuoteListItem, QuoteStatus } from '@alga-psa/types';
import { listQuotes } from '../../../actions/quoteActions';
import QuoteDetail from './QuoteDetail';
import QuoteForm from './QuoteForm';
import QuoteStatusBadge from './QuoteStatusBadge';

function formatCurrency(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format(minorUnits / 100);
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleDateString();
}

const QuotesTab: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quotes, setQuotes] = useState<IQuoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState('all');
  const selectedQuoteId = searchParams?.get('quoteId');
  const selectedMode = searchParams?.get('mode');

  useEffect(() => {
    void loadQuotes();
  }, []);

  const loadQuotes = async () => {
    try {
      setIsLoading(true);
      const result = await listQuotes({ is_template: false, pageSize: 200 });
      if ('permissionError' in result) {
        setError(result.permissionError);
        setQuotes([]);
        return;
      }

      setQuotes(result.data);
      setError(null);
    } catch (loadError) {
      console.error('Error loading quotes:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load quotes');
    } finally {
      setIsLoading(false);
    }
  };

  const columns = useMemo<ColumnDefinition<IQuoteListItem>[]>(() => ([
    {
      title: 'Quote #',
      dataIndex: 'display_quote_number',
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value: string | null | undefined) => value || '—',
    },
    {
      title: 'Title',
      dataIndex: 'title',
    },
    {
      title: 'Total Amount',
      dataIndex: 'total_amount',
      render: (value: number, record) => formatCurrency(Number(value ?? 0), record.currency_code || 'USD'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string | null | undefined) => <QuoteStatusBadge status={(value || 'draft') as QuoteStatus} />,
    },
    {
      title: 'Quote Date',
      dataIndex: 'quote_date',
      render: (value: string | null | undefined) => formatDate(value),
    },
    {
      title: 'Valid Until',
      dataIndex: 'valid_until',
      render: (value: string | null | undefined) => formatDate(value),
    },
  ]), []);

  const clientOptions = useMemo(() => {
    return Array.from(
      new Set(quotes.map((quote) => quote.client_name).filter((value): value is string => Boolean(value)))
    ).sort((left, right) => left.localeCompare(right));
  }, [quotes]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      const matchesStatus = statusFilter === 'all' ? true : quote.status === statusFilter;
      const matchesClient = clientFilter === 'all' ? true : quote.client_name === clientFilter;
      return matchesStatus && matchesClient;
    });
  }, [clientFilter, quotes, statusFilter]);

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text="Loading quotes..."
            textClassName="text-muted-foreground"
          />
        </Box>
      </Card>
    );
  }

  if (selectedQuoteId === 'new' || (selectedQuoteId && selectedMode === 'edit')) {
    return (
      <QuoteForm
        quoteId={selectedQuoteId}
        onCancel={() => router.push('/msp/billing?tab=quotes')}
        onSaved={(savedQuoteId) => {
          void loadQuotes();
          router.push(`/msp/billing?tab=quotes&quoteId=${savedQuoteId}`);
        }}
      />
    );
  }

  if (selectedQuoteId) {
    return (
      <QuoteDetail
        quoteId={selectedQuoteId}
        onBack={() => router.push('/msp/billing?tab=quotes')}
        onEdit={() => router.push(`/msp/billing?tab=quotes&quoteId=${selectedQuoteId}&mode=edit`)}
        onSelectVersion={(quoteVersionId) => router.push(`/msp/billing?tab=quotes&quoteId=${quoteVersionId}`)}
      />
    );
  }

  return (
    <Card size="2">
      <Box p="4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Quotes</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                Status
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="min-w-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="all">All</option>
                  <option value="draft">Drafts</option>
                  <option value="sent">Sent</option>
                  <option value="accepted">Accepted</option>
                  <option value="rejected">Rejected</option>
                  <option value="expired">Expired</option>
                  <option value="converted">Converted</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="archived">Archived</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                Client
                <select
                  value={clientFilter}
                  onChange={(event) => setClientFilter(event.target.value)}
                  className="min-w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="all">All clients</option>
                  {clientOptions.map((clientName) => (
                    <option key={clientName} value={clientName}>
                      {clientName}
                    </option>
                  ))}
                </select>
              </label>
            </div>

              <Button id="quotes-new-quote" onClick={() => router.push('/msp/billing?tab=quotes&quoteId=new')}>
                New Quote
              </Button>
            </div>

            <DataTable
              data={filteredQuotes}
              columns={columns}
              pagination
              onRowClick={(record) => router.push(`/msp/billing?tab=quotes&quoteId=${record.quote_id}`)}
              rowClassName={() => 'cursor-pointer'}
            />
          </div>
        )}
      </Box>
    </Card>
  );
};

export default QuotesTab;
