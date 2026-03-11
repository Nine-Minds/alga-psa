'use client';

import { KnowledgeBasePage } from '@alga-psa/documents/components';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export default function KBReviewPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="knowledge-base">
      <KnowledgeBasePage activeTab="review" />
    </FeatureFlagPageWrapper>
  );
}
