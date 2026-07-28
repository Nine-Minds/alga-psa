'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits, formatDateOnly } from '@alga-psa/core';
import { toast } from 'react-hot-toast';
import type { ICreditTracking } from '@alga-psa/types';
import { updateCreditExpirationDate } from './actions';

interface EditCreditExpirationDialogProps {
  credit: (ICreditTracking & { client_name?: string }) | null;
  onClose: () => void;
}

export default function EditCreditExpirationDialog({ credit, onClose }: EditCreditExpirationDialogProps) {
  const { t } = useTranslation('msp/credits');
  const router = useRouter();
  const [expirationDate, setExpirationDate] = useState<Date | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (credit) {
      setExpirationDate(credit.expiration_date ? new Date(credit.expiration_date) : undefined);
      setError(null);
    }
  }, [credit]);

  const handleSave = async () => {
    if (!credit) return;

    if (expirationDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (expirationDate < today) {
        setError(t('expirationDialog.pastDateError', { defaultValue: 'Expiration date cannot be in the past' }));
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await updateCreditExpirationDate(
        credit.credit_id,
        expirationDate ? expirationDate.toISOString() : null
      );

      if (result.success) {
        toast.success(t('expirationDialog.updateSuccess', { defaultValue: 'Credit expiration updated' }));
        router.refresh();
        onClose();
      } else {
        setError(result.error || t('expirationDialog.updateError', { defaultValue: 'An error occurred while updating the expiration date' }));
      }
    } catch {
      setError(t('expirationDialog.updateError', { defaultValue: 'An error occurred while updating the expiration date' }));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog isOpen={Boolean(credit)} onClose={onClose}>
      <DialogContent>
        <h2 className="text-xl font-semibold mb-4">
          {t('expirationDialog.title', { defaultValue: 'Edit Expiration Date' })}
        </h2>

        {credit && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-[rgb(var(--color-text-500))]">
                {t('expirationDialog.creditAmount', { defaultValue: 'Original' })}
              </span>
              <span className="font-medium text-right">{formatCurrencyFromMinorUnits(Number(credit.amount))}</span>
              <span className="text-[rgb(var(--color-text-500))]">
                {t('expirationDialog.remainingAmount', { defaultValue: 'Remaining' })}
              </span>
              <span className="font-medium text-right">{formatCurrencyFromMinorUnits(Number(credit.remaining_amount))}</span>
              <span className="text-[rgb(var(--color-text-500))]">
                {t('expirationDialog.currentExpiration', { defaultValue: 'Current Expiration' })}
              </span>
              <span className="font-medium text-right">
                {credit.expiration_date
                  ? formatDateOnly(new Date(credit.expiration_date))
                  : t('expirationDialog.noExpiration', { defaultValue: 'No expiration' })}
              </span>
            </div>

            <div>
              <div className="mt-1">
                <DatePicker
                  id="edit-credit-expiration-date"
                  label={t('expirationDialog.newExpirationDate', { defaultValue: 'New Expiration Date' })}
                  placeholder={t('addCredit.placeholders.expirationDate', { defaultValue: 'Select expiration date' })}
                  clearable
                  value={expirationDate}
                  onChange={setExpirationDate}
                  minDate={new Date()}
                />
              </div>
              <p className="text-xs text-[rgb(var(--color-text-500))] mt-1">
                {t('expirationDialog.clearHint', { defaultValue: 'Clear the date to remove the expiration.' })}
              </p>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button id="cancel-edit-credit-button" variant="outline" onClick={onClose}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button id="save-edit-credit-button" onClick={handleSave} disabled={isSaving}>
            {isSaving
              ? t('actions.saving', { defaultValue: 'Saving...' })
              : t('actions.saveChanges', { defaultValue: 'Save Changes' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
