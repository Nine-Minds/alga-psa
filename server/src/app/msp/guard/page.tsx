import FeatureFlagPageWrapper from 'server/src/components/FeatureFlagPageWrapper';
import GuardDashboard from 'server/src/components/guard/dashboard/GuardDashboard';

export default async function GuardPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="enable_alga_guard">
      <GuardDashboard />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = "force-dynamic";
