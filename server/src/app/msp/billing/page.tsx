import React, { Suspense } from 'react';
import BillingDashboard from '../../../components/billing-dashboard/BillingDashboard';
import { getServices } from '../../../lib/actions/serviceActions';
import { getDocumentsByContractId } from '../../../lib/actions/document-actions/documentActions';
import { getCurrentUser } from '../../../lib/actions/user-actions/userActions';

interface BillingPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const BillingPage = async ({ searchParams }: BillingPageProps) => {
  const params = await searchParams;
  const contractId = typeof params.contractId === 'string' ? params.contractId : undefined;
  const contractView = typeof params.contractView === 'string' ? params.contractView : undefined;

  // Fetch services (always needed)
  const servicesResponse = await getServices();
  const services = Array.isArray(servicesResponse)
    ? servicesResponse
    : (servicesResponse.services || []);

  // Fetch documents server-side when viewing the documents tab
  let contractDocuments = null;
  let currentUserId = null;
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
      />
    </Suspense>
  );
};

export default BillingPage;
