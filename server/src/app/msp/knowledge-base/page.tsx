'use client';

import { KnowledgeBasePage } from '@alga-psa/documents/components';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export default function KBArticlesPage() {
  return (
    <FeatureFlagPageWrapper featureFlag="knowledge-base">
      <KnowledgeBasePage activeTab="articles" />
    </FeatureFlagPageWrapper>
  );
}
