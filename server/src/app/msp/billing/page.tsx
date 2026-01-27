import React, { Suspense } from 'react';
import { BillingDashboard } from '@alga-psa/billing/components';
import { getServices } from '@alga-psa/billing/actions';
import { getDocumentsByContractId } from '@alga-psa/documents/actions/documentActions';
import { getCurrentUser } from '@alga-psa/users/actions';
import type { IDocument } from '@alga-psa/types';

interface BillingPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const BillingPage = async ({ searchParams }: BillingPageProps) => {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;
  const subtab = typeof params.subtab === 'string' ? params.subtab : undefined;
  const templateId = typeof params.templateId === 'string' ? params.templateId : undefined;
  const presetId = typeof params.presetId === 'string' ? params.presetId : undefined;
  const contractId = typeof params.contractId === 'string' ? params.contractId : undefined;
  const contractView = typeof params.contractView === 'string' ? params.contractView : undefined;

  // Fetch services (always needed)
  const servicesResponse = await getServices();
  const services = Array.isArray(servicesResponse)
    ? servicesResponse
    : (servicesResponse.services || []);

  // Fetch documents server-side when viewing the documents tab
  let contractDocuments: IDocument[] | null = null;
  let currentUserId: string | null = null;
  if (contractId && contractView === 'documents') {
    const [documents, user] = await Promise.all([
      getDocumentsByContractId(contractId),
      getCurrentUser()
    ]);
    contractDocuments = documents || [];
    currentUserId = user?.user_id || null;
  }

  return (
    <Suspense fallback={<div className="p-4">Loading billing dashboard...</div>}>
      <BillingDashboard
        initialServices={services}
        contractDocuments={contractDocuments}
        currentUserId={currentUserId}
        initialQuery={{ tab, subtab, templateId, presetId, contractId, contractView }}
      />
    </Suspense>
  );
};

export default BillingPage;
