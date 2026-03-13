'use client'

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import type { IService } from '@alga-psa/types';
import GenerateTab from './invoicing/GenerateTab';
import DraftsTab from './invoicing/DraftsTab';
import FinalizedTab from './invoicing/FinalizedTab';

interface InvoicingHubProps {
  initialServices: IService[];
}

type InvoicingSubTab = 'generate' | 'drafts' | 'finalized';

const INVOICING_SUBTABS: readonly InvoicingSubTab[] = ['generate', 'drafts', 'finalized'];

const InvoicingHub: React.FC<InvoicingHubProps> = ({ initialServices }) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active sub-tab from URL or default to 'generate'
  const requestedSubtab = searchParams?.get('subtab');
  const activeSubTab = requestedSubtab && INVOICING_SUBTABS.includes(requestedSubtab as InvoicingSubTab)
    ? (requestedSubtab as InvoicingSubTab)
    : 'generate';

  // Trigger for refreshing data across tabs
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleTabChange = (tabId: string) => {
    if (tabId === activeSubTab) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', 'invoicing');
    params.set('subtab', tabId);
    router.push(`/msp/billing?${params.toString()}`);
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
        tabs={[
          {
            id: 'generate',
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
            id: 'drafts',
            label: 'Drafts',
            content: (
              <DraftsTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            id: 'finalized',
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
