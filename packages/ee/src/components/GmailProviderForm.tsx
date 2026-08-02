'use client';

import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function GmailProviderForm() {
  const { t } = useTranslation('msp/email-providers');

  return (
    <UpgradePrompt
      featureName={t('selector.cards.google.title', { defaultValue: 'Gmail' })}
      pitch={t('gmailForm.header.description', {
        defaultValue: 'Connect your Gmail account and configure inbound email processing.',
      })}
      ctaId="upgrade-gmail-email-provider-button"
    />
  );
}
