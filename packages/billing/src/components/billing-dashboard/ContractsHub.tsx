'use client'

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import TemplatesTab from './contracts/TemplatesTab';
import ClientContractsTab from './contracts/ClientContractsTab';

type ContractSubTab = 'templates' | 'client-contracts';

const ContractsHub: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active sub-tab from URL or default to 'templates'
  const activeSubTab = (searchParams?.get('subtab') as ContractSubTab) || 'templates';

  // Map URL subtab values to CustomTabs label values
  const subtabToLabel: Record<ContractSubTab, string> = {
    'templates': 'Templates',
    'client-contracts': 'Client Contracts'
  };

  const labelToSubtab: Record<string, ContractSubTab> = {
    'Templates': 'templates',
    'Client Contracts': 'client-contracts'
  };

  // Trigger for refreshing data across tabs
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleTabChange = (value: string) => {
    const targetSubtab = labelToSubtab[value] || value.toLowerCase();

    if (targetSubtab === activeSubTab) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', 'contracts');
    // Convert label back to URL format
    params.set('subtab', targetSubtab);
    router.push(`/msp/billing?${params.toString()}`);
  };

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Contracts</h2>
      </div>

      <CustomTabs
        tabs={[
          {
            label: 'Templates',
            content: (
              <TemplatesTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            label: 'Client Contracts',
            content: (
              <ClientContractsTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          }
        ]}
        defaultTab={subtabToLabel[activeSubTab]}
        onTabChange={handleTabChange}
      />
    </div>
  );
};

export default ContractsHub;
