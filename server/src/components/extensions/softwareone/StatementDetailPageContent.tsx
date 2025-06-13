'use client';

import React from 'react';
import SimpleLayout from './SimpleLayout';
import StatementDetail from './StatementDetail';

interface StatementDetailPageContentProps {
  statementId: string;
}

export default function StatementDetailPageContent({ statementId }: StatementDetailPageContentProps) {
  return (
    <SimpleLayout>
      <StatementDetail statementId={statementId} />
    </SimpleLayout>
  );
}