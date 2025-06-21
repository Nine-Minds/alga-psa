'use client';

import React from 'react';
import SimpleLayout from './SimpleLayout';
import StatementsList from './StatementsList';

export default function StatementsPageContent() {
  return (
    <SimpleLayout>
      <StatementsList />
    </SimpleLayout>
  );
}