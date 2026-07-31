'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useRouter } from 'next/navigation';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getLicenseStatus } from '@/lib/actions/licenseManagementActions';
import type { LicenseStatus } from '@/lib/actions/licenseManagementActions';

/**
 * Trial / license expiry banner for self-hosted installs.
 *
 * Shown only in self-host mode (license_state row present).
 * Displays trial countdown, upcoming license expiry, or expired state.
 * Links to the in-app License page for renewal.
 *
 * Intentionally uses the server action for licensing status rather than
 * TierContext so it remains accurate regardless of session freshness.
 */
export default function LicenseBanner() {
  const { t } = useTranslation('common');
  const router = useRouter();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    getLicenseStatus()
      .then((result) => {
        if (!isActionPermissionError(result)) {
          setStatus(result);
        }
      })
      .catch(() => {});
  }, []);

  if (!status?.selfHostMode || dismissed) return null;

  const { state, daysRemaining, tier } = status;

  // Determine whether to show the banner and with what urgency.
  let message: string | null = null;
  let urgency: 'info' | 'warning' | 'error' = 'info';

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
      if (daysRemaining !== null && daysRemaining <= 14) {
        message = t('licenseBanner.licenseExpiresIn', { defaultValue: 'License expires in {{count}} days. Renew to avoid service interruption.', count: daysRemaining });
        urgency = daysRemaining <= 3 ? 'error' : 'warning';
      }
      break;
    case 'license_expired':
      message = 'License has expired. The install is now running Essentials features.';
      urgency = 'error';
      break;
    case 'license_wrong_tenant':
      message = 'This license was issued for a different appliance and is not valid here. The install is running Essentials features.';
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

  const bgColor = urgency === 'error' ? '#fef2f2' : urgency === 'warning' ? '#fffbeb' : '#eff6ff';
  const borderColor = urgency === 'error' ? '#fecaca' : urgency === 'warning' ? '#fde68a' : '#bfdbfe';
  const textColor = urgency === 'error' ? '#991b1b' : urgency === 'warning' ? '#92400e' : '#1e40af';

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.5rem 1rem', background: bgColor,
        borderBottom: `1px solid ${borderColor}`, color: textColor,
        fontSize: '0.875rem',
      }}
      role="banner"
      aria-label="License status"
    >
      <span>{message}</span>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0, marginLeft: '1rem' }}>
        <button
          onClick={() => router.push('/msp/licenses')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', color: 'inherit', fontSize: 'inherit' }}
        >
          Manage License
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '1rem', lineHeight: 1 }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
