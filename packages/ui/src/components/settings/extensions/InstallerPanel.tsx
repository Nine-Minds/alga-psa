'use client';

import React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * OSS Stub Panel
 * - This feature is only available in the Enterprise edition.
 * - EE build provides a fully featured installer panel under the EE codebase.
 */
export default function InstallerPanel() {
  const { t } = useTranslation('msp/extensions');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('installer.pro.title')}</CardTitle>
        <CardDescription>
          {t('installer.pro.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center text-center py-10 space-y-3">
          <div className="text-lg font-medium text-gray-900">{t('installer.pro.featureTitle')}</div>
          <p className="text-sm text-gray-600">
            {t('installer.pro.help')}
          </p>
          <div className="pt-2">
            <Button id="extensions-enterprise-cta" variant="secondary" disabled>
              {t('installer.pro.actions.learnMore')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
