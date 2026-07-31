import SystemMonitoringWrapper from '@alga-psa/ui/components/system-monitoring/SystemMonitoringWrapper';
import EmailLogsClient from './EmailLogsClient';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { getEmailLogMetrics, getEmailLogs } from '@alga-psa/email/actions';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Email Logs',
};

export const dynamic = 'force-dynamic';

export default async function EmailLogsPage() {
  const { t } = await getServerTranslation(undefined, 'common');
  let initialLogs: Awaited<ReturnType<typeof getEmailLogs>> | undefined;
  let initialMetrics: Awaited<ReturnType<typeof getEmailLogMetrics>> | undefined;

  try {
    [initialLogs, initialMetrics] = await Promise.all([
      getEmailLogs({ page: 1, pageSize: 50, sortBy: 'sent_at', sortDirection: 'desc' }),
      getEmailLogMetrics(),
    ]);
  } catch (error) {
    console.error('Failed to preload email logs:', error);
  }

  return (
    <SystemMonitoringWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">{t('pages.titles.emailLogs')}</h1>
          <p className="text-[rgb(var(--color-text-600))] mt-2">
            Review outbound email activity and troubleshoot notification delivery.
          </p>
        </div>

        <EmailLogsClient initialLogs={initialLogs} initialMetrics={initialMetrics} />
      </div>
    </SystemMonitoringWrapper>
  );
}
