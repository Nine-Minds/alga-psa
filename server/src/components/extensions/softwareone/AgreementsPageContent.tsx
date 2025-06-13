'use client';

import React from 'react';
import SimpleLayout from './SimpleLayout';
import AgreementsList from './AgreementsList';

export default function AgreementsPageContent() {
  return (
    <SimpleLayout>
      <AgreementsList />
    </SimpleLayout>
  );
}