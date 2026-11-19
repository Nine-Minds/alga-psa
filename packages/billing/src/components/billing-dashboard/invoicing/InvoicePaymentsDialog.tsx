'use client';

/**
 * The payments recorded against one invoice, and the only place a payment can
 * be taken back.
 *
 * Reversing is deliberately not one button: a cheque the MSP keyed here is
 * theirs to undo, a payment that came from QuickBooks/Xero belongs to the
 * accounting system (the row says so, and says what to do there), and gateway
 * money can only go back as a refund. The "in AlgaPSA only" escape hatch for a
 * synced payment is explicit, warned about, and offered only to a user who
 * holds the accounting remote-mutate capability.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { useAccountingCapabilities } from '@alga-psa/auth/hooks/useAccountingCapabilities';
import {
  listInvoicePayments,
  reverseInvoicePayment,
  type InvoicePaymentListRow,
} from '@alga-psa/billing/actions/invoicePaymentActions';

interface InvoicePaymentsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId: string | null;
  invoiceNumber?: string;
  currencyCode?: string;
  /** Called after a reversal commits so the parent can refresh its list. */
  onChanged?: () => void;
}

const SOURCE_LABEL_DEFAULTS: Record<InvoicePaymentListRow['source'], string> = {
  manual: 'Recorded in AlgaPSA',
  quickbooks: 'QuickBooks',
  xero: 'Xero',
  gateway: 'Payment provider',
};

