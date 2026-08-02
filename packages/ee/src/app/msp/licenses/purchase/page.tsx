/**
 * CE Stub for License Purchase Page
 * In CE builds, this page shows a placeholder
 */

import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export default async function LicensePurchasePage() {
  const { t } = await getServerTranslation(undefined, 'msp/licensing');

  return (
    <div className="container max-w-4xl mx-auto py-8">
      <UpgradePrompt
        featureName={t('purchaseForm.title', { defaultValue: 'License purchase' })}
        pitch={t('purchaseForm.enterpriseOnlyHosted', {
          defaultValue: 'Purchase and manage additional user licenses with a hosted Enterprise deployment.',
        })}
        ctaId="upgrade-license-purchase-page-button"
      >
        <p>
          {t('purchaseForm.communityEditionUnlimited', {
            defaultValue: 'Self-hosted Community Edition has unlimited users at no additional cost.',
          })}
        </p>
      </UpgradePrompt>
    </div>
  );
}
