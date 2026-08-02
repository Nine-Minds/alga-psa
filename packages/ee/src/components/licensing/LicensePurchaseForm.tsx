/**
 * CE Stub for License Purchase Form
 * In CE builds, '@ee/components/licensing/LicensePurchaseForm' resolves here
 */
'use client';

import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function LicensePurchaseForm() {
  const { t } = useTranslation('msp/licensing');

  return (
    <UpgradePrompt
      featureName={t('purchaseForm.title', { defaultValue: 'License purchase' })}
      pitch={t('purchaseForm.enterpriseOnlyHosted', {
        defaultValue: 'Purchase and manage additional user licenses with a hosted Alga PSA Pro deployment.',
      })}
      ctaId="upgrade-license-purchase-button"
    >
      <p>
        {t('purchaseForm.communityEditionUnlimited', {
          defaultValue: 'Self-hosted Community Edition has unlimited users at no additional cost.',
        })}
      </p>
    </UpgradePrompt>
  );
}
