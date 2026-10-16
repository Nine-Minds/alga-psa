'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getIntegrationHealthAlerts,
  type IntegrationHealthAlert,
  type IntegrationHealthReason,
} from '../actions/integrationHealthActions';

/** A failing integration stays failing, so re-poll rather than wait for a reload. */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DISMISS_KEY_PREFIX = 'alga.integrationHealth.dismissed.';

const MESSAGES: Record<IntegrationHealthReason, { key: string; defaultValue: string }> = {
  inbound_email_auth_failure: {
    key: 'banners.integrationHealth.inboundEmail.authFailure',
    defaultValue: 'Inbound email for {{mailbox}} is paused — its credentials no longer work.',
  },
  inbound_email_error: {
    key: 'banners.integrationHealth.inboundEmail.error',
    defaultValue: 'Inbound email for {{mailbox}} reported an error and may not be receiving messages.',
  },
  calendar_error: {
    key: 'banners.integrationHealth.calendar.error',
    defaultValue: 'Calendar sync for {{providerName}} reported an error and is not syncing.',
  },
  calendar_disconnected: {
    key: 'banners.integrationHealth.calendar.disconnected',
    defaultValue: 'Calendar sync for {{providerName}} is disconnected and is not syncing.',
  },
  rmm_sync_error: {
    key: 'banners.integrationHealth.rmm.syncError',
    defaultValue: '{{providerName}} reported a sync error, so device and alert data may be out of date.',
  },
  rmm_reconnect_required: {
    key: 'banners.integrationHealth.rmm.reconnectRequired',
    defaultValue: '{{providerName}} needs to be reconnected — its credentials can no longer be refreshed.',
  },
  accounting_reconnect_required: {
    key: 'banners.integrationHealth.accounting.reconnectRequired',
    defaultValue: '{{providerName}} needs to be reconnected before accounting sync can run again.',
  },
  accounting_sync_error: {
    key: 'banners.integrationHealth.accounting.syncError',
    defaultValue: 'The last {{providerName}} sync did not finish, so invoices and payments may be out of date.',
  },
  teams_bot_credentials_missing: {
    key: 'banners.integrationHealth.teams.botCredentialsMissing',
    defaultValue: 'The {{providerName}} bot cannot reply: its bot connector credentials are not configured on the server.',
  },
};

function dismissStorageKey(alertId: string): string {
  return `${DISMISS_KEY_PREFIX}${alertId}`;
}

/**
 * Tenant- and user-level banner for integrations that have stopped working.
 * The in-card surfaces (email provider card, calendar badges) stay the place to
 * fix things; this is the shell-level "you have a problem" signal that links to
 * them. Dismissals live in sessionStorage, so a still-broken integration comes
 * back in the next session.
 */
export function IntegrationHealthBanner() {
  const { t } = useTranslation('msp/core');
  const [alerts, setAlerts] = useState<IntegrationHealthAlert[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      getIntegrationHealthAlerts()
        .then((data) => {
          if (!cancelled && Array.isArray(data)) {
            setAlerts(data);
          }
        })
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleDismiss = useCallback((alertId: string) => {
    setDismissedIds((prev) => (prev.includes(alertId) ? prev : [...prev, alertId]));
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem(dismissStorageKey(alertId), '1');
    }
  }, []);

  const isDismissed = (alertId: string): boolean => {
    if (dismissedIds.includes(alertId)) return true;
    if (typeof window === 'undefined') return false;
    return window.sessionStorage?.getItem(dismissStorageKey(alertId)) === '1';
  };

  const visibleAlerts = alerts.filter((alert) => !isDismissed(alert.id));

  if (visibleAlerts.length === 0) return null;

  return (
    <div className="mx-3 mt-2 flex flex-col gap-2">
      {visibleAlerts.map((alert) => {
        const message = MESSAGES[alert.reason];

        return (
          <Alert
            key={alert.id}
            id={`integration-health-alert-${alert.id}`}
            variant={alert.severity === 'error' ? 'destructive' : 'warning'}
          >
            <AlertDescription>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-sm">
                  {t(message.key, {
                    defaultValue: message.defaultValue,
                    mailbox: alert.detail,
                    providerName: alert.providerName,
                  })}
                </div>
                <Link href={alert.href} prefetch={false}>
                  <Button
                    id={`integration-health-review-${alert.id}`}
                    size="sm"
                    variant="outline"
                    className="text-xs whitespace-nowrap"
                  >
                    {t('banners.integrationHealth.review', { defaultValue: 'Review' })}
                  </Button>
                </Link>
                <Button
                  id={`integration-health-dismiss-${alert.id}`}
                  variant="icon"
                  size="icon"
                  onClick={() => handleDismiss(alert.id)}
                  aria-label={t('banners.integrationHealth.dismiss', {
                    defaultValue: 'Dismiss integration alert',
                  })}
                  className="flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
