import React, { Suspense } from 'react';
import BillingPageClient from './BillingPageClient';
import { billingTabDefinitions } from '@alga-psa/billing/components/billing-dashboard/billingTabsConfig';
import { getServices } from '@alga-psa/billing/actions/serviceActions';
import { getDocumentsByContractId } from '@alga-psa/documents/actions/documentActions';
import { getCurrentUser } from '@alga-psa/user-composition/actions/userQueryActions';
import type { IDocument } from '@alga-psa/types';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

interface BillingPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// Billing is a single route whose sections are selected via the `?tab=` query
// param, so the browser tab title is derived from that param to mirror the
// active section. It resolves through the tab strip's own labelKey rather than a
// second copy of the titles, so the two can't drift and neither can go
// untranslated.
export async function generateMetadata({ searchParams }: BillingPageProps): Promise<Metadata> {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;
  const definition = tab ? billingTabDefinitions.find((entry) => entry.value === tab) : undefined;

  if (definition) {
    const { t } = await getServerTranslation(undefined, 'msp/billing');
    return { title: t(definition.labelKey, { defaultValue: definition.label }) };
  }

  const { t } = await getServerTranslation(undefined, 'metadata');
  return { title: t('msp.billing.title', { defaultValue: 'Billing' }) };
}

const BillingPage = async ({ searchParams }: BillingPageProps) => {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/billing', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const { t } = await getServerTranslation(undefined, 'common');
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;
  const subtab = typeof params.subtab === 'string' ? params.subtab : undefined;
  const templateId = typeof params.templateId === 'string' ? params.templateId : undefined;
  const presetId = typeof params.presetId === 'string' ? params.presetId : undefined;
  const contractId = typeof params.contractId === 'string' ? params.contractId : undefined;
  const contractView = typeof params.contractView === 'string' ? params.contractView : undefined;

  // Fetch services (always needed)
  const servicesResponse = await getServices();
  if (isActionMessageError(servicesResponse) || isActionPermissionError(servicesResponse)) {
    return (
      <div className="p-4 text-sm text-red-600">
        {getErrorMessage(servicesResponse)}
      </div>
    );
  }
  const services = Array.isArray(servicesResponse)
    ? servicesResponse
    : (servicesResponse.services || []);

  // The contract detail view switches subtabs client-side (no server navigation),
  // so the user id has to be available for any contract deep link, not just the
  // documents tab. Documents themselves are only prefetched for direct documents
  // links — ContractDetail loads them client-side otherwise.
  let contractDocuments: IDocument[] | null = null;
  let currentUserId: string | null = null;
  if (contractId) {
    const [documents, user] = await Promise.all([
      contractView === 'documents' ? getDocumentsByContractId(contractId) : Promise.resolve(null),
      getCurrentUser()
    ]);
    contractDocuments = Array.isArray(documents) ? documents : contractView === 'documents' ? [] : null;
    currentUserId = user?.user_id || null;
  }

  return (
    <Suspense fallback={<div className="p-4">{t('pages.loading.billingDashboard')}</div>}>
      <BillingPageClient
        initialServices={services}
        contractDocuments={contractDocuments}
        currentUserId={currentUserId}
        initialQuery={{ tab, subtab, templateId, presetId, contractId, contractView }}
      />
    </Suspense>
  );
};

export default BillingPage;
