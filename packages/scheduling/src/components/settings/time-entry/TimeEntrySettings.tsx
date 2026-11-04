'use client'

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Settings, Calendar, AlertCircle } from 'lucide-react';
import CustomTabs, { TabContent } from "@alga-psa/ui/components/CustomTabs";
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import TimePeriodSettings from './TimePeriodSettings';
import TimePeriodList from './TimePeriodList';
import { useTimePeriodPermissions } from './useTimePeriodPermissions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const DEFAULT_TAB = 'time-period-settings';

const TimeEntrySettings: React.FC = () => {
  const { t } = useTranslation('msp/settings');
  const searchParams = useSearchParams();
  const permissions = useTimePeriodPermissions();

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
      currentSearchParams.delete('tab');
    }

    const query = currentSearchParams.toString();
    const newUrl = query
      ? `${window.location.pathname}?${query}`
      : window.location.pathname;
    window.history.pushState({}, '', newUrl);
  };

  const tabContent: TabContent[] = [
    {
      id: 'time-period-settings',
      label: t('timeEntry.timePeriods.title'),
      icon: <Settings className="w-4 h-4" />,
      content: <TimePeriodSettings permissions={permissions} />,
    },
    {
      id: 'time-periods',
      label: t('timeEntry.periods.title'),
      icon: <Calendar className="w-4 h-4" />,
      content: <TimePeriodList permissions={permissions} />,
    },
  ];

  if (!permissions.loaded) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingIndicator layout="stacked" text={t('timeEntry.loading')} spinnerProps={{ size: 'md' }} />
      </div>
    );
  }

  // Time periods are tenant-wide, so a user without `time_period:read` (every
  // technician-only user) gets the refusal instead of an editor they cannot use.
  if (!permissions.read) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t('timeEntry.accessDenied')}</AlertDescription>
        </Alert>
      </div>
    );
  }

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
