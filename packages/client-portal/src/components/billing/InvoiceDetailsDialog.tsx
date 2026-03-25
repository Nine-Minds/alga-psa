'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import type { InvoiceViewModel, IInvoiceTemplate } from '@alga-psa/types';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Download, X, Mail } from 'lucide-react';
import { getClientInvoiceById, downloadClientInvoicePdf, sendClientInvoiceEmail } from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';

interface InvoiceDetailsDialogProps {
  invoiceId: string | null;
  isOpen: boolean;
  onClose: () => void;
  formatCurrency: (amount: number, currencyCode?: string) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
};

const InvoiceDetailsDialog: React.FC<InvoiceDetailsDialogProps> = React.memo(({
  invoiceId,
  isOpen,
  onClose,
  formatCurrency,
  formatDate
}) => {
  const [invoice, setInvoice] = useState<InvoiceViewModel | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const { t } = useTranslation('features/billing');
  const { t: tCommon } = useTranslation('common');

  const formatServicePeriodRange = (
    start: string | null | undefined,
    end: string | null | undefined
  ): string | null => {
    if (!start || !end) {
      return null;
    }

    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const renderRecurringDetailPeriods = (
    periods: Array<{
      service_period_start?: string | null;
      service_period_end?: string | null;
      billing_timing?: 'arrears' | 'advance' | null;
    }> | undefined
  ) => {
    if (!periods || periods.length === 0) {
      return null;
    }

    const renderedPeriods = periods
      .map((period) => ({
        start: period.service_period_start ?? null,
        end: period.service_period_end ?? null,
        label: formatServicePeriodRange(period.service_period_start, period.service_period_end),
        timing: period.billing_timing,
      }))
      .filter((period): period is {
        start: string | null;
        end: string | null;
        label: string;
        timing: 'arrears' | 'advance' | null | undefined;
      } => Boolean(period.label))
      .sort((left, right) => {
        if (left.start !== right.start) {
          return String(left.start ?? '').localeCompare(String(right.start ?? ''));
        }
        return String(left.end ?? '').localeCompare(String(right.end ?? ''));
      });

    if (renderedPeriods.length === 0) {
      return null;
    }

    // Portal policy:
    // - multi-detail recurring rows render the canonical detail list
    // - single-detail recurring rows render one "Service Period" line
    // - rows with no canonical detail list fall back to parent summary fields elsewhere below
    if (renderedPeriods.length === 1) {
      return (
        <div className="text-xs text-muted-foreground">
          {t('invoice.servicePeriod', 'Service Period')}: {renderedPeriods[0].label}
        </div>
      );
    }

    return (
      <div className="text-xs text-muted-foreground">
        <div>{t('invoice.servicePeriods', 'Service Periods')}:</div>
          <ul className="list-disc pl-4">
            {renderedPeriods.map((period) => (
              <li key={`${period.label}:${period.timing ?? 'none'}`}>{period.label}</li>
            ))}
        </ul>
      </div>
    );
  };

  const renderFinancialArtifactNote = (item: InvoiceViewModel['invoice_charges'][number]) => {
    const hasSummaryRange = Boolean(
      formatServicePeriodRange(item.service_period_start, item.service_period_end)
    );
    const hasRecurringDetails = Boolean(item.recurring_detail_periods?.length);

    if (hasSummaryRange || hasRecurringDetails) {
      return null;
    }

    if (item.is_manual) {
      return (
        <div className="text-xs text-muted-foreground">
          {t('invoice.financialOnlyLine', 'Financial-only line. No recurring service period.')}
        </div>
      );
    }

    return null;
  };

  // Fetch invoice details when dialog opens
  useEffect(() => {
    const fetchInvoiceDetails = async () => {
      if (!isOpen || !invoiceId) {
        setInvoice(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const invoiceData = await getClientInvoiceById(invoiceId);
        setInvoice(invoiceData);
      } catch (err) {
        console.error('Error fetching invoice details:', err);
        setError(t('invoice.loadFailed', 'Failed to load invoice details. Please try again.'));
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvoiceDetails();
  }, [isOpen, invoiceId]);

  const handleDownloadPdf = async () => {
    if (!invoiceId) return;

    setError(null);
    setIsDownloading(true);

    try {
      toast.success(t('invoice.downloadStarted', 'Preparing PDF download...'));
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
        toast.success(t('invoice.downloadComplete', 'PDF downloaded successfully.'));
      } else {
        toast.error(result.error || t('invoice.downloadFailed', 'Failed to download PDF.'));
      }
    } catch (error) {
      handleError(error, t('invoice.downloadFailed', 'Failed to download PDF. Please try again.'));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSendEmail = async () => {
    if (!invoiceId) return;

    setError(null);
    setIsSendingEmail(true);

    try {
      toast.success(t('invoice.emailStarted', 'Sending invoice email...'));
      const result = await sendClientInvoiceEmail(invoiceId);

      if (result.success) {
        toast.success(t('invoice.emailSent', 'Invoice email sent successfully.'));
      } else {
        toast.error(result.error || t('invoice.sendEmailFailed', 'Failed to send email.'));
      }
    } catch (error) {
      handleError(error, t('invoice.sendEmailFailed', 'Failed to send invoice email. Please try again.'));
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Memoize the invoice details content to prevent unnecessary re-renders
  const invoiceContent = useMemo(() => {
    if (!invoice) return null;
    
    return (
      <>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-gray-500">{t('invoice.number', 'Invoice Number')}</p>
              <p className="mt-1">{invoice.invoice_number}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{t('invoice.date', 'Invoice Date')}</p>
              <p className="mt-1">{formatDate(invoice.invoice_date)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{t('invoice.amount', 'Amount')}</p>
              <p className="mt-1">{formatCurrency(invoice.total, invoice.currencyCode)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{t('invoice.status', 'Status')}</p>
              <Badge variant={invoice.finalized_at ? 'success' : 'warning'} className="mt-1">
                {invoice.finalized_at ? t('invoice.finalized', 'Finalized') : t('invoice.draft', 'Draft')}
              </Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{t('invoice.manualInvoice', 'Manual Invoice')}</p>
              <p className="mt-1">{invoice.is_manual ? tCommon('common.yes', 'Yes') : tCommon('common.no', 'No')}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{t('invoice.credits', 'Credits')}</p>
              <p className="mt-1">{formatCurrency(invoice.credit_applied, invoice.currencyCode)}</p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mt-4">{t('invoice.lineItems', 'Line Items')}</h4>
            <table className="min-w-full divide-y divide-gray-200 mt-2">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('invoice.description', 'Description')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('invoice.quantity', 'Quantity')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('invoice.unitPrice', 'Unit Price')}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('invoice.total', 'Total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invoice.invoice_charges && invoice.invoice_charges.length > 0 ? (
                  invoice.invoice_charges.map((item, idx) => (
                    <tr key={idx} data-automation-id={`invoice-line-item-${idx}`}>
                      <td className="px-3 py-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span>{item.description}</span>
                            {item.service_item_kind === 'product' ? (
                              <Badge variant="secondary">Product</Badge>
                            ) : null}
                            {item.billing_timing ? (
                              <Badge variant="outline">
                                {item.billing_timing === 'advance'
                                  ? t('invoice.advanceTiming', 'Advance')
                                  : t('invoice.arrearsTiming', 'Arrears')}
                              </Badge>
                            ) : null}
                            {item.service_item_kind === 'product' && item.service_sku ? (
                              <span className="text-xs text-muted-foreground">{item.service_sku}</span>
                            ) : null}
                          </div>
                          {item.recurring_detail_periods && item.recurring_detail_periods.length > 0
                            ? renderRecurringDetailPeriods(item.recurring_detail_periods)
                            // Historical or flattened rows keep a single compatibility summary range.
                            : formatServicePeriodRange(item.service_period_start, item.service_period_end) ? (
                                <div className="text-xs text-muted-foreground">
                                  {t('invoice.servicePeriod', 'Service Period')}: {formatServicePeriodRange(item.service_period_start, item.service_period_end)}
                                </div>
                              ) : renderFinancialArtifactNote(item)}
                        </div>
                      </td>
                      <td className="px-3 py-2">{item.quantity}</td>
                      <td className="px-3 py-2">{formatCurrency(item.unit_price, invoice.currencyCode)}</td>
                      <td className="px-3 py-2">{formatCurrency(item.total_price, invoice.currencyCode)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-center text-gray-500">
                      {t('invoice.noLineItems', 'No line items available')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="font-semibold mt-4">{t('invoice.taxBreakdown', 'Tax Breakdown')}</h4>
            <ul className="mt-2 space-y-1">
              <li className="flex justify-between">
                <span>{t('invoice.tax', 'Tax')}</span>
                <span>{formatCurrency(invoice.tax, invoice.currencyCode)}</span>
              </li>
            </ul>
          </div>
        </div>
      </>
    );
  }, [invoice, formatDate, formatCurrency]);

  // Loading skeleton for when invoice is being fetched
  const loadingSkeleton = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i}>
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      
      <div>
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-32 w-full" />
      </div>
      
      <div>
        <Skeleton className="h-6 w-32 mb-2" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  );
  
  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose} 
      title={t('invoice.details', 'Invoice Details')} 
      data-automation-id="invoice-details-dialog"
    >
      <DialogContent>
        {error && (
          <div className="text-red-500 mb-4">{error}</div>
        )}
        <div data-automation-id="invoice-details-content">
          {isLoading ? loadingSkeleton : invoiceContent}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="close-invoice-dialog-button" variant="outline" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          Close
        </Button>
        <Button
          id="email-invoice-button"
          variant="outline"
          disabled={!invoice || isSendingEmail}
          onClick={handleSendEmail}
        >
          <Mail className="mr-2 h-4 w-4" />
          {isSendingEmail ? 'Sending...' : 'Send Email'}
        </Button>
        <Button
          id="download-invoice-button"
          disabled={!invoice || isDownloading}
          onClick={handleDownloadPdf}
        >
          <Download className="mr-2 h-4 w-4" />
          {isDownloading ? 'Preparing...' : 'Download'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
});

// Add display name for debugging
InvoiceDetailsDialog.displayName = 'InvoiceDetailsDialog';

export default InvoiceDetailsDialog;
