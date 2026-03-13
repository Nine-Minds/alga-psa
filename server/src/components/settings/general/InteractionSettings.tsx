'use client';


import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import InteractionTypesSettings from './InteractionTypeSettings';
import InteractionStatusSettings from './InteractionStatusSettings';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const INTERACTION_TAB_IDS = ['interaction-types', 'interaction-statuses'] as const;
const DEFAULT_INTERACTION_TAB = 'interaction-types';

const InteractionSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = sectionParam?.toLowerCase();
    return requestedTab && INTERACTION_TAB_IDS.includes(requestedTab as typeof INTERACTION_TAB_IDS[number])
      ? requestedTab
      : DEFAULT_INTERACTION_TAB;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const requestedTab = sectionParam?.toLowerCase();
    const targetTab = requestedTab && INTERACTION_TAB_IDS.includes(requestedTab as typeof INTERACTION_TAB_IDS[number])
      ? requestedTab
      : DEFAULT_INTERACTION_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const tabs = [
    {
      id: 'interaction-types',
      label: "Interaction Types",
      content: <InteractionTypesSettings />
    },
    {
      id: 'interaction-statuses',
      label: "Interaction Statuses",
      content: <InteractionStatusSettings />
    }
  ];

  const updateURL = (tabId: string) => {
    // Build new URL with tab and section parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_INTERACTION_TAB) {
      currentSearchParams.set('section', tabId);
    } else {
      currentSearchParams.delete('section');
    }

    // Keep existing tab parameter
    const newUrl = currentSearchParams.toString()
      ? `/msp/settings?${currentSearchParams.toString()}`
      : '/msp/settings?tab=interactions';

    window.history.pushState({}, '', newUrl);
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <h2 className="text-xl font-bold mb-4 text-gray-800">{t('interactions.title')}</h2>
      <CustomTabs
        tabs={tabs}
        defaultTab={activeTab}
        onTabChange={(tabId) => {
          setActiveTab(tabId);
          updateURL(tabId);
        }}
      />
    </div>
  );
};

export default InteractionSettings;
