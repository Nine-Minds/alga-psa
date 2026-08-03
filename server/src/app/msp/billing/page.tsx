import React, { Suspense } from 'react';
import BillingPageClient from './BillingPageClient';
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

// Browser tab titles for each billing section. Billing is a single route whose
// sections are selected via the `?tab=` query param, so the title is derived from
// that param to mirror the active section. Keep in sync with `billingTabDefinitions`
// in packages/billing/src/components/billing-dashboard/billingTabsConfig.ts.
const BILLING_TAB_TITLES: Record<string, string> = {
  quotes: 'Quotes',
  'quote-templates': 'Quote Layouts',
  'quote-business-templates': 'Quote Templates',
  'client-contracts': 'Client Contracts',
  'accounting-exports': 'Accounting Exports',
  'contract-templates': 'Contract Templates',
  invoicing: 'Invoicing',
  'invoice-templates': 'Invoice Layouts',
  'tax-rates': 'Tax Rates',
  'contract-lines': 'Contract Line Presets',
  'billing-cycles': 'Billing Cycles',
  'service-periods': 'Service Periods',
  'usage-tracking': 'Usage Tracking',
  reports: 'Reports',
  'service-types': 'Service Types',
  'service-catalog': 'Services',
  products: 'Products',
};

export async function generateMetadata({ searchParams }: BillingPageProps): Promise<Metadata> {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : undefined;
  return { title: (tab && BILLING_TAB_TITLES[tab]) || 'Billing' };
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
