'use client';

import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import type { IHourBlock } from '@alga-psa/types';
import { updateHourBlockExpiration } from '@alga-psa/billing/actions/hourBlockActions';

interface EditExpirationDialogProps {
  block: IHourBlock | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function EditExpirationDialog({ block, onClose, onChanged }: EditExpirationDialogProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [value, setValue] = useState<Date | undefined>(block?.expiration_date ? new Date(block.expiration_date) : undefined);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset when a different block opens the dialog.
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  if (block && block.block_id !== syncedKey) {
    setSyncedKey(block.block_id);
    setValue(block.expiration_date ? new Date(block.expiration_date) : undefined);
    setError(null);
  }

  const handleSubmit = async () => {
    if (!block) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await updateHourBlockExpiration(block.block_id, value ? value.toISOString() : null);
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      toast.success(t('expiration.saved', { defaultValue: 'Expiration updated.' }));
      onChanged();
      onClose();
    } catch (err) {
      console.error('Failed to update hour block expiration:', err);
      setError(t('expiration.error', { defaultValue: 'Could not update the expiration.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={Boolean(block)}
      onClose={onClose}
      title={t('expiration.title', { defaultValue: 'Edit expiration' })}
      id="edit-hour-block-expiration-dialog"
      data-automation-id="edit-hour-block-expiration-dialog"
    >
      <DialogContent>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hb-expiration-value">{t('expiration.label', { defaultValue: 'Expiration date' })}</Label>
            <DatePicker
              id="hb-expiration-value"
              clearable
              value={value}
              onChange={setValue}
            />
            {value == null && (
              <p className="text-xs text-[rgb(var(--color-text-500))]">{t('expiration.clear', { defaultValue: 'No expiration' })}</p>
            )}
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" id="hb-cancel" onClick={onClose}>{t('actions.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button id="hb-expiration-submit" onClick={handleSubmit} disabled={submitting}>
            {t('expiration.submit', { defaultValue: 'Save expiration' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
