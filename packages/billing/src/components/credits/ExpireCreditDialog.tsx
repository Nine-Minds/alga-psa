'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { toast } from 'react-hot-toast';
import type { ICreditTracking } from '@alga-psa/types';
import { expireCredit } from './actions';

interface ExpireCreditDialogProps {
  credit: (ICreditTracking & { client_name?: string }) | null;
  onClose: () => void;
}

export default function ExpireCreditDialog({ credit, onClose }: ExpireCreditDialogProps) {
  const { t } = useTranslation('msp/credits');
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isExpiring, setIsExpiring] = useState(false);

  useEffect(() => {
    if (credit) {
      setReason('');
      setError(null);
    }
  }, [credit]);

  const handleExpire = async () => {
    if (!credit) return;

    setIsExpiring(true);
    setError(null);

    try {
      const result = await expireCredit(credit.credit_id, reason.trim() || undefined);

      if (result.success) {
        toast.success(t('expireDialog.success', { defaultValue: 'Credit expired' }));
        router.refresh();
        onClose();
      } else {
        setError(result.error || t('expireDialog.error', { defaultValue: 'An error occurred while expiring the credit' }));
      }
    } catch {
      setError(t('expireDialog.error', { defaultValue: 'An error occurred while expiring the credit' }));
    } finally {
      setIsExpiring(false);
    }
  };

  return (
    <Dialog isOpen={Boolean(credit)} onClose={onClose}>
      <DialogContent>
        <h2 className="text-xl font-semibold mb-4">
          {t('expireDialog.title', { defaultValue: 'Expire Credit' })}
        </h2>

        {credit && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>
                {t('expireDialog.warning', {
                  amount: formatCurrencyFromMinorUnits(Number(credit.remaining_amount)),
                  defaultValue: 'The client loses the remaining {{amount}}. You can\'t undo this.',
                })}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-[rgb(var(--color-text-500))]">
                {t('expireDialog.creditAmount', { defaultValue: 'Original' })}
              </span>
              <span className="font-medium text-right">{formatCurrencyFromMinorUnits(Number(credit.amount))}</span>
              <span className="text-[rgb(var(--color-text-500))]">
                {t('expireDialog.remainingAmount', { defaultValue: 'Remaining' })}
              </span>
              <span className="font-medium text-right">{formatCurrencyFromMinorUnits(Number(credit.remaining_amount))}</span>
            </div>

            <div>
              <Label className="text-sm font-medium">
                {t('expireDialog.reasonLabel', { defaultValue: 'Reason (optional)' })}
              </Label>
              <TextArea
                id="expire-credit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('expireDialog.reasonPlaceholder', { defaultValue: 'Why are you expiring this credit?' })}
                className="w-full mt-1"
                rows={3}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button id="cancel-expire-credit-button" variant="outline" onClick={onClose}>
            {t('actions.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            id="confirm-expire-credit-button"
            variant="destructive"
            onClick={handleExpire}
            disabled={isExpiring}
          >
            {isExpiring
              ? t('expireDialog.expiring', { defaultValue: 'Expiring...' })
              : t('expireDialog.confirm', { defaultValue: 'Expire Credit' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
