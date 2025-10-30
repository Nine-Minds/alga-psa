'use client'

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { Card } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Checkbox } from '../../ui/Checkbox';
import { DataTable } from '../../ui/DataTable';
import { Badge } from '../../ui/Badge';
import { FileText, MoreVertical, GripVertical, Search, CheckCircle, Download, ArrowRight, RotateCcw } from 'lucide-react';
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
import { finalizeInvoice, hardDeleteInvoice } from '../../../lib/actions/invoiceModification';
import { downloadInvoicePDF } from '../../../lib/actions/invoiceGeneration';
import { toPlainDate } from '../../../lib/utils/dateTimeUtils';
import InvoicePreviewPanel from './InvoicePreviewPanel';
import LoadingIndicator from '../../ui/LoadingIndicator';
import { ConfirmationDialog } from '../../ui/ConfirmationDialog';

interface DraftsTabProps {
  onRefreshNeeded: () => void;
  refreshTrigger: number;
}

const DraftsTab: React.FC<DraftsTabProps> = ({
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
  const [reverseDialogState, setReverseDialogState] = useState<{ isOpen: boolean; invoiceIds: string[] }>({ isOpen: false, invoiceIds: [] });
  const [isReverseConfirming, setIsReverseConfirming] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const selectedInvoiceId = searchParams?.get('invoiceId');
  const selectedTemplateId = searchParams?.get('templateId');

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

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
    } catch (err) {
      console.error('Error fetching draft invoices data:', err);
      setError('Failed to load draft invoices. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const normalizeStatus = (status?: string | null) => (status || 'draft').toLowerCase();

  const invoices = allInvoices.filter(inv => !inv.finalized_at && normalizeStatus(inv.status) === 'draft');

  const filteredInvoices = invoices.filter(inv =>
    inv.invoice_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    inv.client?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedInvoice = selectedInvoiceId ? invoices.find(inv => inv.invoice_id === selectedInvoiceId) || null : null;

  const updateUrlParams = (params: { [key: string]: string | null }) => {
    const newParams = new URLSearchParams(window.location.search);

    if (!newParams.has('tab')) newParams.set('tab', 'invoicing');
    newParams.set('subtab', 'drafts');

    Object.entries(params).forEach(([key, value]) => {
      if (value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    });

    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    window.history.pushState(null, '', newUrl);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedInvoices(new Set(filteredInvoices.map(inv => inv.invoice_id)));
    } else {
      setSelectedInvoices(new Set());
    }
  };

  const handleSelectInvoice = (invoiceId: string, checked: boolean) => {
    const nextSelection = new Set(selectedInvoices);
    if (checked) {
      nextSelection.add(invoiceId);
    } else {
      nextSelection.delete(invoiceId);
    }
    setSelectedInvoices(nextSelection);
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

  const handleFinalizeSingle = async (invoiceId: string) => {
    setError(null);
    try {
      await finalizeInvoice(invoiceId);
      await loadData();
      onRefreshNeeded();
      setSelectedInvoices(prev => {
        const next = new Set(prev);
        next.delete(invoiceId);
        return next;
      });
      if (selectedInvoiceId === invoiceId) {
        updateUrlParams({ invoiceId: null, templateId: null });
      }
    } catch (err) {
      console.error('Failed to finalize invoice:', err);
      setError('Failed to finalize invoice. Please try again.');
    }
  };

  const openReverseDialog = (invoiceIds: string[]) => {
    setReverseDialogState({ isOpen: true, invoiceIds });
  };

  const handleFinalizeFromPreview = async () => {
    if (!selectedInvoice) return;
    await handleFinalizeSingle(selectedInvoice.invoice_id);
  };

  const handleReverseFromPreview = async () => {
    if (!selectedInvoice) return;
    openReverseDialog([selectedInvoice.invoice_id]);
  };

  const handleBulkFinalize = async () => {
    setError(null);
    try {
      for (const invoiceId of selectedInvoices) {
        await finalizeInvoice(invoiceId);
      }
      setSelectedInvoices(new Set());
      await loadData();
      onRefreshNeeded();
      updateUrlParams({ invoiceId: null, templateId: null });
    } catch (err) {
      console.error('Failed to finalize selected invoices:', err);
      setError('Failed to finalize selected invoices. Please try again.');
    }
  };

  const handleBulkReverse = async () => {
    if (selectedInvoices.size === 0) return;
    openReverseDialog(Array.from(selectedInvoices));
  };

  const handleDownload = async () => {
    if (!selectedInvoice) return;
    setError(null);
    try {
      const { pdfData, invoiceNumber } = await downloadInvoicePDF(selectedInvoice.invoice_id);

      const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `${invoiceNumber}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      setError('Failed to generate PDF. Please try again.');
    }
  };

  const columns: ColumnDefinition<DbInvoiceViewModel>[] = [
    {
      title: (
        <div className="flex items-center">
          <Checkbox
            id="select-all-drafts"
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
            id={`draft-${record.invoice_id}`}
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
      render: (value) => `$${(Number(value) / 100).toFixed(2)}`,
    },
    {
      title: 'Invoice Date',
      dataIndex: 'invoice_date',
      render: (value) => toPlainDate(value).toLocaleString(),
    },
    {
      title: 'Due Date',
      dataIndex: 'due_date',
      render: (value) => value ? toPlainDate(value).toLocaleString() : '',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: () => (
        <Badge variant="default" className="bg-amber-100 text-amber-800 border-amber-200">
          Draft
        </Badge>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'invoice_id',
      width: '5%',
      render: (_, record) => (
        <div onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`draft-row-actions-${record.invoice_id}`} variant="ghost" className="h-8 w-8 p-0" aria-label="Invoice actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={async () => await handleFinalizeSingle(record.invoice_id)}
                className="flex items-center gap-2"
                id={`finalize-draft-${record.invoice_id}-menu-item`}
              >
                <CheckCircle className="h-4 w-4" />
                Finalize
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    const { pdfData, invoiceNumber } = await downloadInvoicePDF(record.invoice_id);
                    const blob = new Blob([new Uint8Array(pdfData)], { type: 'application/pdf' });
                    const blobUrl = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = blobUrl;
                    link.setAttribute('download', `${invoiceNumber}.pdf`);
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    window.URL.revokeObjectURL(blobUrl);
                  } catch (err) {
                    console.error('Failed to generate PDF:', err);
                    setError('Failed to generate PDF. Please try again.');
                  }
                }}
                className="flex items-center gap-2"
                id={`download-draft-${record.invoice_id}-menu-item`}
              >
                <Download className="h-4 w-4" />
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openReverseDialog([record.invoice_id])}
                className="flex items-center gap-2 text-red-600 focus:text-red-600"
                id={`reverse-draft-${record.invoice_id}-menu-item`}
              >
                <RotateCcw className="h-4 w-4" />
                Reverse Draft
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
              aria-label="Search draft invoices"
            />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="drafts-bulk-actions-trigger"
              variant="outline"
              disabled={selectedInvoices.size === 0}
              className="flex items-center gap-2"
            >
              Actions ({selectedInvoices.size})
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleBulkFinalize} className="flex items-center gap-2" id="finalize-selected-drafts-menu-item">
              <CheckCircle className="h-4 w-4" />
              Finalize Selected
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBulkReverse} className="flex items-center gap-2 text-red-600 focus:text-red-600" id="reverse-selected-drafts-menu-item">
              <RotateCcw className="h-4 w-4" />
              Reverse Selected
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
            <LoadingIndicator text="Loading draft invoices..." spinnerProps={{ size: 'md' }} layout="stacked" textClassName="text-gray-600" />
          </div>
        </Card>
      ) : filteredInvoices.length === 0 ? (
        <Card>
          <div className="p-12 text-center">
            <FileText className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Draft Invoices</h3>
            <p className="text-gray-600 mb-4">
              Draft invoices will appear here once you create invoices that have not been finalized.
            </p>
            <Button
              id="drafts-view-generate"
              onClick={() => router.push('/msp/billing?tab=invoicing&subtab=generate')}
              className="flex items-center gap-2"
            >
              Generate Invoices
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : (
        <PanelGroup direction="horizontal" className="min-h-[600px]">
          <Panel defaultSize={60} minSize={30} onResize={() => setTableKey(prev => prev + 1)}>
            <div className="pr-2">
              <DataTable
                id="invoice-drafts-table"
                key={tableKey}
                data={filteredInvoices}
                columns={columns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
                onRowClick={handleInvoiceSelect}
                rowClassName={(record) =>
                  selectedInvoiceId === record.invoice_id ? 'bg-blue-50' : 'cursor-pointer hover:bg-gray-50'
                }
                initialSorting={[{ id: 'invoice_date', desc: true }]}
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
                key={`draft-${selectedInvoiceId}`}
                invoiceId={selectedInvoiceId}
                templates={templates}
                selectedTemplateId={selectedTemplateId}
                onTemplateChange={(templateId) => updateUrlParams({ templateId })}
                onFinalize={handleFinalizeFromPreview}
                onReverse={handleReverseFromPreview}
                onDownload={handleDownload}
                isFinalized={false}
                creditApplied={selectedInvoice?.credit_applied || 0}
              />
            </div>
          </Panel>
        </PanelGroup>
      )}

      <ConfirmationDialog
        id="reverse-draft-confirmation"
        isOpen={reverseDialogState.isOpen}
        onClose={() => setReverseDialogState({ isOpen: false, invoiceIds: [] })}
        onConfirm={async () => {
          const invoiceIds = [...reverseDialogState.invoiceIds];
          if (invoiceIds.length === 0) {
            setReverseDialogState({ isOpen: false, invoiceIds: [] });
            return;
          }

          setIsReverseConfirming(true);
          setError(null);

          try {
            for (const invoiceId of invoiceIds) {
              await hardDeleteInvoice(invoiceId);
            }

            setSelectedInvoices(prev => {
              const next = new Set(prev);
              invoiceIds.forEach(id => next.delete(id));
              return next;
            });

            if (selectedInvoiceId && invoiceIds.includes(selectedInvoiceId)) {
              updateUrlParams({ invoiceId: null, templateId: null });
            }

            await loadData();
            onRefreshNeeded();
            setReverseDialogState({ isOpen: false, invoiceIds: [] });
          } catch (err) {
            console.error('Failed to reverse draft invoice(s):', err);
            setError(err instanceof Error ? err.message : 'Failed to reverse draft invoice(s). Please try again.');
          } finally {
            setIsReverseConfirming(false);
          }
        }}
        title={reverseDialogState.invoiceIds.length > 1 ? 'Reverse Draft Invoices' : 'Reverse Draft Invoice'}
        message={
          reverseDialogState.invoiceIds.length > 1
            ? `Reversing ${reverseDialogState.invoiceIds.length} draft invoices will delete them and release any linked time entries or usage records. This action cannot be undone.`
            : 'Reversing this draft invoice will delete it and release any linked time entries or usage records. This action cannot be undone.'
        }
        confirmLabel="Reverse Draft"
        cancelLabel="Cancel"
        isConfirming={isReverseConfirming}
      />
    </div>
  );
};

export default DraftsTab;
