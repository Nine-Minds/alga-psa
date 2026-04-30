import SystemMonitoringWrapper from '@alga-psa/ui/components/system-monitoring/SystemMonitoringWrapper';
import EmailLogsClient from './EmailLogsClient';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Email Logs',
};

export const dynamic = 'force-dynamic';

export default async function EmailLogsPage() {
  const { t } = await getServerTranslation(undefined, 'common');
  return (
    <SystemMonitoringWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('pages.titles.emailLogs')}</h1>
          <p className="text-[rgb(var(--color-text-600))] mt-2">
            Review outbound email activity and troubleshoot notification delivery.
          </p>
        </div>

        <EmailLogsClient />
      </div>
    </SystemMonitoringWrapper>
  );
}
