'use client';

import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import type { IHourBlock } from '@alga-psa/types';
import { manuallyExpireHourBlock } from '@alga-psa/billing/actions/hourBlockActions';

interface ManuallyExpireHourBlockDialogProps {
  block: IHourBlock | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function ManuallyExpireHourBlockDialog({ block, onClose, onChanged }: ManuallyExpireHourBlockDialogProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!block) return;
    if (!reason.trim()) {
      setError(t('expire.reasonRequired', { defaultValue: 'A reason is required.' }));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await manuallyExpireHourBlock(block.block_id, reason.trim());
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      toast.success(t('expire.expired', { defaultValue: 'Hour block expired.' }));
      setReason('');
      onChanged();
      onClose();
    } catch (err) {
      console.error('Failed to expire hour block:', err);
      setError(t('expire.error', { defaultValue: 'Could not expire the hour block.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={Boolean(block)}
      onClose={onClose}
      title={t('expire.title', { defaultValue: 'Expire hour block' })}
      id="expire-hour-block-dialog"
      data-automation-id="expire-hour-block-dialog"
    >
      <DialogContent>
        <div className="space-y-4">
          {block && (
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('expire.remaining', { hours: (Number(block.remaining_minutes) / 60).toFixed(1), defaultValue: '{{hours}} hrs unused will be lost.' })}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="hb-expire-reason">{t('expire.reasonLabel', { defaultValue: 'Reason' })}</Label>
            <TextArea id="hb-expire-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t('expire.reasonPlaceholder', { defaultValue: 'Required' })} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" id="hb-cancel" onClick={onClose}>{t('actions.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button id="hb-expire-submit" variant="destructive" onClick={handleSubmit} disabled={submitting}>
            {t('expire.submit', { defaultValue: 'Expire block' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
