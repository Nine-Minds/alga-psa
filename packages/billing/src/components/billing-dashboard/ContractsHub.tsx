'use client'

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import TemplatesTab from './contracts/TemplatesTab';
import ClientContractsTab from './contracts/ClientContractsTab';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type ContractSubTab = 'templates' | 'client-contracts';

const CONTRACT_SUBTABS: readonly ContractSubTab[] = ['templates', 'client-contracts'];

const ContractsHub: React.FC = () => {
  const { t } = useTranslation('msp/billing');
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active sub-tab from URL or default to 'templates'
  const requestedSubtab = searchParams?.get('subtab');
  const activeSubTab = requestedSubtab && CONTRACT_SUBTABS.includes(requestedSubtab as ContractSubTab)
    ? (requestedSubtab as ContractSubTab)
    : 'templates';

  // Trigger for refreshing data across tabs
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleTabChange = (tabId: string) => {
    if (tabId === activeSubTab) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', 'contracts');
    params.set('subtab', tabId);
    router.push(`/msp/billing?${params.toString()}`);
  };

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          {t('contractsHub.title', { defaultValue: 'Contracts' })}
        </h2>
      </div>

      <CustomTabs
        tabs={[
          {
            id: 'templates',
            label: t('contractsHub.tabs.templates', { defaultValue: 'Templates' }),
            content: (
              <TemplatesTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            id: 'client-contracts',
            label: t('contractsHub.tabs.clientContracts', { defaultValue: 'Client Contracts' }),
            content: (
              <ClientContractsTab
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

export default ContractsHub;
