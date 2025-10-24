// BillingDashboard.tsx
'use client'
import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { IService } from 'server/src/interfaces';
import { AlertCircle } from 'lucide-react';

// Import all the components
import ContractLinesOverview from './contract-lines/ContractLinesOverview';
import InvoiceTemplates from './InvoiceTemplates';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';
import BillingCycles from './BillingCycles';
import TaxRates from './TaxRates';
import GenerateInvoices from './GenerateInvoices';
import UsageTracking from './UsageTracking';
import CreditManagement from './CreditManagement';
import CreditReconciliation from './CreditReconciliation';
import ContractsHub from './ContractsHub';
import ContractDetailSwitcher from './contracts/ContractDetailSwitcher';
import { ContractLineTypeRouter } from './contract-lines/ContractLineTypeRouter';
import { ContractLinePresetTypeRouter } from './contract-lines/ContractLinePresetTypeRouter';
import BackNav from 'server/src/components/ui/BackNav'; // Import BackNav
import ContractReports from './reports/ContractReports';
import { billingTabDefinitions, BillingTabValue } from './billingTabsConfig';
import InvoicingHub from './InvoicingHub';
import ServiceCatalogManager from 'server/src/components/settings/billing/ServiceCatalogManager';

interface BillingDashboardProps {
  initialServices: IService[];
}

const BillingDashboard: React.FC<BillingDashboardProps> = ({
  initialServices
}) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error] = useState<string | null>(null);

  const handleTabChange = (value: string) => {
    const tabValue = value as BillingTabValue;
    // Only keep the tab parameter, clearing any other state
    const params = new URLSearchParams();
    params.set('tab', tabValue);

    if (value === 'invoicing') {
      // When switching TO invoicing, use sessionStorage or default (ignore URL subtab from previous tab)
      const savedSubtab = typeof window !== 'undefined' ? sessionStorage.getItem('invoicing-subtab') : null;
      const subtab = savedSubtab || 'generate';
      params.set('subtab', subtab);
    } else if (value === 'contracts') {
      // When switching TO contracts, use sessionStorage or default (ignore URL subtab from previous tab)
      const savedSubtab = typeof window !== 'undefined' ? sessionStorage.getItem('contracts-subtab') : null;
      const subtab = savedSubtab || 'templates';
      params.set('subtab', subtab);
    } else {
      // When switching AWAY from invoicing or contracts, save the current subtab to sessionStorage
      const currentTab = searchParams?.get('tab');
      const currentSubtab = searchParams?.get('subtab');
      if (currentSubtab && typeof window !== 'undefined') {
        if (currentTab === 'invoicing') {
          sessionStorage.setItem('invoicing-subtab', currentSubtab);
        } else if (currentTab === 'contracts') {
          sessionStorage.setItem('contracts-subtab', currentSubtab);
        }
      }
      // Don't include subtab in URL for non-invoicing/contracts tabs
    }

    // If we're on a contract line detail page and switching tabs, go back to the main billing dashboard
    if (searchParams?.has('contractLineId')) {
      router.push(`/msp/billing?${params.toString()}`);
    } else {
      router.push(`/msp/billing?${params.toString()}`);
    }
  };

  // Get current tab from URL or default to overview
  const requestedTab = searchParams?.get('tab') as BillingTabValue | null;
  const currentTab = billingTabDefinitions.some((tab) => tab.value === requestedTab)
    ? (requestedTab as BillingTabValue)
    : 'contracts';

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Billing Dashboard</h1>

      {/* Beta Warning Banner */}
      <div className="bg-blue-50 border-l-4 border-blue-500 px-4 py-3 rounded mb-4" role="alert">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-blue-800">Beta Release</p>
            <p className="text-sm text-blue-700">
              Our revamped billing system is currently in beta. You may encounter issues or incomplete features.
              We appreciate your patience as we continue to improve the experience.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}
      <Tabs.Root
        value={currentTab}
        onValueChange={handleTabChange}
        className="w-full"
      >
        <Tabs.List className="flex border-b mb-4">
          {billingTabDefinitions.map((tab): JSX.Element => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="px-4 py-2 focus:outline-none transition-colors data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600 text-gray-500 hover:text-gray-700"
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="contracts">
          {searchParams?.has('contractId') ? (
            <ContractDetailSwitcher />
          ) : (
            <ContractsHub />
          )}
        </Tabs.Content>

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
                &larr; Back to Contract Line Presets List
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

        <Tabs.Content value="usage-tracking">
          <UsageTracking initialServices={initialServices} />
        </Tabs.Content>

        <Tabs.Content value="service-catalog">
          <ServiceCatalogManager />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

export default BillingDashboard;
