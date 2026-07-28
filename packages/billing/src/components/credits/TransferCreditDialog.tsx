'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits, toMinorUnits } from '@alga-psa/core';
import { toast } from 'react-hot-toast';
import type { IClient } from '@alga-psa/types';
import type { CreditRow } from './CreditsTable';
import { transferCreditToClient } from './actions';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';

interface TransferCreditDialogProps {
  credit: CreditRow | null;
  onClose: () => void;
}

export default function TransferCreditDialog({ credit, onClose }: TransferCreditDialogProps) {
  const { t, i18n } = useTranslation('msp/credits');
  const router = useRouter();
  const [clients, setClients] = useState<IClient[]>([]);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [targetClientId, setTargetClientId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const remaining = credit ? Number(credit.remaining_amount) : 0;

  useEffect(() => {
    if (credit) {
      setTargetClientId(null);
      setAmount((remaining / 100).toString());
      setReason('');
      setError(null);
    }
  }, [credit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    getAllClientsForBilling()
      .then((result) => {
        if (!cancelled) setClients(result);
      })
      .catch((err) => console.error('Failed to load clients for transfer:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTransfer = async () => {
    if (!credit || !targetClientId) {
      setError(t('transferDialog.errors.selectClient', { defaultValue: 'Select a client to transfer to' }));
      return;
    }

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setError(t('transferDialog.errors.validAmount', { defaultValue: 'Enter an amount greater than zero' }));
      return;
    }

    const amountInCents = toMinorUnits(parsed, i18n.language);
    if (amountInCents > remaining) {
      setError(t('transferDialog.errors.exceedsRemaining', {
        amount: formatCurrencyFromMinorUnits(remaining),
        defaultValue: 'The transfer cannot exceed the remaining {{amount}}',
      }));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await transferCreditToClient(
        credit.credit_id,
        targetClientId,
        amountInCents,
        reason.trim() || undefined
      );

      if (result.success) {
        toast.success(t('transferDialog.success', { defaultValue: 'Credit transferred' }));
        router.refresh();
        onClose();
      } else {
        setError(result.error || t('transferDialog.error', { defaultValue: 'An error occurred while transferring the credit' }));
      }
    } catch (err) {
      console.error('Failed to transfer credit:', err);
      setError(t('transferDialog.error', { defaultValue: 'An error occurred while transferring the credit' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  const parsedAmount = parseFloat(amount);
  const newRemaining = isNaN(parsedAmount) ? remaining : remaining - toMinorUnits(parsedAmount, i18n.language);

  return (
    <Dialog isOpen={Boolean(credit)} onClose={onClose}>
      <DialogContent>
        <h2 className="text-xl font-semibold mb-2">
          {t('transferDialog.title', { defaultValue: 'Transfer Credit' })}
        </h2>
        <p className="text-sm text-[rgb(var(--color-text-500))] mb-4">
          {t('transferDialog.description', { defaultValue: 'Move credit from this client to another.' })}
        </p>

        {credit && (
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">
                {t('transferDialog.fields.targetClient', { defaultValue: 'To Client' })}{' '}
                <span className="text-[rgb(var(--color-destructive-500))]">*</span>
              </Label>
              <div className="mt-1">
                <ClientPicker
                  id="transfer-credit-client-picker"
                  clients={clients}
                  selectedClientId={targetClientId}
                  onSelect={setTargetClientId}
                  filterState={filterState}
                  onFilterStateChange={setFilterState}
                  disabledClientIds={new Set([credit.client_id])}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="transfer-credit-amount" className="text-sm font-medium">
                {t('transferDialog.fields.amount', { defaultValue: 'Amount' })}{' '}
                <span className="text-[rgb(var(--color-destructive-500))]">*</span>
              </Label>
              <Input
                id="transfer-credit-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1"
              />
              <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                {t('transferDialog.hints.amount', {
                  amount: formatCurrencyFromMinorUnits(remaining),
                  defaultValue: 'Up to {{amount}} available',
                })}
              </p>
            </div>

            <div>
              <Label className="text-sm font-medium">
                {t('transferDialog.fields.reason', { defaultValue: 'Reason (optional)' })}
              </Label>
              <TextArea
                id="transfer-credit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('transferDialog.placeholders.reason', { defaultValue: 'Why is this credit being transferred?' })}
                className="w-full mt-1"
                rows={2}
              />
            </div>

            <div className="bg-[rgb(var(--color-background-100))] p-4 rounded-md">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <span className="text-[rgb(var(--color-text-500))]">
                  {t('transferDialog.impact.current', { defaultValue: 'Current Remaining' })}:
                </span>
                <span className="font-medium text-right">{formatCurrencyFromMinorUnits(remaining)}</span>
                <span className="text-[rgb(var(--color-text-500))]">
                  {t('transferDialog.impact.after', { defaultValue: 'Remaining After Transfer' })}:
                </span>
                <span className="font-medium text-right">{formatCurrencyFromMinorUnits(Math.max(0, newRemaining))}</span>
              </div>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button id="cancel-transfer-credit-button" variant="outline" onClick={onClose}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="confirm-transfer-credit-button"
            onClick={handleTransfer}
            disabled={isSubmitting || !targetClientId || !amount}
          >
            {isSubmitting
              ? t('transferDialog.transferring', { defaultValue: 'Transferring...' })
              : t('transferDialog.confirm', { defaultValue: 'Transfer Credit' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
