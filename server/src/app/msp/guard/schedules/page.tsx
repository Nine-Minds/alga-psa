import FeatureFlagPageWrapper from 'server/src/components/FeatureFlagPageWrapper';
import GuardSchedules from 'server/src/components/guard/schedules/GuardSchedules';

export default async function SchedulesPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="enable_alga_guard">
      <GuardSchedules />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = "force-dynamic";
