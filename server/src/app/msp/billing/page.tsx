import React, { Suspense } from 'react';
import BillingPageClient from './BillingPageClient';
import { getServices } from '@alga-psa/billing/actions';
import { getDocumentsByContractId } from '@alga-psa/documents/actions/documentActions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import type { IDocument } from '@alga-psa/types';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
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
    contractDocuments = isActionPermissionError(documents) ? [] : (documents || []);
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
