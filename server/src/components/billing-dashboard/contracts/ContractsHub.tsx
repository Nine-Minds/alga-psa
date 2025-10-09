'use client';

import React, { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CustomTabs } from '../../ui/CustomTabs';
import Contracts from './Contracts';
import ContractDraftsTab from './ContractDraftsTab';
import { IPlanBundle } from '../../../interfaces/planBundle.interfaces';
import { ContractWizard } from './ContractWizard';

type ContractsSubTab = 'active' | 'drafts';

const ContractsHub: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active sub-tab from URL or default to 'active'
  const activeSubTab = (searchParams?.get('subtab') as ContractsSubTab) || 'active';

  // Trigger for refreshing data across tabs
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [editingDraft, setEditingDraft] = useState<IPlanBundle | null>(null);
  const [showWizard, setShowWizard] = useState(false);

  const handleTabChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('subtab', value);
    // Clear any contract-specific params when switching tabs
    params.delete('contractId');
    router.push(`/msp/billing?tab=contracts&${params.toString()}`);
  };

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleEditDraft = (contract: IPlanBundle) => {
    setEditingDraft(contract);
    setShowWizard(true);
  };

  const handleWizardClose = () => {
    setShowWizard(false);
    setEditingDraft(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Contracts</h2>
      </div>

      <CustomTabs
        key={`contracts-tabs-${activeSubTab}`}
        tabs={[
          {
            label: 'Active Contracts',
            content: (
              <Contracts
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            label: 'Drafts',
            content: (
              <ContractDraftsTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
                onEditDraft={handleEditDraft}
              />
            )
          }
        ]}
        defaultTab={activeSubTab}
        onTabChange={handleTabChange}
      />

      {/* Wizard for editing drafts */}
      <ContractWizard
        open={showWizard}
        onOpenChange={(open) => {
          if (!open) {
            handleWizardClose();
          }
          setShowWizard(open);
        }}
        onComplete={(data) => {
          console.log('Draft updated:', data);
          handleWizardClose();
          handleRefreshData();
        }}
        editingContract={editingDraft ? {
          client_id: '',
          contract_name: editingDraft.bundle_name,
          billing_frequency: 'monthly',
          start_date: '',
          description: editingDraft.bundle_description,
          fixed_services: [],
          enable_proration: true,
          hourly_services: [],
          bucket_services: [],
          bundle_id: editingDraft.bundle_id,
        } : null}
      />
    </div>
  );
};

export default ContractsHub;
