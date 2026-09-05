'use client';

import React from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function TelephonyUnavailableCard({ reason, message }: { reason?: string; message?: string | null }) {
  const { t } = useTranslation('msp/integrations');

  return (
    <Card id={reason === 'ce_unavailable' ? 'telephony-ce-card' : 'telephony-unavailable-card'}>
      <CardHeader>
        <CardTitle>{t('integrations.telephony.paywall.title', { defaultValue: 'Telephony' })}</CardTitle>
        <CardDescription>
          {message ?? t('integrations.telephony.paywall.unavailable', {
            defaultValue: 'Telephony integrations are not available for this tenant.',
          })}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
