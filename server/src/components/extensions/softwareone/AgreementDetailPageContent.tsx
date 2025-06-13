'use client';

import React from 'react';
import SimpleLayout from './SimpleLayout';
import AgreementDetail from './AgreementDetail';

interface AgreementDetailPageContentProps {
  agreementId: string;
}

export default function AgreementDetailPageContent({ agreementId }: AgreementDetailPageContentProps) {
  return (
    <SimpleLayout>
      <AgreementDetail agreementId={agreementId} />
    </SimpleLayout>
  );
}