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
import Contracts from './contracts/Contracts';
import ContractDetail from './contracts/ContractDetail';
import { PlanTypeRouter } from './billing-plans/PlanTypeRouter';
import BackNav from 'server/src/components/ui/BackNav';
import UsageTracking from './UsageTracking';
import ContractReports from './reports/ContractReports';
import { billingTabDefinitions, BillingTabValue } from './billingTabsConfig';
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
    const tabValue = value as BillingTabValue;
    // Only keep the tab parameter, clearing any other state
    const params = new URLSearchParams();
    params.set('tab', tabValue);

    // If we're on a plan detail page and switching tabs, go back to the main billing dashboard
    if (searchParams?.has('planId')) {
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
            <ContractDetail />
          ) : (
            <Contracts />
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
      </Tabs.Root>
    </div>
  );
};

export default BillingDashboard;
