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
import { MoreVertical, CheckCircle, GripVertical } from 'lucide-react';
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
import { scheduleInvoiceEmailAction } from '../../../lib/actions/job-actions/scheduleInvoiceEmailAction';
import { toPlainDate } from '../../../lib/utils/dateTimeUtils';
import InvoicePreviewPanel from './InvoicePreviewPanel';

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

  const selectedInvoiceId = searchParams?.get('invoiceId');
  const selectedTemplateId = searchParams?.get('templateId');

  // Filter for finalized only
  const invoices = allInvoices.filter(inv => inv.finalized_at);

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
      await scheduleInvoiceZipAction([selectedInvoice.invoice_id]);
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      setError('Failed to generate PDF. Please try again.');
    }
  };

  const handleEmail = async () => {
    if (!selectedInvoice) return;
    setError(null);
    try {
      await scheduleInvoiceEmailAction([selectedInvoice.invoice_id]);
    } catch (error) {
      console.error('Failed to send email:', error);
      setError('Failed to send invoice email. Please try again.');
    }
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

  const handleBulkEmail = async () => {
    setError(null);
    try {
      await scheduleInvoiceEmailAction(Array.from(selectedInvoices));
      setSelectedInvoices(new Set());
    } catch (error) {
      console.error('Failed to send emails:', error);
      setError('Failed to send invoice emails. Please try again.');
    }
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
      render: (value) => `$${(Number(value) / 100).toFixed(2)}`,
    },
    {
      title: 'Invoice Date',
      dataIndex: 'invoice_date',
      render: (value) => toPlainDate(value).toLocaleString(),
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
              <Button variant="ghost" className="h-8 w-8 p-0">
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
              >
                Download PDF
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  try {
                    await scheduleInvoiceEmailAction([record.invoice_id]);
                  } catch (error) {
                    setError('Failed to send email.');
                  }
                }}
              >
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
              >
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
          <Input
            type="text"
            placeholder="Search invoices..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              disabled={selectedInvoices.size === 0}
              className="flex items-center gap-2"
            >
              Actions ({selectedInvoices.size})
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleBulkDownload}>
              Download PDFs
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBulkEmail}>
              Send Emails
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleBulkUnfinalize}>
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

      {filteredInvoices.length === 0 && !isLoading ? (
        <Card>
          <div className="p-12 text-center">
            <CheckCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Finalized Invoices</h3>
            <p className="text-gray-600 mb-4">
              Finalized invoices will appear here once you've approved and finalized your drafts.
            </p>
            <Button onClick={() => router.push('/msp/billing?tab=invoicing&subtab=drafts')}>
              View Drafts
            </Button>
          </div>
        </Card>
      ) : (
        <PanelGroup direction="horizontal" className="min-h-[600px]">
          <Panel defaultSize={60} minSize={30} onResize={() => setTableKey(prev => prev + 1)}>
            <div className="pr-2">
              <DataTable
                key={tableKey}
                data={filteredInvoices}
                columns={columns}
                pagination={true}
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
    </div>
  );
};

export default FinalizedTab;
