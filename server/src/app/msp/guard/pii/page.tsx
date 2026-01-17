import FeatureFlagPageWrapper from 'server/src/components/FeatureFlagPageWrapper';
import PiiScanner from 'server/src/components/guard/pii/PiiScanner';

export default async function PiiScannerPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="enable_alga_guard_pii">
      <PiiScanner />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = "force-dynamic";
