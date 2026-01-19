'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import type { InvoiceViewModel } from '@alga-psa/types';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Button } from '@alga-psa/ui/components/Button';
import { MoreVertical, Download, Eye, Mail, CreditCard, X } from 'lucide-react';
import {
  getClientInvoices,
  downloadClientInvoicePdf,
  sendClientInvoiceEmail,
} from '@alga-psa/client-portal/actions';
import ClientInvoicePreview from './ClientInvoicePreview';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import toast from 'react-hot-toast';

interface InvoicesTabProps {
  formatCurrency: (amount: number, currencyCode?: string) => string;
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
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceViewModel | null>(null);
  const [downloadingInvoices, setDownloadingInvoices] = useState<Set<string>>(new Set());
  const [sendingEmails, setSendingEmails] = useState<Set<string>>(new Set());

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
    setDownloadingInvoices(prev => new Set(prev).add(invoiceId));

    try {
      toast.success(t('billing.invoice.downloadStarted', 'Preparing PDF download...'));
      const result = await downloadClientInvoicePdf(invoiceId);

      if (result.success && result.fileId) {
        // Trigger download
        const downloadUrl = `/api/documents/download/${result.fileId}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = '';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success(t('billing.invoice.downloadComplete', 'PDF downloaded successfully.'));
      } else {
        toast.error(result.error || t('billing.invoice.downloadFailed', 'Failed to download PDF.'));
      }
    } catch (error) {
      console.error('Failed to download PDF:', error);
      toast.error(t('billing.invoice.downloadFailed', 'Failed to download PDF. Please try again.'));
    } finally {
      setDownloadingInvoices(prev => {
        const next = new Set(prev);
        next.delete(invoiceId);
        return next;
      });
    }
  };

  const handleSendEmail = async (invoiceId: string) => {
    setError(null);
    setSendingEmails(prev => new Set(prev).add(invoiceId));

    try {
      toast.success(t('billing.invoice.emailStarted', 'Sending invoice email...'));
      const result = await sendClientInvoiceEmail(invoiceId);

      if (result.success) {
        toast.success(t('billing.invoice.emailSent', 'Invoice email sent successfully.'));
      } else {
        toast.error(result.error || t('billing.invoice.sendEmailFailed', 'Failed to send email.'));
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      toast.error(t('billing.invoice.sendEmailFailed', 'Failed to send invoice email. Please try again.'));
    } finally {
      setSendingEmails(prev => {
        const next = new Set(prev);
        next.delete(invoiceId);
        return next;
      });
    }
  };

  const handlePayInvoice = (invoiceId: string) => {
    router.push(`/client-portal/billing/invoices/${invoiceId}/pay`);
  };

  // Check if invoice can be paid (finalized and not fully paid)
  const canPayInvoice = (invoice: InvoiceViewModel): boolean => {
    // Must be finalized
    if (!invoice.finalized_at) return false;
    // Check if already paid (total matches credit_applied or has paid status)
    if (invoice.credit_applied >= invoice.total) return false;
    return true;
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
      render: (value, record) => {
        // Convert cents to dollars and handle potential null/undefined
        const amount = typeof value === 'number' ? value : 0;
        return formatCurrency(amount, record.currencyCode);
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
              id={`pay-invoice-${record.invoice_number}-menu-item`}
              disabled={!canPayInvoice(record)}
              onClick={(e) => {
                e.stopPropagation();
                if (canPayInvoice(record)) {
                  handlePayInvoice(record.invoice_id);
                }
              }}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              {t('billing.invoice.pay', 'Pay Now')}
            </DropdownMenuItem>
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
  ], [formatDate, formatCurrency, t]);

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
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold">
              {t('billing.invoice.details', 'Invoice Details')} - {selectedInvoice.invoice_number}
            </h3>
            <Button
              id="close-invoice-details"
              variant="ghost"
              size="sm"
              onClick={() => updateUrlParams({ invoiceId: null })}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="border rounded-lg bg-white shadow-sm overflow-hidden">
            {/* Invoice Preview using same renderer as MSP portal */}
            <ClientInvoicePreview
              invoiceId={selectedInvoice.invoice_id}
              className="p-4"
            />

            {/* Show credit information if credits were applied */}
            {selectedInvoice.credit_applied > 0 && (
              <div className="mx-4 mb-4 p-4 bg-blue-50 rounded-md">
                <p className="text-blue-800">
                  Credit Applied: {formatCurrency(selectedInvoice.credit_applied, selectedInvoice.currencyCode)}
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div className="p-4 border-t bg-gray-50 flex justify-end space-x-3">
              <Button
                id={`send-email-invoice-${selectedInvoice.invoice_number}`}
                variant="outline"
                disabled={sendingEmails.has(selectedInvoice.invoice_id)}
                onClick={() => handleSendEmail(selectedInvoice.invoice_id)}
              >
                <Mail className="mr-2 h-4 w-4" />
                {sendingEmails.has(selectedInvoice.invoice_id) ? 'Sending...' : 'Send as Email'}
              </Button>
              <Button
                id={`download-invoice-${selectedInvoice.invoice_number}`}
                variant="outline"
                disabled={downloadingInvoices.has(selectedInvoice.invoice_id)}
                onClick={() => handleDownloadPdf(selectedInvoice.invoice_id)}
              >
                <Download className="mr-2 h-4 w-4" />
                {downloadingInvoices.has(selectedInvoice.invoice_id) ? 'Preparing...' : 'Download PDF'}
              </Button>
              <Button
                id={`pay-invoice-${selectedInvoice.invoice_number}`}
                disabled={!canPayInvoice(selectedInvoice)}
                onClick={() => handlePayInvoice(selectedInvoice.invoice_id)}
              >
                <CreditCard className="mr-2 h-4 w-4" />
                Pay Now
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
