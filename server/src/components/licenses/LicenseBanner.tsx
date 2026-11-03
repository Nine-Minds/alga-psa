'use client';

import React, { useState, useEffect } from 'react';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useRouter } from 'next/navigation';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { getLicenseStatus } from '@/lib/actions/licenseManagementActions';
import type { LicenseStatus } from '@/lib/actions/licenseManagementActions';

/** Dispatched on window after a license change so the banner refetches its status. */
export const LICENSE_STATUS_CHANGED_EVENT = 'license-status-changed';

// LEVERAGE: pattern window-custom-event-notify — cross-component notify via window CustomEvent (also alga:quick-create:created in CreateTicketRouteClient)
export function notifyLicenseStatusChanged(): void {
  window.dispatchEvent(new CustomEvent(LICENSE_STATUS_CHANGED_EVENT));
}

/**
 * Trial / license expiry banner for self-hosted installs.
 *
 * Shown only in self-host mode (license_state row present).
 * Displays trial countdown, upcoming license expiry, or expired state.
 * Shows the Pro subscription lapse: a warning from the moment a cancellation
 * is known until Pro ends, then a "now on the free edition" message after.
 * Links to the in-app License page for renewal.
 *
 * Intentionally uses the server action for licensing status rather than
 * TierContext so it remains accurate regardless of session freshness.
 */
