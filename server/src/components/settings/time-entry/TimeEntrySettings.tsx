'use client'

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Calendar } from 'lucide-react';
import CustomTabs, { TabContent } from "server/src/components/ui/CustomTabs";
import TimePeriodSettings from 'server/src/components/settings/time-entry/TimePeriodSettings';
import TimePeriodList from './TimePeriodList';

const TimeEntrySettings: React.FC = () => {
  const searchParams = useSearchParams();

  // Map URL slugs to tab labels
  const subtabToLabelMap: Record<string, string> = {
    'time-period-settings': 'Time Period Settings',
    'time-periods': 'Time Periods'
  };

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const subtab = searchParams?.get('subtab');
    const initialLabel = subtab ? subtabToLabelMap[subtab.toLowerCase()] : undefined;
    return initialLabel || 'Time Period Settings';
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const subtab = searchParams?.get('subtab');
    const currentLabel = subtab ? subtabToLabelMap[subtab.toLowerCase()] : undefined;
    const targetTab = currentLabel || 'Time Period Settings';
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [searchParams, activeTab]);

  const updateURL = (tabLabel: string) => {
    // Map tab labels back to URL slugs
    const labelToSlugMap: Record<string, string> = Object.entries(subtabToLabelMap).reduce((acc, [slug, label]) => {
      acc[label] = slug;
      return acc;
    }, {} as Record<string, string>);

    const urlSlug = labelToSlugMap[tabLabel];

    // Build new URL with tab and subtab parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== 'time-period-settings') {
      currentSearchParams.set('subtab', urlSlug);
    } else {
      currentSearchParams.delete('subtab');
    }

    // Ensure the tab parameter is preserved
    if (!currentSearchParams.has('tab')) {
      currentSearchParams.set('tab', 'time-entry');
    }

    const newUrl = `/msp/settings?${currentSearchParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  };

  const tabContent: TabContent[] = [
    {
      label: "Time Period Settings",
      icon: <Settings className="w-4 h-4" />,
      content: <TimePeriodSettings />,
    },
    {
      label: "Time Periods",
      icon: <Calendar className="w-4 h-4" />,
      content: <TimePeriodList />,
    },
  ];

  return (
    <div className="space-y-6">
      <CustomTabs
        tabs={tabContent}
        defaultTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          updateURL(tab);
        }}
      />
    </div>
  );
};

export default TimeEntrySettings;