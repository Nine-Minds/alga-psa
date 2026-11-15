'use client';

import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** The ended relationship a customer-home settings page shows instead of editors:
 * when it ended, with whom, and where the retained shared work lives. */
export interface CoManagedEndedScreen { side: 'ended'; endedAt: string; counterpartName: string | null }

export function endedScreen(screen: unknown): CoManagedEndedScreen | null {
  return screen && typeof screen === 'object' && (screen as { side?: unknown }).side === 'ended' ? screen as CoManagedEndedScreen : null;
}

export default function CoManagedEndedNotice({ ended, idPrefix }: { ended: CoManagedEndedScreen; idPrefix: string }) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  return <Card id={`${idPrefix}-ended`}>
    <CardContent className="space-y-3 pt-6">
      <p role="status" className="font-medium">
        {t('coManaged.ended.title', { defaultValue: 'Co-managed IT ended {{date}}', date: formatDate(new Date(ended.endedAt), { dateStyle: 'medium' }) })}
      </p>
      <p className="text-sm text-[rgb(var(--color-text-600))]">
        {ended.counterpartName
          ? t('coManaged.ended.descriptionWith', { defaultValue: '{{name}} no longer has access. Shared work history is retained and read-only.', name: ended.counterpartName })
          : t('coManaged.ended.description', { defaultValue: 'Your MSP no longer has access. Shared work history is retained and read-only.' })}
      </p>
    </CardContent>
  </Card>;
}
