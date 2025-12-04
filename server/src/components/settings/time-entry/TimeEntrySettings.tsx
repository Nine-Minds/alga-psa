'use client'

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Calendar } from 'lucide-react';
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
      <CustomTabs tabs={tabContent} defaultTab={defaultTab} />
    </div>
  );
};

export default TimeEntrySettings;