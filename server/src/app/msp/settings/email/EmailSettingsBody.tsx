'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useProduct } from '@/context/ProductContext';
import { EmailSettings } from '@alga-psa/integrations/email/settings/entry';
import { EmailProviderConfiguration } from '@alga-psa/integrations/components/email/EmailProviderConfiguration';

export default function EmailSettingsBody(): React.JSX.Element {
  const { t } = useTranslation('msp/settings');
  const { productCode } = useProduct();
  const isAlgaDesk = productCode === 'algadesk';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('email.title')}</CardTitle>
        <CardDescription>{t('email.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {isAlgaDesk ? <EmailProviderConfiguration /> : <EmailSettings />}
      </CardContent>
    </Card>
  );
}
