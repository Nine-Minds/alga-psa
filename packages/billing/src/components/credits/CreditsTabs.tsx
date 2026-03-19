'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';

const CREDIT_TAB_IDS = ['active', 'all', 'expired'] as const;
const DEFAULT_TAB = 'active';

interface CreditsTabsProps {
  tabs: Array<{ id: string; label: string; content: ReactNode }>;
}

export function CreditsTabs({ tabs }: CreditsTabsProps) {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = tabParam?.toLowerCase();
    if (requestedTab && CREDIT_TAB_IDS.includes(requestedTab as typeof CREDIT_TAB_IDS[number]) && tabs.some((t) => t.id === requestedTab)) {
      return requestedTab;
    }
    return DEFAULT_TAB;
  });

  useEffect(() => {
    const requestedTab = tabParam?.toLowerCase();
    if (requestedTab && CREDIT_TAB_IDS.includes(requestedTab as typeof CREDIT_TAB_IDS[number]) && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
    } else if (activeTab !== DEFAULT_TAB) {
      setActiveTab(DEFAULT_TAB);
    }
  }, [tabParam, activeTab]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_TAB) {
      currentSearchParams.set('tab', tabId);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  };

  return <CustomTabs tabs={tabs} defaultTab={activeTab} onTabChange={handleTabChange} />;
}
