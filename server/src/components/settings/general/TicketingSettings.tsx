'use client';


import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import BoardsSettings from './BoardsSettings';
import StatusSettings from './StatusSettings';
import { CategoriesSettings } from '@alga-psa/tickets/components';
import { DisplaySettings } from '@alga-psa/tickets/components';
import { NumberingSettings, PrioritySettings } from '@alga-psa/reference-data/components';

const TicketingSettingsRefactored = (): React.JSX.Element => {
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');
  const typeParam = searchParams?.get('type');

  // Map URL slugs to tab labels
  const sectionToLabelMap: Record<string, string> = {
    'display': 'Display',
    'ticket-numbering': 'Ticket Numbering',
    'boards': 'Boards',
    'statuses': 'Statuses',
    'priorities': 'Priorities',
    'categories': 'Categories'
  };

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const initialLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    return initialLabel || 'Display'; // Default to 'Display'
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const currentLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'Display';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const tabs = [
    {
      label: "Display",
      content: <DisplaySettings />
    },
    {
      label: "Ticket Numbering",
      content: <NumberingSettings entityType="TICKET" />
    },
    {
      label: "Boards",
      content: <BoardsSettings />
    },
    {
      label: "Statuses",
      content: <StatusSettings initialStatusType={typeParam} />
    },
    {
      label: "Priorities",
      content: <PrioritySettings initialPriorityType="ticket" />
    },
    {
      label: "Categories",
      content: <CategoriesSettings />
    }
  ];

  const updateURL = (tabLabel: string) => {
    // Map tab labels back to URL slugs
    const labelToSlugMap: Record<string, string> = Object.entries(sectionToLabelMap).reduce((acc, [slug, label]) => {
      acc[label] = slug;
      return acc;
    }, {} as Record<string, string>);

    const urlSlug = labelToSlugMap[tabLabel];
    
    // Build new URL with tab and section parameters
    const currentSearchParams = new URLSearchParams(window.location.search);
    
    if (urlSlug && urlSlug !== 'display') {
      currentSearchParams.set('section', urlSlug);
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
      <h2 className="text-xl font-bold mb-4 text-gray-800">Ticket Settings</h2>
      <CustomTabs 
        tabs={tabs} 
        defaultTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          updateURL(tab);
        }}
      />
    </div>
  );
};

export default TicketingSettingsRefactored;
