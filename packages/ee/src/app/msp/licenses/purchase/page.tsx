/**
 * CE Stub for License Purchase Page
 * In CE builds, this page shows a placeholder
 */

'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import React from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { AlertCircle } from 'lucide-react';

export default function LicensePurchasePage() {
  const { t } = useTranslation('msp/licensing');

  return (
    <div className="container max-w-4xl mx-auto py-8">
      <Card className="p-8 text-center">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-2xl font-bold mb-2">{t('purchaseForm.title')}</h1>
        <p className="text-muted-foreground mb-4">
          {t('purchaseForm.enterpriseOnlyHosted')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('purchasePage.communityEditionDescription')}
        </p>
      </Card>
    </div>
  );
}
