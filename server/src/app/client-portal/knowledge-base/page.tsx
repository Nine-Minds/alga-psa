'use client';

import React, { useState } from 'react';
import { ClientKBPage, ClientKBArticleView } from '@alga-psa/client-portal/components';
import type { IKBArticleWithDocument } from '@alga-psa/documents/actions';
import FeatureFlagPageWrapper from '@alga-psa/ui/components/feature-flags/FeatureFlagPageWrapper';

export default function KnowledgeBasePage() {
  const [selectedArticle, setSelectedArticle] = useState<IKBArticleWithDocument | null>(null);

  if (selectedArticle) {
    return (
      <FeatureFlagPageWrapper featureFlag="knowledge-base">
        <ClientKBArticleView
          articleIdOrSlug={selectedArticle.article_id}
          onBack={() => setSelectedArticle(null)}
        />
      </FeatureFlagPageWrapper>
    );
  }

  return (
    <FeatureFlagPageWrapper featureFlag="knowledge-base">
      <ClientKBPage
        onArticleClick={(article) => setSelectedArticle(article)}
      />
    </FeatureFlagPageWrapper>
  );
}
