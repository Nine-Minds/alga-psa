'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, Box } from '@radix-ui/themes';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { ColumnDefinition, IQuoteDocumentTemplate, IQuoteListItem, QuoteStatus } from '@alga-psa/types';
import { listQuotes, downloadQuotePdf } from '../../../actions/quoteActions';
import { getQuoteDocumentTemplates } from '../../../actions/quoteDocumentTemplates';
import QuoteDetail from './QuoteDetail';
import QuoteForm from './QuoteForm';
import QuotePreviewPanel from './QuotePreviewPanel';
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

type QuoteSubTab = 'active' | 'sent' | 'closed';

const QUOTE_SUBTABS: readonly QuoteSubTab[] = ['active', 'sent', 'closed'];

const SUBTAB_STATUSES: Record<QuoteSubTab, QuoteStatus[]> = {
  active: ['draft', 'pending_approval', 'approved'],
  sent: ['sent'],
  closed: ['accepted', 'rejected', 'expired', 'converted', 'cancelled', 'superseded', 'archived'],
};

const QUOTE_COLUMNS: ColumnDefinition<IQuoteListItem>[] = [
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
    title: 'Total',
    dataIndex: 'total_amount',
    render: (value: number, record) => formatCurrency(Number(value ?? 0), record.currency_code || 'USD'),
  },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (value: string | null | undefined) => <QuoteStatusBadge status={(value || 'draft') as QuoteStatus} />,
  },
  {
    title: 'Date',
    dataIndex: 'quote_date',
    render: (value: string | null | undefined) => formatDate(value),
  },
];

interface QuoteSubTabContentProps {
  quotes: IQuoteListItem[];
  subtab: QuoteSubTab;
  selectedQuoteId: string | null;
  templates: IQuoteDocumentTemplate[];
  onRowClick: (quote: IQuoteListItem) => void;
  onOpen: () => void;
  onDownload: () => Promise<void>;
}

const QuoteSubTabContent: React.FC<QuoteSubTabContentProps> = ({
  quotes,
  subtab,
  selectedQuoteId,
  templates,
  onRowClick,
  onOpen,
  onDownload,
}) => {
  const [clientFilter, setClientFilter] = useState('all');
  const [tableKey, setTableKey] = useState(0);

  const allowedStatuses = SUBTAB_STATUSES[subtab];
  const filteredByStatus = useMemo(
    () => quotes.filter((q) => allowedStatuses.includes(q.status as QuoteStatus)),
    [quotes, allowedStatuses]
  );

  const clientOptions = useMemo(() => {
    return Array.from(
      new Set(filteredByStatus.map((q) => q.client_name).filter((v): v is string => Boolean(v)))
    ).sort((a, b) => a.localeCompare(b));
  }, [filteredByStatus]);

  const filteredQuotes = useMemo(() => {
    if (clientFilter === 'all') return filteredByStatus;
    return filteredByStatus.filter((q) => q.client_name === clientFilter);
  }, [filteredByStatus, clientFilter]);

  if (filteredByStatus.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No quotes in this category.
      </div>
    );
  }

  return (
    <PanelGroup direction="horizontal" className="min-h-[600px]">
      <Panel defaultSize={60} minSize={30} onResize={() => setTableKey((prev) => prev + 1)}>
        <div className="space-y-3 pr-1">
          {clientOptions.length > 1 && (
            <div className="flex flex-col gap-1 text-sm font-medium text-foreground">
              <label htmlFor={`quotes-client-filter-${subtab}`}>Client</label>
              <div className="w-fit min-w-[220px]">
                <CustomSelect
                  id={`quotes-client-filter-${subtab}`}
                  value={clientFilter}
                  onValueChange={(value) => setClientFilter(value)}
                  options={[
                    { value: 'all', label: 'All clients' },
                    ...clientOptions.map((name) => ({ value: name, label: name })),
                  ]}
                />
              </div>
            </div>
          )}

          <DataTable
            key={tableKey}
            data={filteredQuotes}
            columns={QUOTE_COLUMNS}
            pagination
            onRowClick={onRowClick}
            rowClassName={(record) =>
              `cursor-pointer ${record.quote_id === selectedQuoteId ? 'bg-primary/5' : ''}`
            }
          />
        </div>
      </Panel>

      <PanelResizeHandle className="w-2 hover:bg-primary/10 transition-colors relative flex items-center justify-center group">
        <div className="h-8 w-1 rounded-full bg-border group-hover:bg-primary/40 transition-colors" />
      </PanelResizeHandle>

      <Panel defaultSize={40} minSize={25}>
        <div className="pl-2">
          <QuotePreviewPanel
            key={`preview-${selectedQuoteId}`}
            quoteId={selectedQuoteId}
            templates={templates}
            onOpen={onOpen}
            onDownload={onDownload}
          />
        </div>
      </Panel>
    </PanelGroup>
  );
};

