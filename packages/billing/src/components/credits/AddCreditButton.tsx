'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionMessageError, isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { toMinorUnits } from '@alga-psa/core';
import type { IClient } from '@alga-psa/types';
import { createPrepaymentInvoice } from '@alga-psa/billing/actions/creditActions';
import { finalizeInvoice } from '@alga-psa/billing/actions/invoiceModification';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';

export default function AddCreditButton() {
  const { t, i18n } = useTranslation('msp/credits');
  const router = useRouter();

  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState(false);
  const [clients, setClients] = useState<IClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [expirationDate, setExpirationDate] = useState<Date | undefined>(undefined);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAddCreditModalOpen || clients.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await getAllClientsForBilling();
        if (cancelled) return;
        if (isActionMessageError(result) || isActionPermissionError(result)) {
          setError(getErrorMessage(result));
          return;
        }
        setClients(result);
      } catch (loadError) {
        console.error('Error loading clients for Add Credit dialog:', loadError);
        if (!cancelled) {
          setError(t('addCredit.errors.loadClientsFailed', {
            defaultValue: 'Failed to load clients. Please try again.',
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAddCreditModalOpen, clients.length, t]);

  const resetForm = () => {
    setSelectedClient(null);
    setAmount('');
    setExpirationDate(undefined);
    setError(null);
  };

  const handleClose = () => {
    setIsAddCreditModalOpen(false);
    resetForm();
  };

  const handleAddCredit = async () => {
    if (!selectedClient || !amount) {
      setError(t('addCredit.errors.allFieldsRequired', {
        defaultValue: 'Please select a client and enter an amount',
      }));
      return;
    }

    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      setError(t('addCredit.errors.validAmount', { defaultValue: 'Please enter a valid amount' }));
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      // The ledger stores minor units (cents); the form takes major units.
      const amountInCents = toMinorUnits(numericAmount, i18n.language);

      const invoice = await createPrepaymentInvoice(
        selectedClient,
        amountInCents,
        expirationDate ? expirationDate.toISOString() : undefined,
      );
      if (isActionMessageError(invoice) || isActionPermissionError(invoice)) {
        setError(getErrorMessage(invoice));
        return;
      }

      // Credit only becomes available once the prepayment invoice is finalized.
      const finalizeResult = await finalizeInvoice(invoice.invoice_id);
      if (isActionMessageError(finalizeResult) || isActionPermissionError(finalizeResult)) {
        setError(getErrorMessage(finalizeResult));
        return;
      }

      toast.success(t('addCredit.success', { defaultValue: 'Credit added successfully' }));
      handleClose();
      router.refresh();
    } catch (submitError) {
      console.error('Error adding credit:', submitError);
      setError(t('addCredit.errors.submitFailed', {
        defaultValue: 'Failed to add credit. Please try again.',
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        id="add-credit-button"
        variant="default"
        onClick={() => setIsAddCreditModalOpen(true)}
      >
        {t('actions.addCredit', { defaultValue: 'Add Credit' })}
      </Button>

      <Dialog
        isOpen={isAddCreditModalOpen}
        onClose={handleClose}
        title={t('actions.addCredit', { defaultValue: 'Add Credit' })}
      >
        <DialogContent>
          <div className="py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('addCredit.description', {
                defaultValue: 'Issues a prepayment invoice and finalizes it, making the credit immediately available to the client.',
              })}
            </p>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div>
              <Label className="text-sm font-medium">
                {t('addCredit.fields.client', { defaultValue: 'Client' })}{' '}
                <span className="text-[rgb(var(--color-destructive-500))]">*</span>
              </Label>
              <div className="mt-1">
                <ClientPicker
                  id="add-credit-client-picker"
                  clients={clients}
                  selectedClientId={selectedClient}
                  onSelect={setSelectedClient}
                  filterState={filterState}
                  onFilterStateChange={setFilterState}
                  clientTypeFilter={clientTypeFilter}
                  onClientTypeFilterChange={setClientTypeFilter}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="add-credit-amount" className="text-sm font-medium">
                {t('addCredit.fields.amount', { defaultValue: 'Amount' })}{' '}
                <span className="text-[rgb(var(--color-destructive-500))]">*</span>
              </Label>
              <Input
                id="add-credit-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t('addCredit.placeholders.amount', { defaultValue: 'Enter amount' })}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-sm font-medium">
                {t('addCredit.fields.expirationDate', { defaultValue: 'Expiration Date (optional)' })}
              </Label>
              <div className="mt-1">
                <DatePicker
                  id="add-credit-expiration-date"
                  label={t('addCredit.fields.expirationDate', { defaultValue: 'Expiration Date (optional)' })}
                  placeholder={t('addCredit.placeholders.expirationDate', { defaultValue: 'Select expiration date' })}
                  clearable
                  value={expirationDate}
                  onChange={setExpirationDate}
                  minDate={new Date()}
                />
              </div>
              <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                {t('addCredit.hints.expirationDate', {
                  defaultValue: 'Leave blank to use the credit expiration settings for this client.',
                })}
              </p>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="cancel-add-credit-button"
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="submit-add-credit-button"
            onClick={handleAddCredit}
            disabled={isSubmitting || !selectedClient || !amount}
          >
            {isSubmitting
              ? t('addCredit.submitting', { defaultValue: 'Adding...' })
              : t('actions.addCredit', { defaultValue: 'Add Credit' })}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
