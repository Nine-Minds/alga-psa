'use client'

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Checkbox } from '../../ui/Checkbox';
import { DataTable } from '../../ui/DataTable';
import { Badge } from '../../ui/Badge';
import { MoreVertical, CheckCircle, GripVertical, Download, Mail, RotateCcw, Search, ArrowRight } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/DropdownMenu';
import { ColumnDefinition } from '../../../interfaces/dataTable.interfaces';
import { InvoiceViewModel as DbInvoiceViewModel, IInvoiceTemplate } from '../../../interfaces/invoice.interfaces';
import { fetchAllInvoices } from '../../../lib/actions/invoiceQueries';
import { getInvoiceTemplates } from '../../../lib/actions/invoiceTemplates';
import { unfinalizeInvoice } from '../../../lib/actions/invoiceModification';
import { scheduleInvoiceZipAction } from '../../../lib/actions/job-actions/scheduleInvoiceZipAction';
import { downloadInvoicePDF } from '../../../lib/actions/invoiceGeneration';
import { SendInvoiceEmailDialog } from './SendInvoiceEmailDialog';
import { toPlainDate } from '../../../lib/utils/dateTimeUtils';
import { formatCurrencyFromMinorUnits } from '../../../lib/utils/formatters';
import InvoicePreviewPanel from './InvoicePreviewPanel';
import LoadingIndicator from '../../ui/LoadingIndicator';

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

  const [allInvoices, setAllInvoices] = useState<DbInvoiceViewModel[]>([]);
  const [templates, setTemplates] = useState<IInvoiceTemplate[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableKey, setTableKey] = useState(0);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Email dialog state
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailDialogInvoiceIds, setEmailDialogInvoiceIds] = useState<string[]>([]);

  const selectedInvoiceId = searchParams?.get('invoiceId') ?? null;
  const selectedTemplateId = searchParams?.get('templateId') ?? null;

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Filter for finalized only. Some environments mark finalization via status, not finalized_at.
  const invoices = allInvoices.filter(inv => inv.finalized_at || inv.status !== 'draft');

  // Apply search filter
  const filteredInvoices = invoices.filter(inv =>
    inv.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedInvoice = selectedInvoiceId ? invoices.find(inv => inv.invoice_id === selectedInvoiceId) || null : null;

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [fetchedInvoices, fetchedTemplates] = await Promise.all([
        fetchAllInvoices(),
        getInvoiceTemplates()
      ]);

      setAllInvoices(fetchedInvoices);
      setTemplates(fetchedTemplates);
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
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
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
