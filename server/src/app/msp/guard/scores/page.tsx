import FeatureFlagPageWrapper from 'server/src/components/FeatureFlagPageWrapper';
import SecurityScores from 'server/src/components/guard/scores/SecurityScores';

export default async function ScoresPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="enable_alga_guard_score">
      <SecurityScores />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = "force-dynamic";
