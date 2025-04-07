'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import type { InvoiceViewModel, IInvoiceTemplate } from 'server/src/interfaces/invoice.interfaces';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import { Download, X, Mail } from 'lucide-react';
import { getClientInvoiceById, getClientInvoiceLineItems, downloadClientInvoicePdf, sendClientInvoiceEmail } from 'server/src/lib/actions/client-portal-actions/client-billing';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';

interface InvoiceDetailsDialogProps {
  invoiceId: string | null;
  isOpen: boolean;
  onClose: () => void;
  formatCurrency: (amount: number) => string;
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
  const [activeJobs, setActiveJobs] = useState<Set<string>>(new Set());

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
        setError('Failed to load invoice details. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvoiceDetails();
  }, [isOpen, invoiceId]);

  const handleDownloadPdf = async () => {
    if (!invoiceId) return;
    
    setError(null);
    try {
      const { jobId } = await downloadClientInvoicePdf(invoiceId);
      if (jobId) {
        setActiveJobs(prev => new Set(prev).add(jobId));
      }
    } catch (error) {
      console.error('Failed to download PDF:', error);
      setError('Failed to download PDF. Please try again.');
    }
  };

  const handleSendEmail = async () => {
    if (!invoiceId) return;
    
    setError(null);
    try {
      const { jobId } = await sendClientInvoiceEmail(invoiceId);
      if (jobId) {
        setActiveJobs(prev => new Set(prev).add(jobId));
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      setError('Failed to send invoice email. Please try again.');
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
              <p className="text-sm font-medium text-gray-500">Invoice Number</p>
              <p className="mt-1">{invoice.invoice_number}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Date</p>
              <p className="mt-1">{formatDate(invoice.invoice_date)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Amount</p>
              <p className="mt-1">${(invoice.total / 100).toFixed(2)}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Status</p>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                invoice.finalized_at ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {invoice.finalized_at ? 'Finalized' : 'Draft'}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Manual Invoice</p>
              <p className="mt-1">{invoice.is_manual ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Credits</p>
              <p className="mt-1">${(invoice.credit_applied / 100).toFixed(2)}</p>
            </div>
          </div>

          <div>
            <h4 className="font-semibold mt-4">Line Items</h4>
            <table className="min-w-full divide-y divide-gray-200 mt-2">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invoice.invoice_items && invoice.invoice_items.length > 0 ? (
                  invoice.invoice_items.map((item, idx) => (
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
                      No line items available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="font-semibold mt-4">Tax Breakdown</h4>
            <ul className="mt-2 space-y-1">
              <li className="flex justify-between">
                <span>Tax</span>
                <span>${(invoice.tax / 100).toFixed(2)}</span>
              </li>
            </ul>
          </div>
        </div>
      </>
    );
  }, [invoice, formatDate]);

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
    <Dialog isOpen={isOpen} onClose={onClose} data-automation-id="invoice-details-dialog">
      <DialogHeader>
        <DialogTitle>Invoice Details</DialogTitle>
      </DialogHeader>
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
          disabled={!invoice}
          onClick={handleSendEmail}
        >
          <Mail className="mr-2 h-4 w-4" />
          Send Email
        </Button>
        <Button
          id="download-invoice-button"
          disabled={!invoice}
          onClick={handleDownloadPdf}
        >
          <Download className="mr-2 h-4 w-4" />
          Download
        </Button>
      </DialogFooter>
    </Dialog>
  );
});

// Add display name for debugging
InvoiceDetailsDialog.displayName = 'InvoiceDetailsDialog';

export default InvoiceDetailsDialog;