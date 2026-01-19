'use client'

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Badge } from '@alga-psa/ui/components/Badge';
import { MoreVertical, CheckCircle, GripVertical, Download, Mail, RotateCcw, Search, ArrowRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import type { ColumnDefinition, InvoiceViewModel as DbInvoiceViewModel, IInvoiceTemplate } from '@alga-psa/types';
import { fetchInvoicesPaginated } from '@alga-psa/billing/actions/invoiceQueries';
import { getInvoiceTemplates } from '@alga-psa/billing/actions/invoiceTemplates';
import { unfinalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { downloadInvoicePDF } from '@alga-psa/billing/actions/invoiceGeneration';
import { scheduleInvoiceZipAction } from '@alga-psa/jobs/actions';
import { SendInvoiceEmailDialog } from './SendInvoiceEmailDialog';
import { toPlainDate } from '@alga-psa/core';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import InvoicePreviewPanel from './InvoicePreviewPanel';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

interface FinalizedTabProps {
  onRefreshNeeded: () => void;
  refreshTrigger: number;
}

const FinalizedTab: React.FC<FinalizedTabProps> = ({
  onRefreshNeeded,
  refreshTrigger
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [invoices, setInvoices] = useState<DbInvoiceViewModel[]>([]);
  const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableKey, setTableKey] = useState(0);

  // Pagination state - server-side
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalInvoices, setTotalInvoices] = useState(0);

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDialogInvoiceIds, setEmailDialogInvoiceIds] = useState<string[]>([]);

  // Ref to track if initial load has happened
  const initialLoadDone = useRef(false);

  const selectedInvoiceId = searchParams?.get('invoiceId') ?? null;
  const selectedTemplateId = searchParams?.get('templateId') ?? null;

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      // Reset to page 1 and clear selection when search changes
      if (initialLoadDone.current) {
        setCurrentPage(1);
        setSelectedInvoices(new Set());
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Handle page size change - reset to page 1 and clear selection
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
    setSelectedInvoices(new Set());
  };

  // Handle page change - clear selection (server-side pagination means selected items may not be visible)
  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
    setSelectedInvoices(new Set());
  };

  // For server-side pagination, filteredInvoices is just invoices (already filtered server-side)
  const filteredInvoices = invoices;

  const selectedInvoice = selectedInvoiceId ? invoices.find(inv => inv.invoice_id === selectedInvoiceId) || null : null;

  // Load data when pagination, search, or refresh changes
  useEffect(() => {
    loadData();
  }, [currentPage, pageSize, debouncedSearchTerm, refreshTrigger]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [paginatedResult, fetchedTemplates] = await Promise.all([
        fetchInvoicesPaginated({
          page: currentPage,
          pageSize: pageSize,
          searchTerm: debouncedSearchTerm,
          status: 'finalized',
          sortBy: 'finalized_at',
          sortOrder: 'desc'
        }),
        getInvoiceTemplates()
      ]);

      setInvoices(paginatedResult.invoices);
      setTotalInvoices(paginatedResult.total);
      setTemplates(fetchedTemplates);
      initialLoadDone.current = true;

      // Clamp page if current page is beyond available pages (e.g., after delete/filter)
      const maxPage = Math.max(1, Math.ceil(paginatedResult.total / pageSize));
      if (currentPage > maxPage) {
        setCurrentPage(maxPage);
        setSelectedInvoices(new Set()); // Clear selection since visible rows changed
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load invoices. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const updateUrlParams = (params: { [key: string]: string | null }) => {
    const newParams = new URLSearchParams(window.location.search);

    // Ensure we keep the main tabs
    if (!newParams.has('tab')) newParams.set('tab', 'invoicing');
    if (!newParams.has('subtab')) newParams.set('subtab', 'finalized');

    Object.entries(params).forEach(([key, value]) => {
      if (value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });

    const newUrl = `${window.location.pathname}?${newParams.toString()}`;

    // Only update the URL without triggering navigation
    window.history.pushState(null, '', newUrl);
  };

  const handleInvoiceSelect = (invoice: DbInvoiceViewModel) => {
    if (selectedInvoiceId === invoice.invoice_id) {
      updateUrlParams({ invoiceId: null, templateId: null });
    } else {
      const defaultTemplateId = templates.length > 0 ? templates[0].template_id : null;
      updateUrlParams({
        invoiceId: invoice.invoice_id,
        templateId: selectedTemplateId || defaultTemplateId
      });
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedInvoices(new Set(filteredInvoices.map(inv => inv.invoice_id)));
    } else {
      setSelectedInvoices(new Set());
    }
  };

  const handleSelectInvoice = (invoiceId: string, checked: boolean) => {
    const newSelection = new Set(selectedInvoices);
    if (checked) {
      newSelection.add(invoiceId);
    } else {
      newSelection.delete(invoiceId);
    }
    setSelectedInvoices(newSelection);
  };

  const handleDownload = async () => {
    if (!selectedInvoice) return;
    setError(null);
    try {
      // Call server action to get PDF data as plain array
      const { pdfData, invoiceNumber } = await downloadInvoicePDF(selectedInvoice.invoice_id);

      // Convert plain array to Uint8Array and create blob
      const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });

      // Create a blob URL and trigger download
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `${invoiceNumber}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up the blob URL
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      setError('Failed to generate PDF. Please try again.');
    }
  };

  const handleEmail = async () => {
    if (!selectedInvoice) return;
    setEmailDialogInvoiceIds([selectedInvoice.invoice_id]);
    setEmailDialogOpen(true);
  };

  const handleUnfinalize = async () => {
    if (!selectedInvoice) return;
    setError(null);
    try {
      await unfinalizeInvoice(selectedInvoice.invoice_id);
      await loadData();
      onRefreshNeeded();
      updateUrlParams({ invoiceId: null, templateId: null });
    } catch (error) {
      console.error('Failed to unfinalize invoice:', error);
      setError('Failed to unfinalize invoice. Please try again.');
    }
  };

  const handleBulkDownload = async () => {
    setError(null);
    try {
      await scheduleInvoiceZipAction(Array.from(selectedInvoices));
      setSelectedInvoices(new Set());
    } catch (error) {
      console.error('Failed to generate PDFs:', error);
      setError('Failed to generate PDFs. Please try again.');
    }
  };

  const handleBulkEmail = () => {
    if (selectedInvoices.size === 0) return;
    setEmailDialogInvoiceIds(Array.from(selectedInvoices));
    setEmailDialogOpen(true);
  };

  const handleEmailDialogSuccess = () => {
    // Clear selection after successful send
    setSelectedInvoices(new Set());
  };

  const handleBulkUnfinalize = async () => {
    setError(null);
    try {
      for (const invoiceId of selectedInvoices) {
        await unfinalizeInvoice(invoiceId);
      }
      setSelectedInvoices(new Set());
      await loadData();
      onRefreshNeeded();
    } catch (error) {
      console.error('Failed to unfinalize invoices:', error);
      setError('Failed to unfinalize invoices. Please try again.');
    }
  };

  const columns: ColumnDefinition<DbInvoiceViewModel>[] = [
    {
      title: (
        <div className="flex items-center">
          <Checkbox
            id="select-all-finalized"
            checked={selectedInvoices.size > 0 && selectedInvoices.size === filteredInvoices.length}
            onChange={(e) => handleSelectAll((e.target as HTMLInputElement).checked)}
          />
        </div>
      ),
      dataIndex: 'invoice_id',
      width: '50px',
      render: (_, record) => (
        <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            id={`invoice-${record.invoice_id}`}
            checked={selectedInvoices.has(record.invoice_id)}
            onChange={(e) => handleSelectInvoice(record.invoice_id, (e.target as HTMLInputElement).checked)}
          />
        </div>
      ),
    },
    {
      title: 'Invoice Number',
      dataIndex: 'invoice_number',
    },
    {
      title: 'Client',
      dataIndex: ['client', 'name'],
    },
	    {
	      title: 'Amount',
	      dataIndex: 'total_amount',
	      render: (value, record) => formatCurrencyFromMinorUnits(Number(value), 'en-US', record.currencyCode || 'USD'),
	    },
    {
      title: 'Finalized Date',
      dataIndex: 'finalized_at',
      render: (value) => value ? toPlainDate(value).toLocaleString() : '',
    },
    {
      title: 'Status',
      dataIndex: 'finalized_at',
      render: () => <Badge variant="default" className="bg-green-100 text-green-800 border-green-200">Finalized</Badge>,
    },
    {
      title: 'Actions',
      dataIndex: 'invoice_id',
      width: '5%',
      render: (_, record) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`finalized-row-actions-${record.invoice_id}`} variant="ghost" className="h-8 w-8 p-0" aria-label="Invoice actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await scheduleInvoiceZipAction([record.invoice_id]);
                  } catch (error) {
                    setError('Failed to generate PDF.');
                  }
                }}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setEmailDialogInvoiceIds([record.invoice_id]);
                  setEmailDialogOpen(true);
                }}
                className="flex items-center gap-2"
              >
                <Mail className="h-4 w-4" />
                Send Email
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await unfinalizeInvoice(record.invoice_id);
                    await loadData();
                    onRefreshNeeded();
                  } catch (error) {
                    setError('Failed to unfinalize invoice.');
                  }
                }}
                className="flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Unfinalize
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <Input
              type="text"
              placeholder="Search invoices..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
              aria-label="Search invoices"
            />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="finalized-bulk-actions-trigger"
              variant="outline"
              disabled={selectedInvoices.size === 0}
              className="flex items-center gap-2"
            >
              Actions ({selectedInvoices.size})
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleBulkDownload} className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Download PDFs
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBulkEmail} className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Send Emails
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBulkUnfinalize} className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Unfinalize Selected
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {error && (
        <div className="text-red-500 mb-4 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      )}

      {isLoading ? (
        <Card>
          <div className="p-12 flex items-center justify-center">
            <LoadingIndicator text="Loading invoices..." spinnerProps={{ size: 'md' }} layout="stacked" textClassName="text-gray-600" />
          </div>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <Card>
          <div className="p-12 text-center">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Finalized Invoices</h3>
            <p className="text-gray-600 mb-4">
              Finalized invoices will appear here once you've approved and finalized your drafts.
            </p>
            <Button id="finalized-empty-view-drafts" onClick={() => router.push('/msp/billing?tab=invoicing&subtab=drafts')} className="flex items-center gap-2">
              View Drafts
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : (
        <PanelGroup direction="horizontal" className="min-h-[600px]">
          <Panel defaultSize={60} minSize={30} onResize={() => setTableKey(prev => prev + 1)}>
            <div className="pr-2">
              <DataTable
                id="invoices-finalized-table"
                key={`${tableKey}-${currentPage}-${pageSize}`}
                data={filteredInvoices}
                columns={columns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={handlePageChange}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
                totalItems={totalInvoices}
                onRowClick={handleInvoiceSelect}
                rowClassName={(record) =>
                  selectedInvoiceId === record.invoice_id ? "bg-blue-50" : "cursor-pointer hover:bg-gray-50"
                }
              />
            </div>
          </Panel>

          <PanelResizeHandle className="w-2 hover:bg-[rgb(var(--color-primary-50))] transition-colors relative flex items-center justify-center group">
            <div className="absolute inset-y-0 w-1 bg-[rgb(var(--color-border-200))] group-hover:bg-[rgb(var(--color-primary-400))] transition-colors"></div>
            <GripVertical className="h-4 w-4 text-[rgb(var(--color-text-400))] group-hover:text-[rgb(var(--color-primary-600))] relative z-10" />
          </PanelResizeHandle>

          <Panel defaultSize={40} minSize={30}>
            <div className="pl-2">
              <InvoicePreviewPanel
                key={`finalized-${selectedInvoiceId}`}
                invoiceId={selectedInvoiceId}
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onTemplateChange={(templateId) => updateUrlParams({ templateId })}
                onDownload={handleDownload}
                onEmail={handleEmail}
                onUnfinalize={handleUnfinalize}
                isFinalized={true}
                creditApplied={selectedInvoice?.credit_applied || 0}
              />
            </div>
          </Panel>
        </PanelGroup>
      )}

      <SendInvoiceEmailDialog
        isOpen={emailDialogOpen}
        onClose={() => setEmailDialogOpen(false)}
        invoiceIds={emailDialogInvoiceIds}
        onSuccess={handleEmailDialogSuccess}
      />
    </div>
  );
};

export default FinalizedTab;
