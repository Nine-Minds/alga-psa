/**
 * CE Stub for License Purchase Form
 * In CE builds, '@ee/components/licensing/LicensePurchaseForm' resolves here
 */
'use client';

import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { AlertCircle } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function LicensePurchaseForm() {
  const { t } = useTranslation('msp/licensing');

  return (
    <Card className="p-8 text-center">
      <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      <h2 className="text-xl font-semibold mb-2">
        {t('purchaseForm.title', { defaultValue: 'License Purchase' })}
      </h2>
      <p className="text-muted-foreground mb-4">
        {t('purchaseForm.enterpriseOnlyHosted', {
          defaultValue: 'License purchasing is available in the Enterprise Edition for hosted deployments.'
        })}
      </p>
      <p className="text-sm text-muted-foreground">
        {t('purchaseForm.communityEditionUnlimited', {
          defaultValue: 'Self-hosted Community Edition has unlimited users at no additional cost.'
        })}
      </p>
    </Card>
  );
}