const QuotesTab: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quotes, setQuotes] = useState<IQuoteListItem[]>([]);
  const [templates, setTemplates] = useState<IQuoteDocumentTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedQuoteId = searchParams?.get('quoteId');
  const selectedMode = searchParams?.get('mode');
  const requestedSubtab = searchParams?.get('subtab');
  const activeSubTab = requestedSubtab && QUOTE_SUBTABS.includes(requestedSubtab as QuoteSubTab)
    ? (requestedSubtab as QuoteSubTab)
    : 'active';

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [quotesResult, templatesResult] = await Promise.all([
        listQuotes({ is_template: false, pageSize: 200 }),
        getQuoteDocumentTemplates(),
      ]);

      if ('permissionError' in quotesResult) {
        setError(quotesResult.permissionError);
        setQuotes([]);
      } else {
        setQuotes(quotesResult.data);
        setError(null);
      }

      setTemplates(Array.isArray(templatesResult) ? templatesResult : []);
    } catch (loadError) {
      console.error('Error loading quotes:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load quotes');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubTabChange = (tabId: string) => {
    if (tabId === activeSubTab) return;
    const params = new URLSearchParams();
    params.set('tab', 'quotes');
    params.set('subtab', tabId);
    router.push(`/msp/billing?${params.toString()}`);
  };

  const handleRowClick = (record: IQuoteListItem) => {
    const params = new URLSearchParams();
    params.set('tab', 'quotes');
    params.set('subtab', activeSubTab);
    if (selectedQuoteId === record.quote_id) {
      // Deselect
      router.push(`/msp/billing?${params.toString()}`);
    } else {
      params.set('quoteId', record.quote_id);
      router.push(`/msp/billing?${params.toString()}`);
    }
  };

  const handleOpenQuote = () => {
    if (selectedQuoteId) {
      router.push(`/msp/billing?tab=quotes&quoteId=${selectedQuoteId}&mode=detail`);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedQuoteId) return;
    const result = await downloadQuotePdf(selectedQuoteId);
    if (result && typeof result === 'object' && 'permissionError' in result) {
      throw new Error(result.permissionError);
    }
    const { pdfData, quoteNumber } = result as { pdfData: number[]; quoteNumber: string };
    const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', `${quoteNumber}.pdf`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  };

  const subtabCounts = useMemo(() => {
    const counts: Record<QuoteSubTab, number> = { active: 0, sent: 0, closed: 0 };
    for (const quote of quotes) {
      for (const [tab, statuses] of Object.entries(SUBTAB_STATUSES)) {
        if (statuses.includes(quote.status as QuoteStatus)) {
          counts[tab as QuoteSubTab]++;
        }
      }
    }
    return counts;
  }, [quotes]);

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
          void loadData();
          router.push(`/msp/billing?tab=quotes&quoteId=${savedQuoteId}&mode=detail`);
        }}
      />
    );
  }

  if (selectedQuoteId && selectedMode === 'detail') {
    return (
      <QuoteDetail
        quoteId={selectedQuoteId}
        onBack={() => router.push(`/msp/billing?tab=quotes&subtab=${activeSubTab}`)}
        onEdit={() => router.push(`/msp/billing?tab=quotes&quoteId=${selectedQuoteId}&mode=edit`)}
        onSelectVersion={(quoteVersionId) => router.push(`/msp/billing?tab=quotes&quoteId=${quoteVersionId}&mode=detail`)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Quotes</h2>
        <div className="flex flex-wrap gap-2">
          <Button id="quotes-approval-queue" variant="outline" onClick={() => router.push('/msp/quote-approvals')}>
            Approval Queue
          </Button>
          <Button id="quotes-new-quote" onClick={() => router.push('/msp/billing?tab=quotes&quoteId=new')}>
            New Quote
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Quotes</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : (
        <CustomTabs
          tabs={[
            {
              id: 'active',
              label: `Active (${subtabCounts.active})`,
              content: (
                <QuoteSubTabContent
                  quotes={quotes}
                  subtab="active"
                  selectedQuoteId={selectedQuoteId}
                  templates={templates}
                  onRowClick={handleRowClick}
                  onOpen={handleOpenQuote}
                  onDownload={handleDownloadPdf}
                />
              ),
            },
            {
              id: 'sent',
              label: `Sent (${subtabCounts.sent})`,
              content: (
                <QuoteSubTabContent
                  quotes={quotes}
                  subtab="sent"
                  selectedQuoteId={selectedQuoteId}
                  templates={templates}
                  onRowClick={handleRowClick}
                  onOpen={handleOpenQuote}
                  onDownload={handleDownloadPdf}
                />
              ),
            },
            {
              id: 'closed',
              label: `Closed (${subtabCounts.closed})`,
              content: (
                <QuoteSubTabContent
                  quotes={quotes}
                  subtab="closed"
                  selectedQuoteId={selectedQuoteId}
                  templates={templates}
                  onRowClick={handleRowClick}
                  onOpen={handleOpenQuote}
                  onDownload={handleDownloadPdf}
                />
              ),
            },
          ]}
          defaultTab={activeSubTab}
          onTabChange={handleSubTabChange}
        />
      )}
    </div>
  );
};

export default QuotesTab;
