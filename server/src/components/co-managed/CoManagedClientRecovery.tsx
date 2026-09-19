'use client';

import { useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { retryCoManagedProvisioningAction, cancelCoManagedProvisioningAction } from '@enterprise/lib/actions/coManagedProvisioningActions';

/** Recovery controls for a client setup that is queued, provisioning, failed,
 * pending acceptance, or awaiting acknowledged cleanup. Retrying reuses the
 * original operation ID, so an uncertain response cannot start a second setup. */
export default function CoManagedClientRecovery({ operationId, state, canRetry, canCancel, invitationExpired, deliveryFailed, idPrefix, onChanged }: {
  operationId: string;
  state: string;
  canRetry: boolean;
  canCancel: boolean;
  invitationExpired: boolean;
  deliveryFailed: boolean;
  idPrefix: string;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<{ enqueued: boolean }>) => {
    setBusy(true); setError(null);
    try {
      const result = await action();
      if (!result.enqueued) setError(t('coManaged.provisioning.workerUnavailable', { defaultValue: 'The provisioning worker is unavailable. Try again.' }));
      await onChanged();
    } catch { setError(t('coManaged.provisioning.retryError', { defaultValue: 'Could not recover this setup. Try again.' })); }
    finally { setBusy(false); }
  };
  const retryLabel = state === 'cleanup_requested' ? t('coManaged.provisioning.retryCleanup', { defaultValue: 'Retry cleanup' })
    : invitationExpired ? t('coManaged.provisioning.resendInvitation', { defaultValue: 'Resend invitation' })
      : t('coManaged.provisioning.retry', { defaultValue: 'Retry' });
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {deliveryFailed && <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.provisioning.deliveryFailed', { defaultValue: 'The administrator invitation could not be delivered.' })}</p>}
      <div className="flex flex-wrap gap-2">
        {canRetry && (
          <Button id={`${idPrefix}-retry`} variant="outline" size="sm" disabled={busy}
            onClick={() => void run(() => retryCoManagedProvisioningAction(operationId))}>
            {retryLabel}
          </Button>
        )}
        {canCancel && (
          <Button id={`${idPrefix}-cancel`} variant="outline" size="sm" disabled={busy}
            onClick={() => void run(() => cancelCoManagedProvisioningAction(operationId))}>
            {t('coManaged.provisioning.cancelSetup', { defaultValue: 'Cancel setup' })}
          </Button>
        )}
      </div>
    </div>
  );
}
