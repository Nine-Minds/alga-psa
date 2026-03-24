import type { Metadata } from 'next';
import QuoteDocumentTemplatesPage from '@alga-psa/billing/components/billing-dashboard/quotes/QuoteDocumentTemplatesPage';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export const metadata: Metadata = {
  title: 'Quote Layouts',
};

export default function QuoteDocumentTemplatesRoute() {
  return (
    <FeatureFlagPageWrapper featureFlag="quoting-enabled">
      <QuoteDocumentTemplatesPage />
    </FeatureFlagPageWrapper>
  );
}

export const dynamic = 'force-dynamic';
