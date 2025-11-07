'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Download, Eye, Mail } from 'lucide-react';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import {
  getClientInvoices,
  getClientInvoiceById,
  downloadClientInvoicePdf,
  sendClientInvoiceEmail
} from 'server/src/lib/actions/client-portal-actions/client-billing';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from 'server/src/lib/i18n/client';

interface InvoicesTabProps {
  formatCurrency: (amount: number) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
}

const InvoicesTab: React.FC<InvoicesTabProps> = React.memo(({
  formatCurrency,
  formatDate
}) => {
  const { t } = useTranslation('clientPortal');
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [invoices, setInvoices] = useState<InvoiceViewModel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceViewModel | null>(null);

  const selectedInvoiceId = searchParams?.get('invoiceId');

  // Function to update URL parameters
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

  // Load invoices
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fetchedInvoices = await getClientInvoices();
        setInvoices(fetchedInvoices);
      } catch (err) {
        console.error('Error loading invoices:', err);
        setError(t('billing.failedToLoad'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  // Load selected invoice details
  useEffect(() => {
    if (selectedInvoiceId) {
      const invoice = invoices.find(inv => inv.invoice_id === selectedInvoiceId);
      if (invoice) {
        setSelectedInvoice(invoice);
      } else {
        setSelectedInvoice(null);
      }
    } else {
      setSelectedInvoice(null);
    }
  }, [selectedInvoiceId, invoices]);

  const handleInvoiceClick = (invoice: InvoiceViewModel) => {
    updateUrlParams({
      invoiceId: invoice.invoice_id
    });
  };

  const handleDownloadPdf = async (invoiceId: string) => {
    setError(null);
    try {
      const { jobId } = await downloadClientInvoicePdf(invoiceId);
      if (jobId) {
        setActiveJobs(prev => new Set(prev).add(jobId));
      }
    } catch (error) {
      console.error('Failed to download PDF:', error);
      setError(t('billing.invoice.downloadFailed', 'Failed to download PDF. Please try again.'));
    }
  };

  const handleSendEmail = async (invoiceId: string) => {
    setError(null);
    try {
      const { jobId } = await sendClientInvoiceEmail(invoiceId);
      if (jobId) {
        setActiveJobs(prev => new Set(prev).add(jobId));
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      setError(t('billing.invoice.sendEmailFailed', 'Failed to send invoice email. Please try again.'));
    }
  };

  // Memoize the columns to prevent unnecessary re-creation
  const invoiceColumns: ColumnDefinition<InvoiceViewModel>[] = useMemo(() => [
    {
      title: t('billing.invoice.number'),
      dataIndex: 'invoice_number'
    },
    {
      title: t('billing.invoice.date'),
      dataIndex: 'invoice_date',
      render: (value) => formatDate(value)
    },
    {
      title: t('billing.invoice.amount'),
      dataIndex: 'total',
      render: (value) => {
        // Convert cents to dollars and handle potential null/undefined
        const amount = typeof value === 'number' ? value / 100 : 0;
        return `$${amount.toFixed(2)}`;
      }
    },
    {
      title: t('billing.invoice.status'),
      dataIndex: 'finalized_at',
      render: (value) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
        }`}>
          {value ? t('billing.invoice.finalized') : t('billing.invoice.draft')}
        </span>
      )
    },
    {
      title: t('common.actions'),
      dataIndex: 'invoice_id',
      render: (value: string, record: InvoiceViewModel) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`invoice-${record.invoice_number}-actions-menu`}
              variant="ghost"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`view-invoice-${record.invoice_number}-menu-item`}
              onClick={(e) => {
                e.stopPropagation();
                handleInvoiceClick(record);
              }}
            >
              <Eye className="mr-2 h-4 w-4" />
              {t('billing.invoice.view')}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`download-invoice-${record.invoice_number}-menu-item`}
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadPdf(record.invoice_id);
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              {t('billing.invoice.download')}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`email-invoice-${record.invoice_number}-menu-item`}
              onClick={(e) => {
                e.stopPropagation();
                handleSendEmail(record.invoice_id);
              }}
            >
              <Mail className="mr-2 h-4 w-4" />
              {t('billing.invoice.sendEmail')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ], [formatDate, t]);

  // Loading state with skeleton
  if (isLoading) {
    return (
      <div id="invoices-loading" className="py-4">
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
    <div id="invoices-content" className="py-4">
      {error && (
        <div className="text-red-500 mb-4">{error}</div>
      )}
      <div id="invoices-table-container" className="mb-8">
        <DataTable
          id="client-portal-invoices"
          data={invoices}
          columns={invoiceColumns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={10}
          onRowClick={handleInvoiceClick}
        />
        {invoices.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-500">{t('billing.messages.noInvoices', 'No invoices found')}</p>
          </div>
        )}
      </div>

      {selectedInvoice && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold mb-4">{t('billing.invoice.details', 'Invoice Details')}</h3>
          <div className="border rounded-lg p-6 bg-white shadow-sm">
            <div className="grid grid-cols-2 gap-6 mb-6">
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t('billing.invoice.number', 'Invoice Number')}</h4>
                <p className="text-lg font-medium">{selectedInvoice.invoice_number}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t('billing.invoice.date', 'Invoice Date')}</h4>
                <p className="text-lg">{formatDate(selectedInvoice.invoice_date)}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t('billing.invoice.status', 'Status')}</h4>
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  selectedInvoice.finalized_at ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {selectedInvoice.finalized_at ? t('billing.invoice.finalized', 'Finalized') : t('billing.invoice.draft', 'Draft')}
                </span>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t('billing.invoice.dueDate', 'Due Date')}</h4>
                <p className="text-lg">{formatDate(selectedInvoice.due_date)}</p>
              </div>
            </div>

            <div className="mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-2">{t('billing.invoice.lineItems', 'Line Items')}</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('billing.invoice.description', 'Description')}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('billing.invoice.quantity', 'Quantity')}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('billing.invoice.unitPrice', 'Unit Price')}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('billing.invoice.total', 'Total')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {selectedInvoice.invoice_charges && selectedInvoice.invoice_charges.length > 0 ? (
                      selectedInvoice.invoice_charges.map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2">{item.description}</td>
                          <td className="px-3 py-2">{item.quantity}</td>
                          <td className="px-3 py-2">${(item.unit_price / 100).toFixed(2)}</td>
                          <td className="px-3 py-2">${(item.total_price / 100).toFixed(2)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-center text-gray-500">
                          {t('billing.invoice.noLineItems', 'No line items available')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-between border-t pt-4">
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t('billing.invoice.subtotal', 'Subtotal')}</h4>
                <p className="text-lg">${(selectedInvoice.subtotal / 100).toFixed(2)}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t('billing.invoice.tax', 'Tax')}</h4>
                <p className="text-lg">${(selectedInvoice.tax / 100).toFixed(2)}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500">{t('billing.invoice.total', 'Total')}</h4>
                <p className="text-lg font-bold">${(selectedInvoice.total / 100).toFixed(2)}</p>
              </div>
            </div>
            
            {/* Show credit information if credits were applied */}
            {selectedInvoice.credit_applied > 0 && (
              <div className="mt-4 p-4 bg-blue-50 rounded-md">
                <p className="text-blue-800">
                  Credit Applied: ${(selectedInvoice.credit_applied / 100).toFixed(2)}
                </p>
              </div>
            )}
            
            <div className="mt-6 flex justify-end space-x-3">
              <Button
                id={`send-email-invoice-${selectedInvoice.invoice_number}`}
                variant="outline"
                onClick={() => handleSendEmail(selectedInvoice.invoice_id)}
              >
                <Mail className="mr-2 h-4 w-4" />
                Send as Email
              </Button>
              <Button
                id={`download-invoice-${selectedInvoice.invoice_number}`}
                onClick={() => handleDownloadPdf(selectedInvoice.invoice_id)}
              >
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// Add display name for debugging
InvoicesTab.displayName = 'InvoicesTab';

export default InvoicesTab;
