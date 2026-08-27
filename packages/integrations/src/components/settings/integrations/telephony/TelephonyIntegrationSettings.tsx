'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Phone } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getTelephonyOverview,
  setTelephonyAutoTicketPolicy,
  setTelephonyProviderEnabled,
} from '../../../../actions/integrations/telephonyActions';
import type { TelephonyOverview } from '../../../../actions/integrations/telephonyActions';
import { TelephonyPaywallCard } from './TelephonyPaywallCard';

const PROVIDER_LABELS: Record<string, string> = {
  'teams-phone': 'Teams Phone',
};

export function TelephonyIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const [overview, setOverview] = useState<TelephonyOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getTelephonyOverview();
      setOverview(next);
      setError(next.available ? null : next.error ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const providers = overview?.providers ?? [];
  const canManage = Boolean(overview?.canManage);

  const statusBadge = useMemo(() => (status: string) => {
    if (status === 'active') {
      return <Badge variant="success">{t('integrations.telephony.status.active', { defaultValue: 'Active' })}</Badge>;
    }
    if (status === 'error') {
      return <Badge variant="error">{t('integrations.telephony.status.error', { defaultValue: 'Error' })}</Badge>;
    }
    if (status === 'disabled') {
      return <Badge variant="secondary">{t('integrations.telephony.status.disabled', { defaultValue: 'Disabled' })}</Badge>;
    }
    return <Badge variant="secondary">{t('integrations.telephony.status.notConfigured', { defaultValue: 'Not configured' })}</Badge>;
  }, [t]);

  const toggleProvider = async (provider: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await setTelephonyProviderEnabled({ provider, enabled });
      if (!result.success) {
        setError(result.error ?? null);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoTicket = async (provider: string, autoCreateTickets: boolean) => {
    setBusy(true);
    try {
      await setTelephonyAutoTicketPolicy({ provider, autoCreateTickets });
      await load();
    } finally {
      setBusy(false);
    }
  };

  // An authorization refusal carries no entitlement reason. Telling someone who
  // may not see the call log to go buy an add-on would be the wrong answer.
  if (overview && !overview.success) {
    return (
      <Card id="telephony-forbidden-card">
        <CardHeader>
          <CardTitle>{t('integrations.telephony.paywall.title', { defaultValue: 'Telephony' })}</CardTitle>
          <CardDescription id="telephony-forbidden-message">
            {t('integrations.telephony.forbidden', {
              defaultValue: 'You do not have permission to view telephony settings for this tenant.',
            })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (overview && !overview.available) {
    return <TelephonyPaywallCard reason={overview.reason} message={overview.error} />;
  }

  return (
    <div className="space-y-6" id="telephony-integrations-setup">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => (
          <Card
            key={provider.provider}
            className="relative overflow-hidden transition-shadow hover:shadow-md"
            id={`telephony-provider-card-${provider.provider}`}
          >
            <CardHeader className="space-y-4 pb-3">
              <div className="relative flex h-24 w-full items-center justify-center rounded-lg bg-muted/40">
                <div className="absolute right-3 top-3">{statusBadge(provider.status)}</div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-white shadow-sm ring-1 ring-border">
                  <Phone className="h-5 w-5" />
                </div>
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">
                  {PROVIDER_LABELS[provider.provider] ?? provider.provider}
                </CardTitle>
                <CardDescription className="text-sm">
                  {t('integrations.telephony.providers.teamsPhone.description', {
                    defaultValue: 'Journal Teams Phone calls as interactions once each call ends. Call history, not live screen pop.',
                  })}
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 pt-0 text-xs text-muted-foreground">
              {!provider.prerequisiteMet && (
                <p id={`telephony-provider-prerequisite-${provider.provider}`}>
                  {t('integrations.telephony.providers.teamsPhone.prerequisite', {
                    defaultValue: 'Configure the Microsoft Teams integration first — Teams Phone reuses its Microsoft profile.',
                  })}
                </p>
              )}
              {provider.subscriptionExpiresAt && (
                <p>
                  {t('integrations.telephony.subscriptionExpires', { defaultValue: 'Subscription renews before' })}{' '}
                  {new Date(provider.subscriptionExpiresAt).toLocaleString()}
                </p>
              )}
              {provider.lastNotificationAt && (
                <p id={`telephony-provider-last-notification-${provider.provider}`}>
                  {t('integrations.telephony.lastNotification', { defaultValue: 'Last call notification' })}{' '}
                  {new Date(provider.lastNotificationAt).toLocaleString()}
                </p>
              )}
              {provider.lastError && (
                <p className="text-[rgb(var(--color-accent-600))]" id={`telephony-provider-error-${provider.provider}`}>
                  {provider.lastError}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-2">
                <span className="font-medium text-foreground/80">
                  {t('integrations.telephony.autoTicket', { defaultValue: 'Create a ticket automatically for matched calls' })}
                </span>
                <Switch
                  id={`telephony-auto-ticket-toggle-${provider.provider}`}
                  checked={provider.autoCreateTickets}
                  disabled={!canManage || busy || provider.status !== 'active'}
                  onCheckedChange={(checked) => void toggleAutoTicket(provider.provider, checked)}
                />
              </div>
            </CardContent>

            <CardFooter className="pt-0">
              <Button
                className="w-full"
                variant={provider.status === 'active' ? 'outline' : 'default'}
                disabled={!canManage || busy || (!provider.prerequisiteMet && provider.status !== 'active')}
                onClick={() => void toggleProvider(provider.provider, provider.status !== 'active')}
                id={`telephony-provider-toggle-${provider.provider}`}
              >
                {provider.status === 'active'
                  ? t('integrations.telephony.actions.disable', { defaultValue: 'Disable' })
                  : t('integrations.telephony.actions.enable', { defaultValue: 'Enable' })}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {error && (
        <p className="text-sm text-[rgb(var(--color-accent-600))]" id="telephony-error-message">
          {error}
        </p>
      )}
    </div>
  );
}

export default TelephonyIntegrationSettings;
