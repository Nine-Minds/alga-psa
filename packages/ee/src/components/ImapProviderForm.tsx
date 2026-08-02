'use client';

import { UpgradePrompt } from '@alga-psa/ui/components/UpgradePrompt';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function ImapProviderForm() {
  const { t } = useTranslation('msp/email-providers');

  return (
    <UpgradePrompt
      featureName={t('selector.cards.imap.title', { defaultValue: 'IMAP' })}
      pitch={t('selector.cards.imap.description', {
        defaultValue: 'Connect any compatible mailbox through a custom IMAP server.',
      })}
      ctaId="upgrade-imap-email-provider-button"
    />
  );
}
