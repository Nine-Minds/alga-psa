'use client';

import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function MicrosoftProviderForm() {
  const { t } = useTranslation('msp/email-providers');

  return (
    <UpgradePrompt
      featureName={t('selector.cards.microsoft.title', { defaultValue: 'Microsoft 365' })}
      pitch={t('microsoftForm.header.description', {
        defaultValue: 'Connect your Microsoft 365 account and configure inbound email processing.',
      })}
      ctaId="upgrade-microsoft-email-provider-button"
    />
  );
}
