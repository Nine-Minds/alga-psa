'use client';

import { useState } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { retryCoManagedProvisioningAction, resendCoManagedAdministratorInvitationAction, cancelCoManagedProvisioningAction } from '@enterprise/lib/actions/coManagedProvisioningActions';

/** Recovery controls for a client setup that is queued, provisioning, failed,
 * pending acceptance, or awaiting acknowledged cleanup. Retrying reuses the
 * original operation ID, so an uncertain response cannot start a second setup.
 * A setup waiting on the customer can resend its administrator invitation once. */
export default function CoManagedClientRecovery({ operationId, state, canRetry, canCancel, invitationSent = false, invitationExpired, deliveryFailed, idPrefix, onChanged }: {
  operationId: string;
  state: string;
  canRetry: boolean;
  canCancel: boolean;
  /** The administrator invitation was delivered; retrying resends it. */
  invitationSent?: boolean;
  invitationExpired: boolean;
  deliveryFailed: boolean;
  idPrefix: string;
  onChanged: () => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/licensing');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const run = async (action: () => Promise<{ enqueued: boolean } | { rejected: true; errorCode: string }>, failure: string) => {
    setBusy(true); setError(null);
    try {
      const result = await action();
      if ('rejected' in result) setError(failure);
      else if (!result.enqueued) setError(t('coManaged.provisioning.workerUnavailable', { defaultValue: 'The provisioning worker is unavailable. Try again.' }));
      await onChanged();
    } catch { setError(failure); }
    finally { setBusy(false); }
  };
  const retry = () => run(() => retryCoManagedProvisioningAction(operationId),
    t('coManaged.provisioning.retryError', { defaultValue: 'Could not recover this setup. Try again.' }));
  const cancel = async () => {
    await run(() => cancelCoManagedProvisioningAction(operationId), t('coManaged.provisioning.cancelError',
      { defaultValue: 'Setup could not be cancelled. Refresh to check whether the customer has already accepted the relationship.' }));
    setConfirmingCancel(false);
  };
  const resend = () => run(() => resendCoManagedAdministratorInvitationAction(operationId),
    t('coManaged.provisioning.resendError', { defaultValue: 'The invitation could not be resent. It can be resent once; check the administrator email and try again later.' }));
  const awaitingCustomer = state === 'pending_acceptance';
  const retryLabel = state === 'cleanup_requested' ? t('coManaged.provisioning.retryCleanup', { defaultValue: 'Retry cleanup' })
    : t('coManaged.provisioning.retry', { defaultValue: 'Retry' });
  return (
    <div className="space-y-2">
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {deliveryFailed && <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.provisioning.deliveryFailed', { defaultValue: 'The administrator invitation could not be delivered.' })}</p>}
      <div className="flex flex-wrap gap-2">
        {canRetry && !awaitingCustomer && (
          <Button id={`${idPrefix}-retry`} variant="outline" size="sm" disabled={busy}
            onClick={() => void retry()}>
            {retryLabel}
          </Button>
        )}
        {canRetry && awaitingCustomer && (invitationSent || invitationExpired || deliveryFailed) && (
          <Button id={`${idPrefix}-resend`} variant="outline" size="sm" disabled={busy}
            onClick={() => void resend()}>
            {t('coManaged.provisioning.resendInvitation', { defaultValue: 'Resend administrator invitation' })}
          </Button>
        )}
        {canCancel && (
          <Button id={`${idPrefix}-cancel`} variant="outline" size="sm" disabled={busy}
            onClick={() => setConfirmingCancel(true)}>
            {t('coManaged.provisioning.cancelSetup', { defaultValue: 'Cancel setup' })}
          </Button>
        )}
      </div>
      {/* Cancelling deletes the unactivated workspace, including an administrator who already signed up. */}
      <Dialog id={`${idPrefix}-cancel-confirm`} isOpen={confirmingCancel} onClose={() => { if (!busy) setConfirmingCancel(false); }}
        title={t('coManaged.provisioning.cancelTitle', { defaultValue: 'Cancel workspace setup?' })}>
        <div className="space-y-4">
          <p>{t('coManaged.provisioning.cancelDescription')}</p>
          <div className="flex gap-2">
            <Button id={`${idPrefix}-cancel-confirm-button`} disabled={busy} onClick={() => void cancel()}>
              {t('coManaged.provisioning.confirmCancel')}
            </Button>
            <Button id={`${idPrefix}-cancel-keep`} variant="outline" disabled={busy} onClick={() => setConfirmingCancel(false)}>
              {t('coManaged.provisioning.keepSetup')}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
