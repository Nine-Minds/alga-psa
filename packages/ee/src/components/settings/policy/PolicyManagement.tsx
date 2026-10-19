'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function PolicyManagement() {
  const { t } = useTranslation('msp/settings');

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
      <p className="font-semibold text-foreground">{t('policyManagement.bundleLibrary.title')}</p>
      <p>
        {t('policyManagement.bundleLibrary.upgradeDescription')}
      </p>
      <p>
        {t('policyManagement.bundleLibrary.protectionsDescription')}
      </p>
    </div>
  );
}
