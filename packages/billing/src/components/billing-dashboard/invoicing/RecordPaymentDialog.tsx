'use client';

import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { formatCurrencyFromMinorUnits, fromMinorUnits, toMinorUnits } from '@alga-psa/core';
import {
  getInvoicePaymentSummary,
  recordManualInvoicePayment,
  MANUAL_PAYMENT_METHODS,
  type InvoicePaymentSummary,
  type ManualPaymentMethod,
} from '@alga-psa/billing/actions/invoicePaymentActions';

interface RecordPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string | null;
  invoiceNumber?: string;
  onSuccess?: () => void;
}

const METHOD_LABEL_DEFAULTS: Record<ManualPaymentMethod, string> = {
  manual: 'Manual',
  check: 'Check',
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  other: 'Other',
};

/** Local calendar day as yyyy-mm-dd, so "today" is the operator's today. */
function toCalendarDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export const RecordPaymentDialog: React.FC<RecordPaymentDialogProps> = ({
  isOpen,
  onClose,
  invoiceId,
  invoiceNumber,
  onSuccess,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const { locale } = useFormatters();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<InvoicePaymentSummary | null>(null);
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [paymentDate, setPaymentDate] = useState<Date>(() => new Date());
  const [method, setMethod] = useState<ManualPaymentMethod>('manual');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!isOpen || !invoiceId) return;
    let cancelled = false;

    setLoading(true);
    setError(null);
    setSummary(null);
    setAmount(undefined);
    setPaymentDate(new Date());
    setMethod('manual');
    setReference('');
    setNotes('');

    void (async () => {
      try {
        const result = await getInvoicePaymentSummary(invoiceId);
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          return;
        }
        setSummary(result);
        setAmount(fromMinorUnits(Math.max(result.balanceDue, 0), locale, result.currencyCode));
      } catch (loadError) {
        if (cancelled) return;
        setError(getErrorMessage(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, invoiceId, locale]);

  const currencyCode = summary?.currencyCode ?? 'USD';
  const amountMinorUnits = amount === undefined || Number.isNaN(amount)
    ? 0
    : toMinorUnits(amount, locale, currencyCode);
  const canSubmit = Boolean(invoiceId) && !loading && !saving && amountMinorUnits > 0 && Boolean(summary?.canRecordPayment);

  const methodOptions = MANUAL_PAYMENT_METHODS.map((value) => ({
    value,
    label: t(`recordPayment.methods.${value}`, { defaultValue: METHOD_LABEL_DEFAULTS[value] }),
  }));

  const handleSubmit = async () => {
    if (!invoiceId || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const result = await recordManualInvoicePayment({
        invoiceId,
        amount: amountMinorUnits,
        method,
        paymentDate: toCalendarDate(paymentDate),
        referenceNumber: reference.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      toast.success(t('recordPayment.toasts.recorded', {
        defaultValue: 'Payment recorded',
      }));
      onSuccess?.();
      onClose();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={invoiceNumber
        ? t('recordPayment.titleForInvoice', {
          defaultValue: 'Record Payment — {{invoiceNumber}}',
          invoiceNumber,
        })
        : t('recordPayment.title', { defaultValue: 'Record Payment' })}
      id="record-payment-dialog"
      className="max-w-lg"
      footer={(
        <div className="flex justify-end space-x-2">
          <Button
            id="record-payment-cancel"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            {t('recordPayment.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="record-payment-submit"
            onClick={() => { void handleSubmit(); }}
            disabled={!canSubmit}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('recordPayment.actions.record', { defaultValue: 'Record Payment' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        {loading ? (
          <div className="py-10 flex items-center justify-center">
            <LoadingIndicator
              text={t('recordPayment.loading', { defaultValue: 'Loading invoice balance...' })}
              spinnerProps={{ size: 'md' }}
              layout="stacked"
              textClassName="text-muted-foreground"
            />
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {summary && (
              <div className="rounded-lg bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('recordPayment.summary.balanceDue', { defaultValue: 'Balance due' })}
                  </span>
                  <span className="font-medium" id="record-payment-balance-due">
                    {formatCurrencyFromMinorUnits(summary.balanceDue, locale, summary.currencyCode)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    {t('recordPayment.summary.alreadyPaid', { defaultValue: 'Already paid' })}
                  </span>
                  <span id="record-payment-already-paid">
                    {formatCurrencyFromMinorUnits(summary.totalPaid, locale, summary.currencyCode)}
                  </span>
                </div>
              </div>
            )}

            <CurrencyInput
              id="record-payment-amount"
              label={t('recordPayment.fields.amount', { defaultValue: 'Amount' })}
              value={amount}
              onChange={setAmount}
              currencyCode={currencyCode}
              disabled={saving || !summary?.canRecordPayment}
              required
            />

            <DatePicker
              id="record-payment-date"
              label={t('recordPayment.fields.paymentDate', { defaultValue: 'Payment date' })}
              value={paymentDate}
              onChange={(date: Date) => setPaymentDate(date)}
              disabled={saving || !summary?.canRecordPayment}
            />

            <div className="space-y-1">
              <label htmlFor="record-payment-method" className="block text-sm font-medium">
                {t('recordPayment.fields.method', { defaultValue: 'Payment method' })}
              </label>
              <CustomSelect
                id="record-payment-method"
                value={method}
                onValueChange={(value: string) => setMethod(value as ManualPaymentMethod)}
                options={methodOptions}
                disabled={saving || !summary?.canRecordPayment}
              />
            </div>

            <Input
              id="record-payment-reference"
              label={t('recordPayment.fields.reference', { defaultValue: 'Reference' })}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder={t('recordPayment.placeholders.reference', { defaultValue: 'Check or transaction number' })}
              disabled={saving || !summary?.canRecordPayment}
            />

            <TextArea
              id="record-payment-notes"
              label={t('recordPayment.fields.notes', { defaultValue: 'Notes' })}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              disabled={saving || !summary?.canRecordPayment}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RecordPaymentDialog;
