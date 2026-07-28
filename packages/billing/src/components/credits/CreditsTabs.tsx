'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';

const CREDIT_TAB_IDS = ['credits', 'reconciliation'] as const;
const DEFAULT_TAB = 'credits';

// Legacy deep links (?tab=active|all|expired) land on the consolidated credits table.
const LEGACY_TAB_ALIASES: Record<string, typeof CREDIT_TAB_IDS[number]> = {
  active: 'credits',
  all: 'credits',
  expired: 'credits',
};

const resolveTab = (tabParam: string | null | undefined): typeof CREDIT_TAB_IDS[number] | null => {
  const requestedTab = tabParam?.toLowerCase();
  if (!requestedTab) return null;
  if (CREDIT_TAB_IDS.includes(requestedTab as typeof CREDIT_TAB_IDS[number])) {
    return requestedTab as typeof CREDIT_TAB_IDS[number];
  }
  return LEGACY_TAB_ALIASES[requestedTab] ?? null;
};

interface CreditsTabsProps {
  tabs: Array<{ id: string; label: string; content: ReactNode }>;
}

export function CreditsTabs({ tabs }: CreditsTabsProps) {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = resolveTab(tabParam);
    if (requestedTab && tabs.some((t) => t.id === requestedTab)) {
      return requestedTab;
    }
    return DEFAULT_TAB;
  });

  useEffect(() => {
    const requestedTab = resolveTab(tabParam);
    if (requestedTab) {
      if (requestedTab !== activeTab) {
        setActiveTab(requestedTab);
      }
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