export const InvoicePaymentsDialog: React.FC<InvoicePaymentsDialogProps> = ({
  isOpen,
  onClose,
  invoiceId,
  invoiceNumber,
  currencyCode = 'USD',
  onChanged,
}) => {
  const { t } = useTranslation('msp/invoicing');
  const { locale, formatCalendarDate } = useFormatters();
  const capabilities = useAccountingCapabilities();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<InvoicePaymentListRow[]>([]);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [algaOnly, setAlgaOnly] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await listInvoicePayments(invoiceId);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        setPayments([]);
        return;
      }
      setPayments(result);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    if (!isOpen || !invoiceId) return;
    setReversingId(null);
    setReason('');
    setAlgaOnly(false);
    void load();
  }, [isOpen, invoiceId, load]);

  const sourceLabel = (row: InvoicePaymentListRow) =>
    t(`invoicePayments.sources.${row.source}`, { defaultValue: SOURCE_LABEL_DEFAULTS[row.source] });

  const handleReverse = async (row: InvoicePaymentListRow) => {
    if (!reason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await reverseInvoicePayment({
        paymentId: row.paymentId,
        reason: reason.trim(),
        algaOnly: row.requiresAlgaOnly ? algaOnly : undefined,
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      toast.success(t('invoicePayments.toasts.reversed', { defaultValue: 'Payment reversed' }));
      setReversingId(null);
      setReason('');
      setAlgaOnly(false);
      await load();
      onChanged?.();
    } catch (reverseError) {
      setError(getErrorMessage(reverseError));
    } finally {
      setSaving(false);
    }
  };

  const renderRowActions = (row: InvoicePaymentListRow) => {
    if (row.blockedReason === 'gateway_refund_required') {
      return (
        <p className="text-xs text-muted-foreground" id={`invoice-payments-gateway-note-${row.paymentId}`}>
          {t('invoicePayments.notes.gatewayRefund', {
            defaultValue: 'Taken through a payment provider ({{method}}): refund it there instead.',
            method: row.method ?? '',
          })}
        </p>
      );
    }
    if (row.blockedReason === 'already_reversed') {
      return (
        <p className="text-xs text-muted-foreground" id={`invoice-payments-reversed-note-${row.paymentId}`}>
          {t('invoicePayments.notes.alreadyReversed', { defaultValue: 'Already reversed.' })}
        </p>
      );
    }
    if (!row.canReverse) {
      return null;
    }

    // A synced payment can only be unlinked by someone who may change what the
    // accounting system is told; everyone else gets the instruction instead.
    if (row.requiresAlgaOnly && !capabilities.remoteMutate) {
      return (
        <p className="text-xs text-muted-foreground" id={`invoice-payments-provider-note-${row.paymentId}`}>
          {t('invoicePayments.notes.providerOwned', {
            defaultValue: 'This payment came from {{provider}} payment {{reference}}. Delete or edit it there and the next sync will reverse it here.',
            provider: sourceLabel(row),
            reference: row.externalReference ?? '',
          })}
        </p>
      );
    }

    if (reversingId !== row.paymentId) {
      return (
        <Button
          id={`invoice-payments-reverse-${row.paymentId}`}
          variant="outline"
          size="sm"
          onClick={() => {
            setReversingId(row.paymentId);
            setReason('');
            setAlgaOnly(false);
            setError(null);
          }}
        >
          {t('invoicePayments.actions.reverse', { defaultValue: 'Reverse payment' })}
        </Button>
      );
    }

    return (
      <div className="space-y-2 pt-2">
        {row.requiresAlgaOnly && (
          <Alert variant="warning" id={`invoice-payments-provider-warning-${row.paymentId}`}>
            <AlertDescription className="text-xs">
              <div className="space-y-2">
                <p>
                  {t('invoicePayments.notes.providerOwned', {
                    defaultValue: 'This payment came from {{provider}} payment {{reference}}. Delete or edit it there and the next sync will reverse it here.',
                    provider: sourceLabel(row),
                    reference: row.externalReference ?? '',
                  })}
                </p>
                <Checkbox
                  id={`invoice-payments-alga-only-${row.paymentId}`}
                  checked={algaOnly}
                  onChange={(event) => setAlgaOnly(event.target.checked)}
                  disabled={saving}
                  label={t('invoicePayments.actions.algaOnly', {
                    defaultValue: 'Reverse in AlgaPSA only',
                  })}
                />
                <p>
                  {t('invoicePayments.notes.algaOnlyWarning', {
                    defaultValue: 'AlgaPSA and {{provider}} will disagree about this payment: the {{provider}} record is left exactly as it is and the payment is unlinked here.',
                    provider: sourceLabel(row),
                  })}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        <TextArea
          id={`invoice-payments-reason-${row.paymentId}`}
          label={t('invoicePayments.fields.reason', { defaultValue: 'Reason' })}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          disabled={saving}
        />

        <div className="flex justify-end gap-2">
          <Button
            id={`invoice-payments-cancel-reverse-${row.paymentId}`}
            variant="outline"
            size="sm"
            onClick={() => {
              setReversingId(null);
              setReason('');
              setAlgaOnly(false);
            }}
            disabled={saving}
          >
            {t('invoicePayments.actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id={`invoice-payments-confirm-reverse-${row.paymentId}`}
            variant="destructive"
            size="sm"
            onClick={() => { void handleReverse(row); }}
            disabled={saving || !reason.trim() || (row.requiresAlgaOnly && !algaOnly)}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {t('invoicePayments.actions.confirmReverse', { defaultValue: 'Reverse payment' })}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={invoiceNumber
        ? t('invoicePayments.titleForInvoice', {
          defaultValue: 'Payments — {{invoiceNumber}}',
          invoiceNumber,
        })
        : t('invoicePayments.title', { defaultValue: 'Payments' })}
      id="invoice-payments-dialog"
      className="max-w-2xl"
      footer={(
        <div className="flex justify-end">
          <Button id="invoice-payments-close" variant="outline" onClick={onClose} disabled={saving}>
            {t('invoicePayments.actions.close', { defaultValue: 'Close' })}
          </Button>
        </div>
      )}
    >
      <DialogContent>
        {loading ? (
          <div className="py-10 flex items-center justify-center">
            <LoadingIndicator
              text={t('invoicePayments.loading', { defaultValue: 'Loading payments...' })}
              spinnerProps={{ size: 'md' }}
              layout="stacked"
              textClassName="text-muted-foreground"
            />
          </div>
        ) : (
          <div className="space-y-3">
            {error && (
              <Alert variant="destructive" id="invoice-payments-error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground" id="invoice-payments-empty">
                {t('invoicePayments.empty', { defaultValue: 'No payments have been recorded for this invoice.' })}
              </p>
            ) : (
              <ul className="divide-y divide-border" id="invoice-payments-list">
                {payments.map((row) => (
                  <li key={row.paymentId} className="py-3 space-y-1" id={`invoice-payments-row-${row.paymentId}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-sm">
                        <div className="font-medium">
                          {formatCurrencyFromMinorUnits(row.amount, locale, currencyCode)}
                        </div>
                        <div className="text-muted-foreground">
                          {[
                            // A payment is booked on a DAY: formatting the
                            // stored instant in the viewer's timezone would
                            // show the day before west of UTC.
                            row.paymentDate ? formatCalendarDate(row.paymentDate) : null,
                            row.method,
                            row.referenceNumber,
                          ].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <Badge variant={row.reversed ? 'secondary' : 'default-muted'}>
                        {sourceLabel(row)}
                      </Badge>
                    </div>
                    {renderRowActions(row)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default InvoicePaymentsDialog;
