'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition, IQuoteListItem } from '@alga-psa/types';
import { listQuotes } from '../../../actions/quoteActions';

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
  const [quotes, setQuotes] = useState<IQuoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      render: (value: string | null | undefined) => value || 'draft',
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

  return (
    <Card size="2">
      <Box p="4">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Quotes</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : (
          <DataTable
            data={quotes}
            columns={columns}
            pagination
            onRowClick={(record) => router.push(`/msp/billing?tab=quotes&quoteId=${record.quote_id}`)}
            rowClassName={() => 'cursor-pointer'}
          />
        )}
      </Box>
    </Card>
  );
};

export default QuotesTab;
