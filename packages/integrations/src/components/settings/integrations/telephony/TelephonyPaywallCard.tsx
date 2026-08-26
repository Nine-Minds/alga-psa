'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { CheckCircle2, ExternalLink } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ADD_ONS } from '@alga-psa/types';
import { getAddOnDestination } from '../../../../lib/addOnNavigation';

// Telephony ships inside the Microsoft Teams add-on, so the upsell points there.
const TELEPHONY_ADDON_DESTINATION = getAddOnDestination(ADD_ONS.TEAMS);

const INCLUDED_FEATURES = [
  { key: 'recognition', defaultValue: 'Caller recognition against contacts and clients on every captured call.' },
  { key: 'history', defaultValue: 'Call history on the contact and client timeline as first-class interactions.' },
  { key: 'tickets', defaultValue: 'Create a ticket from a call, or link the call to a ticket you are already working.' },
  { key: 'queue', defaultValue: 'A queue for unmatched and ambiguous numbers so no call is attributed by guesswork.' },
  { key: 'providers', defaultValue: 'Teams Phone today; the same call core is what future providers plug into.' },
] as const;

export function TelephonyPaywallCard({ reason, message }: { reason?: string; message?: string | null }) {
  const { t } = useTranslation('msp/integrations');

  if (reason === 'ce_unavailable') {
    return (
      <Card id="telephony-ce-card">
        <CardHeader>
          <CardTitle>{t('integrations.telephony.paywall.title', { defaultValue: 'Telephony' })}</CardTitle>
          <CardDescription>
            {message ?? t('integrations.telephony.paywall.ceOnly', { defaultValue: 'Telephony integrations are only available in Enterprise Edition.' })}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card id="telephony-paywall-card">
      <CardHeader>
        <CardTitle>{t('integrations.telephony.paywall.title', { defaultValue: 'Microsoft Teams add-on' })}</CardTitle>
        <CardDescription>
          {t('integrations.telephony.paywall.description', {
            defaultValue: 'Telephony integrations require the Microsoft Teams add-on for this tenant.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">
            {t('integrations.telephony.paywall.includedTitle', { defaultValue: "What's included" })}
          </div>
          <ul className="space-y-2">
            {INCLUDED_FEATURES.map((feature) => (
              <li key={feature.key} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{t(`integrations.telephony.paywall.feature.${feature.key}`, { defaultValue: feature.defaultValue })}</span>
              </li>
            ))}
          </ul>
        </div>

        <Button id="telephony-paywall-purchase" asChild>
          <Link href={TELEPHONY_ADDON_DESTINATION}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('integrations.telephony.paywall.cta', { defaultValue: 'Manage add-ons' })}
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
