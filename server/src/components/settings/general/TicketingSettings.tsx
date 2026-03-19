'use client';


import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import BoardsSettings from './BoardsSettings';
import StatusSettings from './StatusSettings';
import { CategoriesSettings } from '@alga-psa/tickets/components';
import { DisplaySettings } from '@alga-psa/tickets/components';
import { NumberingSettings, PrioritySettings } from '@alga-psa/reference-data/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const TICKETING_TAB_IDS = ['display', 'ticket-numbering', 'boards', 'statuses', 'priorities', 'categories'] as const;
const DEFAULT_TICKETING_TAB = 'display';

const TicketingSettingsRefactored = (): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');
  const typeParam = searchParams?.get('type');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = sectionParam?.toLowerCase();
    return requestedTab && TICKETING_TAB_IDS.includes(requestedTab as typeof TICKETING_TAB_IDS[number])
      ? requestedTab
      : DEFAULT_TICKETING_TAB;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const requestedTab = sectionParam?.toLowerCase();
    const targetTab = requestedTab && TICKETING_TAB_IDS.includes(requestedTab as typeof TICKETING_TAB_IDS[number])
      ? requestedTab
      : DEFAULT_TICKETING_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const tabs = [
    {
      id: 'display',
      label: "Display",
      content: <DisplaySettings />
    },
    {
      id: 'ticket-numbering',
      label: "Ticket Numbering",
      content: <NumberingSettings entityType="TICKET" />
    },
    {
      id: 'boards',
      label: "Boards",
      content: <BoardsSettings />
    },
    {
      id: 'statuses',
      label: "Statuses",
      content: <StatusSettings initialStatusType={typeParam} />
    },
    {
      id: 'priorities',
      label: "Priorities",
      content: <PrioritySettings initialPriorityType="ticket" />
    },
    {
      id: 'categories',
      label: "Categories",
      content: <CategoriesSettings />
    }
  ];

  const updateURL = (tabId: string) => {
    // Build new URL with tab and section parameters
    const currentSearchParams = new URLSearchParams(window.location.search);
    
    if (tabId !== DEFAULT_TICKETING_TAB) {
      currentSearchParams.set('section', tabId);
    } else {
      currentSearchParams.delete('section');
    }

    // Keep existing tab parameter
    const newUrl = currentSearchParams.toString() 
      ? `/msp/settings?${currentSearchParams.toString()}`
      : '/msp/settings?tab=ticketing';
    
    window.history.pushState({}, '', newUrl);
  };

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <h2 className="text-xl font-bold mb-4 text-gray-800">{t('ticketing.title')}</h2>
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

export default TicketingSettingsRefactored;
