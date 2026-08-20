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
import { voidHourBlock } from '@alga-psa/billing/actions/hourBlockActions';

interface VoidHourBlockDialogProps {
  block: IHourBlock | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function VoidHourBlockDialog({ block, onClose, onChanged }: VoidHourBlockDialogProps) {
  const { t } = useTranslation('msp/hour-blocks');

  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!block) return;
    if (!reason.trim()) {
      setError(t('void.reasonRequired', { defaultValue: 'A reason is required.' }));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await voidHourBlock(block.block_id, reason.trim());
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      toast.success(t('void.voided', { defaultValue: 'Hour block voided.' }));
      setReason('');
      onChanged();
      onClose();
    } catch (err) {
      console.error('Failed to void hour block:', err);
      setError(t('void.error', { defaultValue: 'Could not void the hour block.' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={Boolean(block)}
      onClose={onClose}
      title={t('void.title', { defaultValue: 'Void hour block' })}
      id="void-hour-block-dialog"
      data-automation-id="void-hour-block-dialog"
    >
      <DialogContent>
        <div className="space-y-4">
          <p className="text-sm text-[rgb(var(--color-text-900))]">
            {t('void.confirm', { defaultValue: 'Void this block? It cannot be undone.' })}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="hb-void-reason">{t('void.reasonLabel', { defaultValue: 'Reason' })}</Label>
            <TextArea id="hb-void-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder={t('void.reasonPlaceholder', { defaultValue: 'Required' })} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" id="hb-cancel" onClick={onClose}>{t('actions.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button id="hb-void-submit" variant="destructive" onClick={handleSubmit} disabled={submitting}>
            {t('void.submit', { defaultValue: 'Void block' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
