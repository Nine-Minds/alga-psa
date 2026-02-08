import SystemMonitoringWrapper from '@alga-psa/ui/components/system-monitoring/SystemMonitoringWrapper';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';
import EmailLogsClient from './EmailLogsClient';

export const dynamic = 'force-dynamic';

export default async function EmailLogsPage() {
  return (
    <SystemMonitoringWrapper>
      <FeatureFlagPageWrapper featureFlag="email-logs">
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-[rgb(var(--color-text-900))]">Email Logs</h1>
            <p className="text-[rgb(var(--color-text-600))] mt-2">
              Review outbound email activity and troubleshoot notification delivery.
            </p>
          </div>

          <EmailLogsClient />
        </div>
      </FeatureFlagPageWrapper>
    </SystemMonitoringWrapper>
  );
}
