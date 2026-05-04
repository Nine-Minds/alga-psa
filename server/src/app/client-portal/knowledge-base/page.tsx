'use client';

import React, { useState } from 'react';
import { ClientKBPage, ClientKBArticleView } from '@alga-psa/client-portal/components';
import type { IKBArticleWithDocument } from '@alga-psa/documents/actions';

export default function KnowledgeBasePage() {
  const [selectedArticle, setSelectedArticle] = useState<IKBArticleWithDocument | null>(null);

  if (selectedArticle) {
    return (
      <ClientKBArticleView
        articleIdOrSlug={selectedArticle.article_id}
        onBack={() => setSelectedArticle(null)}
      />
    );
  }

  return (
    <ClientKBPage
      onArticleClick={(article) => setSelectedArticle(article)}
    />
  );
}
