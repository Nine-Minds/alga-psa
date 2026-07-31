'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import TimeEntrySettings from '@alga-psa/scheduling/components/settings/time-entry/TimeEntrySettings';

export default function TimeEntrySettingsBody(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('timeEntry.title')}</CardTitle>
        <CardDescription>{t('timeEntry.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <TimeEntrySettings />
      </CardContent>
    </Card>
  );
}
