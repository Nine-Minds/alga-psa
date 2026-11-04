'use client';

import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

/** What the customer workspace shell shows above its pages. The server decides
 * `ended` (and reads nothing for psa or algadesk); this only renders it. */
export type CoManagedWorkspaceNoticeState = { kind: 'ended'; endedAt: string; sponsorName: string | null } | null;

export default function CoManagedWorkspaceNotice({ notice }: { notice: CoManagedWorkspaceNoticeState }) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  if (!notice) return null;
  return (
    <Alert id="co-managed-workspace-notice" variant="info">
      <AlertDescription>
        {t('coManaged.ended.title', { defaultValue: 'Co-managed IT ended {{date}}', date: formatDate(new Date(notice.endedAt), { dateStyle: 'medium' }) })}
        {' '}
        {notice.sponsorName
          ? t('coManaged.ended.descriptionWith', { defaultValue: '{{name}} no longer has access. Shared work history is retained and read-only.', name: notice.sponsorName })
          : t('coManaged.ended.description', { defaultValue: 'Your MSP no longer has access. Shared work history is retained and read-only.' })}
      </AlertDescription>
    </Alert>
  );
}
