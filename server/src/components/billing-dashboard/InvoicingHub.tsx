'use client'

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CustomTabs } from '../ui/CustomTabs';
import { IService } from '../../interfaces';
import GenerateTab from './invoicing/GenerateTab';
import DraftsTab from './invoicing/DraftsTab';
import FinalizedTab from './invoicing/FinalizedTab';

interface InvoicingHubProps {
  initialServices: IService[];
}

type InvoicingSubTab = 'generate' | 'drafts' | 'finalized';

const InvoicingHub: React.FC<InvoicingHubProps> = ({ initialServices }) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active sub-tab from URL or default to 'generate'
  const activeSubTab = (searchParams?.get('subtab') as InvoicingSubTab) || 'generate';

  // Trigger for refreshing data across tabs
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('subtab', value);
    // Clear any invoice-specific params when switching tabs
    params.delete('invoiceId');
    params.delete('templateId');
    params.delete('managingInvoiceId');
    router.push(`/msp/billing?tab=invoicing&${params.toString()}`);
  };

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Invoicing</h2>
      </div>

      <CustomTabs
        key={`invoicing-tabs-${activeSubTab}`}
        tabs={[
          {
            label: 'Generate',
            content: (
              <GenerateTab
                initialServices={initialServices}
                onGenerateSuccess={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            label: 'Drafts',
            content: (
              <DraftsTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            label: 'Finalized',
            content: (
              <FinalizedTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          }
        ]}
        defaultTab={activeSubTab}
        onTabChange={handleTabChange}
      />
    </div>
  );
};

export default InvoicingHub;
