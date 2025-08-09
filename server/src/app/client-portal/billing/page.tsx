import { FeatureFlagWrapper } from 'server/src/components/FeatureFlagWrapper';
import BillingOverview from 'server/src/components/client-portal/billing/BillingOverview';
import { FeaturePlaceholder } from 'server/src/components/FeaturePlaceholder';

export default function BillingPage() {
  return (
    <FeatureFlagWrapper
      flagKey="billing-enabled"
      fallback={<div className="flex-1 flex"><FeaturePlaceholder /></div>}
    >
      <BillingOverview />
    </FeatureFlagWrapper>
  );
}