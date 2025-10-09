// BillingDashboard.tsx
'use client'
import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useRouter, useSearchParams } from 'next/navigation';
import { IService } from 'server/src/interfaces';

// Import all the components
import BillingPlansOverview from './billing-plans/BillingPlansOverview';
import Invoices from './Invoices';
import InvoiceTemplates from './InvoiceTemplates';
import InvoiceTemplateEditor from './InvoiceTemplateEditor';
import BillingCycles from './BillingCycles';
import TaxRates from './TaxRates';
import GenerateInvoices from './GenerateInvoices';
import ContractsHub from './contracts/ContractsHub';
import ContractDetail from './contracts/ContractDetail';
import { PlanTypeRouter } from './billing-plans/PlanTypeRouter';
import BackNav from 'server/src/components/ui/BackNav';
import UsageTracking from './UsageTracking';
import ContractReports from './reports/ContractReports';
import ServiceCatalogManager from 'server/src/components/settings/billing/ServiceCatalogManager';
import InvoicingHub from './InvoicingHub';

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
    const params = new URLSearchParams();
    params.set('tab', value);

    if (value === 'invoicing') {
      // When switching TO invoicing, check for subtab in URL, sessionStorage, or default
      const urlSubtab = searchParams?.get('subtab');
      const savedSubtab = typeof window !== 'undefined' ? sessionStorage.getItem('invoicing-subtab') : null;
      const subtab = urlSubtab || savedSubtab || 'generate';
      params.set('subtab', subtab);
    } else if (value === 'contracts') {
      // When switching TO contracts, check for subtab in URL, sessionStorage, or default
      const urlSubtab = searchParams?.get('subtab');
      const savedSubtab = typeof window !== 'undefined' ? sessionStorage.getItem('contracts-subtab') : null;
      const subtab = urlSubtab || savedSubtab || 'active';
      params.set('subtab', subtab);
    } else {
      // When switching AWAY from invoicing/contracts, save the current subtab to sessionStorage
      const currentTab = searchParams?.get('tab');
      const currentSubtab = searchParams?.get('subtab');
      if (currentSubtab && typeof window !== 'undefined') {
        if (currentTab === 'invoicing') {
          sessionStorage.setItem('invoicing-subtab', currentSubtab);
        } else if (currentTab === 'contracts') {
          sessionStorage.setItem('contracts-subtab', currentSubtab);
        }
      }
      // Don't include subtab in URL for tabs that don't use subtabs
    }

    router.push(`/msp/billing?${params.toString()}`);
  };

  // Get current tab from URL or default to contracts
  const currentTab = searchParams?.get('tab') || 'contracts';

  const tabs = [
    'contracts',
    'invoicing',
    'invoice-templates',
    'tax-rates',
    'contract-lines',
    'billing-cycles',
    'usage-tracking',
    'reports',
    'service-catalog'
  ];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Billing Dashboard</h1>
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
          {tabs.map((tab): JSX.Element => (
            <Tabs.Trigger
              key={tab}
              value={tab}
              className="px-4 py-2 focus:outline-none transition-colors data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600 text-gray-500 hover:text-gray-700"
            >
              {tab.split('-').map((word): string => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="contracts">
          {searchParams?.has('contractId') ? (
            <ContractDetail />
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
          {searchParams?.get('planId') ? (
            <>
              <BackNav>
                &larr; Back to Contract Lines
              </BackNav>
              <div className="mt-4">
                <PlanTypeRouter planId={searchParams.get('planId')!} />
              </div>
            </>
          ) : (
            <BillingPlansOverview />
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
