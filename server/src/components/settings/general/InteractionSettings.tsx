'use client';


import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import InteractionTypesSettings from './InteractionTypeSettings';
import InteractionStatusSettings from './InteractionStatusSettings';

const InteractionSettings = (): React.JSX.Element => {
  const searchParams = useSearchParams();
  const sectionParam = searchParams?.get('section');

  // Map URL slugs to tab labels
  const sectionToLabelMap: Record<string, string> = {
    'interaction-types': 'Interaction Types',
    'interaction-statuses': 'Interaction Statuses'
  };

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const initialLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    return initialLabel || 'Interaction Types'; // Default to 'Interaction Types'
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const currentLabel = sectionParam ? sectionToLabelMap[sectionParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'Interaction Types';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [sectionParam, activeTab]);

  const tabs = [
    {
      label: "Interaction Types",
      content: <InteractionTypesSettings />
    },
    {
      label: "Interaction Statuses",
      content: <InteractionStatusSettings />
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

    if (urlSlug && urlSlug !== 'interaction-types') {
      currentSearchParams.set('section', urlSlug);
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
      <h2 className="text-xl font-bold mb-4 text-gray-800">Interaction Settings</h2>
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

export default InteractionSettings;