export default function LicenseBanner() {
  const { t } = useTranslation('common');
  const { formatDate } = useFormatters();
  const router = useRouter();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getLicenseStatus()
        .then((result) => {
          if (!cancelled && !isActionPermissionError(result)) {
            setStatus(result);
          }
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(LICENSE_STATUS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(LICENSE_STATUS_CHANGED_EVENT, load);
    };
  }, []);

  if (!status?.selfHostMode || dismissed) return null;

  const { state, daysRemaining, subscription } = status;
  const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const subscriptionEndDate = subscription?.endsAt ? formatDate(subscription.endsAt, dateOptions) : null;
  const nextRetryDate = subscription?.nextRetryAt ? formatDate(subscription.nextRetryAt, dateOptions) : null;

  // Determine whether to show the banner and with what urgency.
  let message: string | null = null;
  let urgency: 'info' | 'warning' | 'error' = 'info';
  // Resubscribe link is only offered for the subscription messages.
  let resubscribeUrl: string | null = null;
  // Payment-failure banner: where to fix the payment method.
  let updatePaymentUrl: string | null = null;

  switch (state) {
    case 'trial':
      if (daysRemaining !== null && daysRemaining <= 7) {
        message = t('licenseBanner.trialExpiresIn', { defaultValue: 'Pro trial expires in {{count}} days. Enter a license key to keep Pro features.', count: daysRemaining });
        urgency = 'warning';
      } else if (daysRemaining !== null) {
        message = t('licenseBanner.trialDaysRemaining', { defaultValue: 'Pro trial active — {{count}} days remaining.', count: daysRemaining });
        urgency = 'info';
      }
      break;
    case 'trial_available':
      // Fresh install, trial not yet used — invite, don't warn.
      message = t('licenseBanner.trialAvailable', { defaultValue: 'Running Essentials features. Start a free 15-day Pro trial to unlock all features.' });
      urgency = 'info';
      break;
    case 'trial_expired':
      message = t('licenseBanner.trialExpired', { defaultValue: 'Pro trial has expired. The install is now running Essentials features.' });
      urgency = 'warning';
      break;
    case 'licensed':
      if (subscription?.phase === 'payment_failed') {
        // Renewal payment failed, Stripe retrying: Pro keeps running. Admin-only
        // (getLicenseStatus returns a permission error to everyone else).
        const retryClause = nextRetryDate
          ? t('licenseBanner.paymentFailed', { defaultValue: "Payment failed — we'll retry on {{date}}. Update your payment method to keep Pro.", date: nextRetryDate })
          : t('licenseBanner.paymentFailedNoRetry', { defaultValue: 'Payment failed. Update your payment method to keep Pro.' });
        // Pro runs to the held token's expiry; without a renewal that is when it ends.
        message = subscriptionEndDate
          ? `${retryClause} ${t('licenseBanner.paymentFailedEndsOn', { defaultValue: 'Pro ends on {{date}} if payment keeps failing.', date: subscriptionEndDate })}`
          : retryClause;
        urgency = 'error';
        updatePaymentUrl = subscription.updatePaymentUrl ?? null;
      } else if (subscription?.phase === 'ending' && subscription.cause === 'payment_failed') {
        // Stripe gave up on the payment; the held token still runs to its expiry.
        message = subscriptionEndDate
          ? t('licenseBanner.paymentFailedEndedEnding', { defaultValue: 'Your Pro subscription ended — payment failed. Pro stays active until {{date}}. Resubscribe to keep Pro.', date: subscriptionEndDate })
          : t('licenseBanner.paymentFailedEndedEndingNoDate', { defaultValue: 'Your Pro subscription ended — payment failed. Resubscribe to keep Pro.' });
        urgency = 'error';
        resubscribeUrl = subscription.resubscribeUrl;
      } else if (subscription?.phase === 'ending') {
        // Cancel known, Pro still running: warn until the lapse.
        message = subscription.cause === 'term'
          ? subscriptionEndDate
            ? t('licenseBanner.termEnds', { defaultValue: 'Your Pro access ends on {{date}}. Renew to keep Pro.', date: subscriptionEndDate })
            : t('licenseBanner.termEndsNoDate', { defaultValue: 'Your Pro term is ending. Renew to keep Pro.' })
          : subscriptionEndDate
            ? t('licenseBanner.subscriptionEnding', { defaultValue: 'Your Pro subscription has been cancelled. Pro ends on {{date}}. Resubscribe to keep Pro.', date: subscriptionEndDate })
            : t('licenseBanner.subscriptionEndingNoDate', { defaultValue: 'Your Pro subscription has been cancelled. Resubscribe to keep Pro.' });
        urgency = daysRemaining !== null && daysRemaining <= 3 ? 'error' : 'warning';
        resubscribeUrl = subscription.resubscribeUrl;
      } else if (daysRemaining !== null && daysRemaining <= 14) {
        message = t('licenseBanner.licenseExpiresIn', { defaultValue: 'License expires in {{count}} days. Renew to avoid service interruption.', count: daysRemaining });
        urgency = daysRemaining <= 3 ? 'error' : 'warning';
      }
      break;
    case 'license_expired':
      if (subscription?.phase === 'lapsed' && subscription.cause === 'payment_failed') {
        message = t('licenseBanner.paymentFailedEnded', { defaultValue: 'Pro ended — payment failed. Your appliance runs Essentials.' });
        urgency = 'error';
        resubscribeUrl = subscription.resubscribeUrl;
      } else if (subscription?.phase === 'lapsed') {
        message = t('licenseBanner.subscriptionLapsed', { defaultValue: "You're now on the free edition. Resubscribe to restore Pro." });
        urgency = 'warning';
        resubscribeUrl = subscription.resubscribeUrl;
      } else {
        message = t('licenseBanner.licenseExpired', { defaultValue: 'License has expired. The install is now running Essentials features.' });
        urgency = 'error';
      }
      break;
    case 'license_wrong_tenant':
      message = t('licenseBanner.licenseWrongTenant', { defaultValue: 'This license was issued for a different appliance and is not valid here. The install is running Essentials features.' });
      urgency = 'error';
      break;
    case 'ce':
      // CE installs: only show if they haven't used their trial yet.
      if (!status.trialUsed) {
        message = t('licenseBanner.trialAvailable', { defaultValue: 'Running Essentials features. Start a free 15-day Pro trial to unlock all features.' });
        urgency = 'info';
      }
      break;
  }

  if (!message) return null;

  return (
    <Alert
      id="license-banner"
      variant={urgency === 'error' ? 'destructive' : urgency}
      className="rounded-none border-x-0 border-t-0 shadow-none"
      aria-label={t('licenseBanner.ariaLabel', { defaultValue: 'License status' })}
    >
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{message}</span>
        <div className="flex flex-shrink-0 items-center gap-3">
          {updatePaymentUrl ? (
            <Button id="license-banner-update-payment-button" variant="link" size="xs" asChild>
              <a href={updatePaymentUrl} target="_blank" rel="noopener noreferrer">
                {t('licenseBanner.updatePaymentMethod', { defaultValue: 'Update payment method' })}
              </a>
            </Button>
          ) : null}
          {resubscribeUrl ? (
            <Button id="license-banner-resubscribe-button" variant="link" size="xs" asChild>
              <a href={resubscribeUrl} target="_blank" rel="noopener noreferrer">
                {t('licenseBanner.resubscribe', { defaultValue: 'Resubscribe' })}
              </a>
            </Button>
          ) : null}
          <Button id="license-banner-manage-button" variant="link" size="xs" onClick={() => router.push('/msp/licenses')}>
            {t('licenseBanner.manageLicense', { defaultValue: 'Manage License' })}
          </Button>
          <Button
            id="license-banner-dismiss-button"
            variant="icon"
            size="xs"
            onClick={() => setDismissed(true)}
            aria-label={t('licenseBanner.dismiss', { defaultValue: 'Dismiss' })}
          >
            ×
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
