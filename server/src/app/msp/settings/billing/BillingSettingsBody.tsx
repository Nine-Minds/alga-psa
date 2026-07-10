'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import BillingSettings from '@alga-psa/billing/components/settings/billing/BillingSettings';

export default function BillingSettingsBody(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billing.title')}</CardTitle>
        <CardDescription>{t('billing.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <BillingSettings />
      </CardContent>
    </Card>
  );
}
