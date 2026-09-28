'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { TelephonyProviderCard } from '../../../../actions/integrations/telephonyActions';
import { TelephonyStatusBadge } from './TelephonyStatusBadge';

interface TeamsPhoneIntegrationSettingsProps {
  provider: TelephonyProviderCard;
  canManage: boolean;
  busy: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onToggleAutoTicket: (autoCreateTickets: boolean) => void;
}

/**
 * The Teams Phone settings page. Teams Phone has no configuration of its own —
 * it reuses the Microsoft profile of the Teams integration — so the panel is
 * the subscription state, the auto-ticket policy and the on/off switch.
 */
export function TeamsPhoneIntegrationSettings({
  provider,
  canManage,
  busy,
  onToggleEnabled,
  onToggleAutoTicket,
}: TeamsPhoneIntegrationSettingsProps) {
  const { t } = useTranslation('msp/integrations');
  const isActive = provider.status === 'active';

  return (
    <div className="space-y-6" id="teams-phone-integration-settings">
      <Card id="teams-phone-overview-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>
                {t('integrations.telephony.providers.teamsPhone.label', { defaultValue: 'Teams Phone' })}
              </CardTitle>
              <CardDescription>
                {t('integrations.telephony.providers.teamsPhone.description', {
                  defaultValue:
                    'Journal Teams Phone calls as interactions once each call ends. Call history, not live screen pop.',
                })}
              </CardDescription>
            </div>
            <TelephonyStatusBadge status={provider.status} />
          </div>
        </CardHeader>

        <CardContent className="space-y-3 text-sm text-muted-foreground">
          {!provider.prerequisiteMet && (
            <p id="telephony-provider-prerequisite-teams-phone">
              {t('integrations.telephony.providers.teamsPhone.prerequisite', {
                defaultValue:
                  'Configure the Microsoft Teams integration first — Teams Phone reuses its Microsoft profile.',
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
            <p id="telephony-provider-last-notification-teams-phone">
              {t('integrations.telephony.lastNotification', { defaultValue: 'Last call notification' })}{' '}
              {new Date(provider.lastNotificationAt).toLocaleString()}
            </p>
          )}
          {provider.lastError && (
            <p className="text-[rgb(var(--color-accent-600))]" id="telephony-provider-error-teams-phone">
              {provider.lastError}
            </p>
          )}
          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="font-medium text-foreground/80">
              {t('integrations.telephony.autoTicket', { defaultValue: 'Create a ticket automatically for matched calls' })}
            </span>
            <Switch
              id="telephony-auto-ticket-toggle-teams-phone"
              checked={provider.autoCreateTickets}
              disabled={!canManage || busy || !isActive}
              onCheckedChange={(checked) => onToggleAutoTicket(checked)}
            />
          </div>
        </CardContent>

        <CardFooter>
          <Button
            id="telephony-provider-toggle-teams-phone"
            className="w-full"
            variant={isActive ? 'outline' : 'default'}
            disabled={!canManage || busy || (!provider.prerequisiteMet && !isActive)}
            onClick={() => onToggleEnabled(!isActive)}
          >
            {isActive
              ? t('integrations.telephony.actions.disable', { defaultValue: 'Disable' })
              : t('integrations.telephony.actions.enable', { defaultValue: 'Enable' })}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default TeamsPhoneIntegrationSettings;
