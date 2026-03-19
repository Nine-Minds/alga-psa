'use client'

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Calendar } from 'lucide-react';
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import TimePeriodSettings from './TimePeriodSettings';
import TimePeriodList from './TimePeriodList';

const DEFAULT_TAB = 'time-period-settings';

const TimeEntrySettings: React.FC = () => {
  const searchParams = useSearchParams();

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const subtab = searchParams?.get('subtab');
    return subtab?.toLowerCase() || DEFAULT_TAB;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const subtab = searchParams?.get('subtab');
    const targetTab = subtab?.toLowerCase() || DEFAULT_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [searchParams, activeTab]);

  const updateURL = (tabId: string) => {
    // Build new URL with tab and subtab parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_TAB) {
      currentSearchParams.set('subtab', tabId);
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
      id: 'time-period-settings',
      label: "Time Period Settings",
      icon: <Settings className="w-4 h-4" />,
      content: <TimePeriodSettings />,
    },
    {
      id: 'time-periods',
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
