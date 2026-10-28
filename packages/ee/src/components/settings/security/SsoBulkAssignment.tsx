'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export default function SsoBulkAssignment() {
  const { t } = useTranslation('msp/settings');

  return (
    <div className="space-y-4 rounded-lg border border-dashed border-muted-foreground/40 p-6 text-sm text-muted-foreground">
      <p className="font-semibold text-foreground">{t('ssoBulk.proFeature.title')}</p>
      <p>
        {t('ssoBulk.proFeature.description')}
      </p>
    </div>
  );
}
