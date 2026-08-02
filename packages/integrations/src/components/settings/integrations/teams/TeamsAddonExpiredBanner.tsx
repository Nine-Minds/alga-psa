'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ADD_ONS } from '@alga-psa/types';
import { getAddOnDestination } from '../../../../lib/addOnNavigation';

const TEAMS_ADDON_DESTINATION = getAddOnDestination(ADD_ONS.TEAMS);

export function TeamsAddonExpiredBanner() {
  const { t } = useTranslation('msp/integrations');

  return (
    <Alert id="teams-addon-expired-banner" variant="warning">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>
        {t('integrations.teams.settings.addonExpiredBanner.title', { defaultValue: 'Microsoft Teams add-on expired' })}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {t('integrations.teams.settings.addonExpiredBanner.message', {
            defaultValue:
              'The Microsoft Teams add-on has expired. Your configuration and delivery history are preserved, but Teams notifications are being skipped until the add-on is renewed.',
          })}
        </p>
        <Button id="teams-addon-expired-renew" asChild size="sm">
          <Link href={TEAMS_ADDON_DESTINATION}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('integrations.teams.settings.addonExpiredBanner.cta', { defaultValue: 'Renew Teams add-on' })}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
