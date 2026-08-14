'use client';

import { useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import type { IHourBlock } from '@alga-psa/types';
import { adjustHourBlockRemaining } from '@alga-psa/billing/actions/hourBlockActions';

interface AdjustHourBlockDialogProps {
  block: IHourBlock | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function AdjustHourBlockDialog({ block, onClose, onChanged }: AdjustHourBlockDialogProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [deltaHours, setDeltaHours] = useState<string>('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentRemainingHours = block ? Number(block.remaining_minutes) / 60 : 0;

  const handleSubmit = async () => {
    if (!block) return;
    const deltaMinutes = Math.round(Number(deltaHours) * 60);
    if (!Number.isFinite(deltaMinutes) || deltaMinutes === 0) {
      setError(t('adjust.deltaRequired', { defaultValue: 'Enter a non-zero change in hours.' }));
      return;
    }
    if (!reason.trim()) {
      setError(t('adjust.reasonRequired', { defaultValue: 'A reason is required.' }));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await adjustHourBlockRemaining(block.block_id, deltaMinutes, reason.trim());
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      toast.success(t('adjust.adjusted', { defaultValue: 'Hour block adjusted.' }));
      setDeltaHours('');
      setReason('');
      onChanged();
      onClose();
    } catch (err) {
      console.error('Failed to adjust hour block:', err);
      setError(t('adjust.error', { defaultValue: 'Could not adjust the hour block.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={Boolean(block)}
      onClose={onClose}
      title={t('adjust.title', { defaultValue: 'Adjust remaining hours' })}
      id="adjust-hour-block-dialog"
      data-automation-id="adjust-hour-block-dialog"
    >
      <DialogContent>
        <div className="space-y-4">
          {block && (
            <p className="text-sm text-[rgb(var(--color-text-500))]">
              {t('adjust.currentRemaining', { hours: currentRemainingHours.toFixed(1), defaultValue: 'Currently {{hours}} hrs remaining' })}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="hb-adjust-delta">{t('adjust.deltaLabel', { defaultValue: 'Change in hours (positive adds, negative removes)' })}</Label>
            <Input id="hb-adjust-delta" type="number" step="0.5" value={deltaHours} onChange={(e) => setDeltaHours(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hb-adjust-reason">{t('adjust.reasonLabel', { defaultValue: 'Reason' })}</Label>
            <TextArea id="hb-adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t('adjust.reasonPlaceholder', { defaultValue: 'Required' })} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" id="hb-cancel" onClick={onClose}>{t('actions.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button id="hb-adjust-submit" onClick={handleSubmit} disabled={submitting}>
            {t('adjust.submit', { defaultValue: 'Adjust' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
