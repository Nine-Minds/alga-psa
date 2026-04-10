// BillingDashboard.tsx
'use client'
import React, { useEffect, useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { IClient, IService } from '@alga-psa/types';
import { IDocument } from '@alga-psa/types';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

// Import all the components
import ContractLinesOverview from './contract-lines/ContractLinesOverview';
import InvoiceTemplates from './InvoiceTemplates';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';
import BillingCycles from './BillingCycles';
import RecurringServicePeriodsTab from './RecurringServicePeriodsTab';
import TaxRates from './TaxRates';
import UsageTracking from './UsageTracking';
import TemplatesTab from './contracts/TemplatesTab';
import ClientContractsTab from './contracts/ClientContractsTab';
import ContractDetailSwitcher from './contracts/ContractDetailSwitcher';
import { ContractLinePresetTypeRouter } from './contract-lines/ContractLinePresetTypeRouter';
import BackNav from '@alga-psa/ui/components/BackNav';
import ContractReports from './reports/ContractReports';
import { billingTabDefinitions, BillingTabValue } from './billingTabsConfig';
import InvoicingHub from './InvoicingHub';
import ServiceCatalogManager from '../settings/billing/ServiceCatalogManager';
import ProductsManager from '../settings/billing/ProductsManager';
import AccountingExportsTab from './accounting/AccountingExportsTab';
import QuotesTab from './quotes/QuotesTab';
import QuoteDocumentTemplatesPage from './quotes/QuoteDocumentTemplatesPage';
import QuoteTemplatesList from './quotes/QuoteTemplatesList';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface BillingDashboardProps {
  initialServices: IService[];
  /** Documents fetched server-side when viewing contract documents tab */
  contractDocuments?: IDocument[] | null;
  /** Current user ID fetched server-side */
  currentUserId?: string | null;
  /** Snapshot of query params used for the initial server render (prevents hydration mismatch). */
  initialQuery?: Record<string, string | undefined>;
  /** Optional injected UI for client quick view. */
  renderClientDetails?: (args: { id: string; client: IClient }) => React.ReactNode;
}

const BillingDashboard: React.FC<BillingDashboardProps> = ({
  initialServices,
  contractDocuments,
  currentUserId,
  initialQuery,
  renderClientDetails,
}) => {
  const { t } = useTranslation('msp/billing');
  const router = useRouter();
  const liveSearchParams = useSearchParams();
  const [isHydrated, setIsHydrated] = useState(false);
  const [error] = useState<string | null>(null);

  const { enabled: isQuotingEnabled } = useFeatureFlag('quoting-enabled', { defaultValue: false });

  const tabDefinitions = useMemo(() => {
    if (isQuotingEnabled) return billingTabDefinitions;
    return billingTabDefinitions.filter(
      (tab) => tab.value !== 'quotes' && tab.value !== 'quote-templates' && tab.value !== 'quote-business-templates'
    );
  }, [isQuotingEnabled]);

  const initialSearchParams = useMemo(() => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(initialQuery ?? {})) {
      if (typeof value === 'string' && value.length > 0) {
        params.set(key, value);
      }
    }
    return params;
  }, [initialQuery]);

  const searchParams = isHydrated ? liveSearchParams : initialSearchParams;

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const handleTabChange = (value: string) => {
    const tabValue = value as BillingTabValue;
    const params = new URLSearchParams();
    params.set('tab', tabValue);

    if (value === 'invoicing') {
      // When switching TO invoicing, use sessionStorage or default
      const savedSubtab = typeof window !== 'undefined' ? sessionStorage.getItem('invoicing-subtab') : null;
      const subtab = savedSubtab || 'generate';
      params.set('subtab', subtab);
    } else {
      // When switching AWAY from invoicing, save the current subtab to sessionStorage
      const currentTab = searchParams?.get('tab');
      const currentSubtab = searchParams?.get('subtab');
      if (currentSubtab && typeof window !== 'undefined' && currentTab === 'invoicing') {
        sessionStorage.setItem('invoicing-subtab', currentSubtab);
      }
    }

    router.push(`/msp/billing?${params.toString()}`);
  };

  // Get current tab from URL or default to overview
  const requestedTab = searchParams?.get('tab') as BillingTabValue | null;
  const availableValues = tabDefinitions.map((tab) => tab.value);
  const currentTab = availableValues.includes(requestedTab as BillingTabValue)
    ? (requestedTab as BillingTabValue)
    : tabDefinitions[0]?.value ?? 'client-contracts';

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-3xl font-bold mb-6">
        {t('dashboard.title', { defaultValue: 'Billing' })}
      </h1>

      {/* Beta Warning Banner */}
      <Alert variant="info" className="mb-4">
        <AlertTitle>{t('dashboard.beta.title', { defaultValue: 'Beta Release' })}</AlertTitle>
        <AlertDescription>
          {t('dashboard.beta.description', {
            defaultValue: 'Our revamped billing system is currently in beta. You may encounter issues or incomplete features. We appreciate your patience as we continue to improve the experience.',
          })}
        </AlertDescription>
      </Alert>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            <strong className="font-bold">
              {t('dashboard.errorPrefix', { defaultValue: 'Error:' })}{' '}
            </strong>
            <span className="block sm:inline">{error}</span>
          </AlertDescription>
        </Alert>
      )}
      <Tabs.Root
        value={currentTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <Tabs.Content value="contract-templates">
          {searchParams?.has('contractId') ? (
            <ContractDetailSwitcher renderClientDetails={renderClientDetails} />
          ) : (
            <TemplatesTab />
          )}
        </Tabs.Content>

        <Tabs.Content value="client-contracts">
          {searchParams?.has('contractId') ? (
            <ContractDetailSwitcher
              contractDocuments={contractDocuments}
              currentUserId={currentUserId}
              renderClientDetails={renderClientDetails}
            />
          ) : (
            <ClientContractsTab />
          )}
        </Tabs.Content>

        <Tabs.Content value="accounting-exports">
          <AccountingExportsTab />
        </Tabs.Content>

        {isQuotingEnabled && (
          <Tabs.Content value="quotes">
            <QuotesTab />
          </Tabs.Content>
        )}

        {isQuotingEnabled && (
          <Tabs.Content value="quote-templates">
            <QuoteDocumentTemplatesPage />
          </Tabs.Content>
        )}

        {isQuotingEnabled && (
          <Tabs.Content value="quote-business-templates">
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">
                {t('dashboard.quoteTemplatesHeading', { defaultValue: 'Quote Templates' })}
              </h2>
              <QuoteTemplatesList
                onEdit={(id) => router.push(`/msp/billing?tab=quotes&quoteId=${id}&mode=edit`)}
                onCreateFromTemplate={(id) => router.push(`/msp/billing?tab=quotes&quoteId=new&templateId=${id}`)}
                onNewTemplate={() => router.push('/msp/billing?tab=quotes&quoteId=new&isTemplate=true')}
              />
            </div>
          </Tabs.Content>
        )}

        <Tabs.Content value="reports">
          <ContractReports />
        </Tabs.Content>

        <Tabs.Content value="invoicing">
          <InvoicingHub initialServices={initialServices} />
        </Tabs.Content>

        <Tabs.Content value="invoice-templates">
          {searchParams?.has('templateId') ? (
            <InvoiceTemplateEditor templateId={searchParams.get('templateId') === 'new' ? null : searchParams.get('templateId')} />
          ) : (
            <InvoiceTemplates />
          )}
        </Tabs.Content>

        <Tabs.Content value="tax-rates">
          <TaxRates />
        </Tabs.Content>

        <Tabs.Content value="contract-lines">
          {searchParams?.get('presetId') ? (
            <>
              <BackNav>
                {`<- ${t('dashboard.backToPresets', { defaultValue: 'Back to Contract Line Presets List' })}`}
              </BackNav>
              <div className="mt-4">
                <ContractLinePresetTypeRouter presetId={searchParams.get('presetId')!} />
              </div>
            </>
          ) : (
            <ContractLinesOverview />
          )}
        </Tabs.Content>
        <Tabs.Content value="billing-cycles">
          <BillingCycles />
        </Tabs.Content>

        <Tabs.Content value="service-periods">
          <RecurringServicePeriodsTab initialScheduleKey={searchParams?.get('scheduleKey') ?? undefined} />
        </Tabs.Content>

        <Tabs.Content value="usage-tracking">
          <UsageTracking initialServices={initialServices} />
        </Tabs.Content>

        <Tabs.Content value="service-catalog">
          <ServiceCatalogManager />
        </Tabs.Content>

        <Tabs.Content value="products">
          <ProductsManager />
        </Tabs.Content>

      </Tabs.Root>
    </div>
  );
};

export default BillingDashboard;
