'use client'

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CustomTabs, { TabContent } from "server/src/components/ui/CustomTabs";
import TimePeriodSettings from 'server/src/components/settings/time-entry/TimePeriodSettings';
import TimePeriodList from './TimePeriodList';

const TimeEntrySettings: React.FC = () => {
  const searchParams = useSearchParams();
  const [defaultTab, setDefaultTab] = useState("Time Period Settings");

  useEffect(() => {
    const subtab = searchParams?.get('subtab');
    if (subtab === 'time-periods') {
      setDefaultTab("Time Periods");
    }
  }, [searchParams]);

  const tabContent: TabContent[] = [
    {
      label: "Time Period Settings",
      content: <TimePeriodSettings />,
    },
    {
      label: "Time Periods",
      content: <TimePeriodList />,
    },
  ];

  return (
    <div className="space-y-6">
      <CustomTabs tabs={tabContent} defaultTab={defaultTab} />
    </div>
  );
};

export default TimeEntrySettings;