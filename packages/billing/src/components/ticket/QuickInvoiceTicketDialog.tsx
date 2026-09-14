'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { Receipt, ExternalLink } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  generateTicketInvoice,
  getTicketBillableItems,
  getTicketInvoices,
  type TicketBillableItems,
  type TicketInvoiceSummary,
} from '../../actions/ticketInvoiceActions';
import { translateManualInvoiceFailure } from '../billing-dashboard/manualInvoiceErrorTranslation';

type QuickInvoiceTicket = {
  ticket_id?: string;
  ticket_number?: string | null;
  title?: string | null;
};

interface QuickInvoiceTicketDialogProps {
  ticket: QuickInvoiceTicket;
  id?: string;
  disabled?: boolean;
}

const isReturnedActionError = (
  value: unknown,
): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

export default function QuickInvoiceTicketDialog({
  ticket,
  id = 'ticket-details',
  disabled = false,
}: QuickInvoiceTicketDialogProps) {
  const { t } = useTranslation('msp/invoicing');
  const { formatCurrency } = useFormatters();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [billable, setBillable] = useState<TicketBillableItems | null>(null);
  const [existingInvoices, setExistingInvoices] = useState<TicketInvoiceSummary[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdInvoiceId, setCreatedInvoiceId] = useState<string | null>(null);

  const ticketId = ticket.ticket_id;

  const load = useCallback(async () => {
    if (!ticketId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [itemsResult, invoicesResult] = await Promise.all([
        getTicketBillableItems(ticketId),
        getTicketInvoices(ticketId),
      ]);

      if (isReturnedActionError(itemsResult)) {
        setLoadError(getErrorMessage(itemsResult));
        setBillable(null);
      } else {
        setBillable(itemsResult);
        const allKeys = new Set<string>([
          ...itemsResult.timeItems.map((item) => `time:${item.id}`),
          ...itemsResult.materialItems.map((item) => `material:${item.id}`),
        ]);
        setSelectedKeys(allKeys);
      }

      setExistingInvoices(isReturnedActionError(invoicesResult) ? [] : invoicesResult);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (isOpen) {
      setCreatedInvoiceId(null);
      setSubmitError(null);
      void load();
    }
  }, [isOpen, load]);

  const timeItems = billable?.timeItems ?? [];
  const materialItems = billable?.materialItems ?? [];
  const currencyCode = billable?.currencyCode ?? 'USD';

  const toggle = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectedTotal = useMemo(() => {
    let total = 0;
    for (const item of timeItems) {
      if (selectedKeys.has(`time:${item.id}`)) total += item.amount;
    }
    for (const item of materialItems) {
      if (selectedKeys.has(`material:${item.id}`)) total += item.amount;
    }
    return total;
  }, [selectedKeys, timeItems, materialItems]);

  const selectedCount = useMemo(() => {
    const timeCount = timeItems.filter((item) => selectedKeys.has(`time:${item.id}`)).length;
    const materialCount = materialItems.filter((item) => selectedKeys.has(`material:${item.id}`)).length;
    return timeCount + materialCount;
  }, [selectedKeys, timeItems, materialItems]);

  const handleCreate = async () => {
    if (!ticketId || selectedCount === 0) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const timeEntryIds = timeItems
        .filter((item) => selectedKeys.has(`time:${item.id}`))
        .map((item) => item.id);
      const materialIds = materialItems
        .filter((item) => selectedKeys.has(`material:${item.id}`))
        .map((item) => item.id);

      const result = await generateTicketInvoice({ ticketId, timeEntryIds, materialIds });

      if (result.success) {
        setCreatedInvoiceId(result.invoice.invoice_id);
        setExistingInvoices((prev) => [
          {
            invoiceId: result.invoice.invoice_id,
            invoiceNumber: result.invoice.invoice_number,
            status: result.invoice.status,
            totalAmount: result.invoice.total_amount,
            currencyCode: result.invoice.currencyCode,
            invoiceDate: '',
          },
          ...prev,
        ]);
        toast.success(t('quickInvoice.created', { defaultValue: 'Invoice created' }));
        router.refresh();
      } else {
        setSubmitError(translateManualInvoiceFailure(t, result));
      }
    } catch (error) {
      setSubmitError(getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasItems = timeItems.length > 0 || materialItems.length > 0;

  const footer = createdInvoiceId ? (
    <div className="flex justify-end gap-2">
      <Button
        id={`${id}-quick-invoice-close-button`}
        type="button"
        variant="outline"
        onClick={() => setIsOpen(false)}
      >
        {t('quickInvoice.done', { defaultValue: 'Done' })}
      </Button>
      <Link href={`/msp/invoices/${createdInvoiceId}`}>
        <Button id={`${id}-quick-invoice-view-button`} type="button">
          {t('quickInvoice.viewInvoice', { defaultValue: 'View invoice' })}
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      </Link>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-[rgb(var(--color-text-600))]">
        {t('quickInvoice.selectedTotal', { defaultValue: 'Selected total' })}:{' '}
        <span className="font-semibold text-[rgb(var(--color-text-900))]">
          {formatCurrency(selectedTotal / 100, currencyCode)}
        </span>
      </div>
      <div className="flex gap-2">
        <Button
          id={`${id}-quick-invoice-cancel-button`}
          type="button"
          variant="outline"
          onClick={() => setIsOpen(false)}
          disabled={isSubmitting}
        >
          {t('common.cancel', { ns: 'common', defaultValue: 'Cancel' })}
        </Button>
        <Button
          id={`${id}-quick-invoice-create-button`}
          type="button"
          onClick={() => void handleCreate()}
          disabled={isSubmitting || isLoading || selectedCount === 0}
        >
          {isSubmitting
            ? t('quickInvoice.creating', { defaultValue: 'Creating…' })
            : t('quickInvoice.create', { defaultValue: 'Create invoice' })}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <Button
        id={`${id}-quick-invoice-button`}
        type="button"
        variant="soft"
        size="sm"
        className="flex items-center gap-1.5"
        onClick={() => setIsOpen(true)}
        disabled={disabled || !ticketId}
      >
        <Receipt className="h-3.5 w-3.5" />
        {t('quickInvoice.action', { defaultValue: 'Quick invoice' })}
      </Button>

      <Dialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t('quickInvoice.title', { defaultValue: 'Quick invoice this ticket' })}
        className="max-w-2xl"
        footer={footer}
      >
        <DialogContent>
          {isLoading ? (
            <p className="text-sm text-[rgb(var(--color-text-600))]">
              {t('quickInvoice.loading', { defaultValue: 'Loading billable items…' })}
            </p>
          ) : loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : createdInvoiceId ? (
            <Alert variant="success">
              <AlertDescription>
                {t('quickInvoice.createdDetail', {
                  defaultValue: 'The invoice was created and linked to this ticket.',
                })}
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-6">
              {!hasItems ? (
                <p className="text-sm text-[rgb(var(--color-text-600))]">
                  {t('quickInvoice.empty', {
                    defaultValue: 'There are no unbilled items on this ticket.',
                  })}
                </p>
              ) : null}

              {timeItems.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-800))]">
                    {t('quickInvoice.billableTime', { defaultValue: 'Billable time' })}
                  </h3>
                  <div className="divide-y divide-[rgb(var(--color-border-200))] rounded-md border border-[rgb(var(--color-border-200))]">
                    {timeItems.map((item) => (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2"
                      >
                        <Checkbox
                          id={`quick-invoice-time-${item.id}`}
                          checked={selectedKeys.has(`time:${item.id}`)}
                          onChange={() => toggle(`time:${item.id}`)}
                          skipRegistration
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-[rgb(var(--color-text-900))]">
                            {item.serviceName ||
                              t('quickInvoice.unknownService', { defaultValue: 'Billable time' })}
                          </div>
                          <div className="text-xs text-[rgb(var(--color-text-500))]">
                            {item.entryDate
                              ? new Date(item.entryDate).toLocaleDateString()
                              : null}
                          </div>
                        </div>
                        <div className="whitespace-nowrap text-right text-sm text-[rgb(var(--color-text-700))]">
                          {(item.billableMinutes / 60).toFixed(2)} h ×{' '}
                          {formatCurrency(item.rate / 100, currencyCode)}
                        </div>
                        <div className="w-24 whitespace-nowrap text-right text-sm font-medium text-[rgb(var(--color-text-900))]">
                          {formatCurrency(item.amount / 100, currencyCode)}
                        </div>
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              {materialItems.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-800))]">
                    {t('quickInvoice.products', { defaultValue: 'Products' })}
                  </h3>
                  <div className="divide-y divide-[rgb(var(--color-border-200))] rounded-md border border-[rgb(var(--color-border-200))]">
                    {materialItems.map((item) => (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-center gap-3 px-3 py-2"
                      >
                        <Checkbox
                          id={`quick-invoice-material-${item.id}`}
                          checked={selectedKeys.has(`material:${item.id}`)}
                          onChange={() => toggle(`material:${item.id}`)}
                          skipRegistration
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-[rgb(var(--color-text-900))]">
                            {item.description ||
                              item.serviceName ||
                              t('quickInvoice.unknownService', { defaultValue: 'Product' })}
                          </div>
                          <div className="text-xs text-[rgb(var(--color-text-500))]">
                            {item.quantity} × {formatCurrency(item.rate / 100, currencyCode)}
                          </div>
                        </div>
                        <div className="w-24 whitespace-nowrap text-right text-sm font-medium text-[rgb(var(--color-text-900))]">
                          {formatCurrency(item.amount / 100, currencyCode)}
                        </div>
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              {submitError ? (
                <Alert variant="destructive">
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              ) : null}

              {existingInvoices.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold text-[rgb(var(--color-text-800))]">
                    {t('quickInvoice.existingInvoices', { defaultValue: 'Invoices for this ticket' })}
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {existingInvoices.map((invoice) => (
                      <li key={invoice.invoiceId} className="flex items-center gap-2">
                        <Link
                          href={`/msp/invoices/${invoice.invoiceId}`}
                          className="text-[rgb(var(--color-primary-600))] hover:underline"
                        >
                          {invoice.invoiceNumber}
                        </Link>
                        <span className="text-[rgb(var(--color-text-600))]">
                          {formatCurrency(invoice.totalAmount / 100, invoice.currencyCode)}
                        </span>
                        <span className="text-xs uppercase text-[rgb(var(--color-text-500))]">
                          {invoice.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
