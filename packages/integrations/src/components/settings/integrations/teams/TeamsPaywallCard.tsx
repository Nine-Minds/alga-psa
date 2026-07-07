'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getTeamsAddonPurchaseAccess } from '../../../../actions';

// Deep link to Account Management, where billing admins purchase add-ons.
const TEAMS_ADDON_PURCHASE_URL = '/msp/account';

const INCLUDED_FEATURES = [
  { key: 'tab', defaultValue: 'Personal tab: open Alga PSA inside Microsoft Teams.' },
  { key: 'bot', defaultValue: 'Personal and group-chat bot for tickets, approvals, time, and notes.' },
  { key: 'messageExtension', defaultValue: 'Message extension and quick actions to act on PSA records from any message.' },
  { key: 'meetings', defaultValue: 'Teams meetings on appointment approvals with real Outlook/Teams calendar invites.' },
  { key: 'recordings', defaultValue: 'Automatic capture of meeting recordings and transcripts onto interactions.' },
  { key: 'notifications', defaultValue: 'Activity-feed and bot-DM notifications for assignments, replies, approvals, and SLA risk.' },
] as const;

export function TeamsPaywallCard() {
  const { t } = useTranslation('msp/integrations');
  const [canPurchase, setCanPurchase] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await getTeamsAddonPurchaseAccess();
        if (!cancelled) {
          setCanPurchase(Boolean(result?.canPurchase));
        }
      } catch {
        if (!cancelled) {
          setCanPurchase(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card id="teams-paywall-card">
      <CardHeader>
        <CardTitle>{t('integrations.teams.settings.paywall.title', { defaultValue: 'Microsoft Teams add-on' })}</CardTitle>
        <CardDescription>
          {t('integrations.teams.settings.paywall.description', { defaultValue: 'The Microsoft Teams integration requires the Teams add-on for this tenant.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">
            {t('integrations.teams.settings.paywall.includedTitle', { defaultValue: "What's included" })}
          </div>
          <ul className="space-y-2">
            {INCLUDED_FEATURES.map((feature) => (
              <li key={feature.key} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{t(`integrations.teams.settings.paywall.feature.${feature.key}`, { defaultValue: feature.defaultValue })}</span>
              </li>
            ))}
          </ul>
        </div>

        {canPurchase ? (
          <Button id="teams-paywall-purchase" asChild>
            <a href={TEAMS_ADDON_PURCHASE_URL}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('integrations.teams.settings.paywall.cta', { defaultValue: 'Purchase Teams add-on' })}
            </a>
          </Button>
        ) : (
          <p id="teams-paywall-non-billing" className="text-sm text-muted-foreground">
            {t('integrations.teams.settings.paywall.nonBilling', { defaultValue: 'Contact a billing administrator to purchase the Teams add-on for this tenant.' })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
