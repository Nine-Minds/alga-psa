import type { Metadata } from 'next';
import QuoteApprovalDashboard from '@alga-psa/billing/components/billing-dashboard/quotes/QuoteApprovalDashboard';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export const metadata: Metadata = {
  title: 'Quote Approvals',
};

export default function QuoteApprovalsPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="quoting-enabled">
      <QuoteApprovalDashboard />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = 'force-dynamic';
