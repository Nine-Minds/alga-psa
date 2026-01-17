import FeatureFlagPageWrapper from 'server/src/components/FeatureFlagPageWrapper';
import GuardReports from 'server/src/components/guard/reports/GuardReports';

export default async function ReportsPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="enable_alga_guard">
      <GuardReports />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = "force-dynamic";
