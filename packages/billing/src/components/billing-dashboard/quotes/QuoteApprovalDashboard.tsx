'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Box } from '@radix-ui/themes';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import type { ColumnDefinition, IQuoteListItem, QuoteStatus } from '@alga-psa/types';
import { getQuoteApprovalSettings, listQuotes, updateQuoteApprovalSettings } from '../../../actions/quoteActions';
import QuoteDetail from './QuoteDetail';
import QuoteStatusBadge from './QuoteStatusBadge';

function formatCurrency(minorUnits: number, currencyCode: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format((minorUnits || 0) / 100);
}

function formatDate(value?: string | null): string {
  if (!value) {
    return '—';
  }

  return new Date(value).toLocaleDateString();
}

const QuoteApprovalDashboard: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedQuoteId = searchParams?.get('quoteId');
  const [quotes, setQuotes] = useState<IQuoteListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'pending_approval' | 'approved'>('pending_approval');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  useEffect(() => {
    void loadQuotes(statusFilter);
    void loadSettings();
  }, [statusFilter]);

  const loadQuotes = async (status: 'pending_approval' | 'approved') => {
    try {
      setIsLoading(true);
      const result = await listQuotes({
        is_template: false,
        status,
        pageSize: 200,
        sortBy: 'quote_date',
        sortOrder: 'desc',
      });

      if ('permissionError' in result) {
        setError(result.permissionError);
        setQuotes([]);
        return;
      }

      setQuotes(result.data);
      setError(null);
    } catch (loadError) {
      console.error('Error loading quote approvals:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load quote approvals');
    } finally {
      setIsLoading(false);
    }
  };

  const loadSettings = async () => {
    const result = await getQuoteApprovalSettings();
    if (!('permissionError' in result)) {
      setApprovalRequired(result.approvalRequired === true);
    }
  };

  const handleApprovalRequiredChange = async (checked: boolean) => {
    try {
      setIsSavingSettings(true);
      const result = await updateQuoteApprovalSettings(checked);
      if ('permissionError' in result) {
        throw new Error(result.permissionError);
      }
      setApprovalRequired(result.approvalRequired);
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : 'Failed to update quote approval settings');
    } finally {
      setIsSavingSettings(false);
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
      title: 'Amount',
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

  if (selectedQuoteId) {
    return (
      <QuoteDetail
        quoteId={selectedQuoteId}
        onBack={() => router.push('/msp/quote-approvals')}
        onSelectVersion={(quoteVersionId) => router.push(`/msp/quote-approvals?quoteId=${quoteVersionId}`)}
      />
    );
  }

  return (
    <Card size="2">
      <Box p="4" className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Quote Approvals</h1>
            <p className="text-sm text-muted-foreground">Review quotes waiting for manager approval before they can be sent to clients.</p>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">Approval required before sending</div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={approvalRequired}
                  onCheckedChange={handleApprovalRequiredChange}
                  disabled={isSavingSettings}
                />
                <span className="text-sm text-muted-foreground">
                  {approvalRequired ? 'Draft quotes must be approved before sending.' : 'Draft quotes can be sent without approval.'}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-sm font-medium text-foreground">
              <label htmlFor="quote-approvals-status-filter">Status</label>
              <div className="min-w-[180px]">
                <CustomSelect
                  id="quote-approvals-status-filter"
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value as 'pending_approval' | 'approved')}
                  options={[
                    { value: 'pending_approval', label: 'Pending Approval' },
                    { value: 'approved', label: 'Approved' },
                  ]}
                />
              </div>
            </div>
            <Button id="quote-approvals-back-billing" variant="outline" onClick={() => router.push('/msp/billing?tab=quotes')}>
              Back to Quotes
            </Button>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Quote Approvals</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : isLoading ? (
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text="Loading approval queue..."
            textClassName="text-muted-foreground"
          />
        ) : quotes.length === 0 ? (
          <Alert>
            <AlertTitle>No quotes found</AlertTitle>
            <AlertDescription>
              There are no quotes in the {statusFilter === 'pending_approval' ? 'pending approval' : 'approved'} queue right now.
            </AlertDescription>
          </Alert>
        ) : (
          <DataTable
            data={quotes}
            columns={columns}
            pagination
            onRowClick={(record) => router.push(`/msp/quote-approvals?quoteId=${record.quote_id}`)}
            rowClassName={() => 'cursor-pointer'}
          />
        )}
      </Box>
    </Card>
  );
};

export default QuoteApprovalDashboard;
