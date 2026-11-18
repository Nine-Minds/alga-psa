'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function ConnectSsoWrapper() {
  const { t } = useTranslation('msp/profile');

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
      <p className="font-semibold text-foreground">{t('profile.tabs.sso')}</p>
      <p>
        {t('connectSso.proFeature.description')}
      </p>
    </div>
  );
}
