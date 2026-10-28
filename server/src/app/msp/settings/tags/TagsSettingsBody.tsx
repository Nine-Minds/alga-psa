'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { TagDisplaySettings } from '@alga-psa/tags/components/TagDisplaySettings';

export default function TagsSettingsBody(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tagDisplay.title', 'Display on chips')}</CardTitle>
        <CardDescription>
          {t('tagDisplay.subtitle', 'Tags shown next to contacts and clients in ticket lists, ticket headers and pickers.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TagDisplaySettings />
      </CardContent>
    </Card>
  );
}
