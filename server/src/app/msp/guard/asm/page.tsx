import FeatureFlagPageWrapper from 'server/src/components/FeatureFlagPageWrapper';
import AsmManager from 'server/src/components/guard/asm/AsmManager';

export default async function AsmPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="enable_alga_guard_asm">
      <AsmManager />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = "force-dynamic";
