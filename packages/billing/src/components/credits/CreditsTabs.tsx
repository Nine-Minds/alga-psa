'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';

const TAB_SLUG_TO_LABEL: Record<string, string> = {
  active: 'Active Credits',
  all: 'All Credits',
  expired: 'Expired Credits',
};

const TAB_LABEL_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(TAB_SLUG_TO_LABEL).map(([slug, label]) => [label, slug])
);

const DEFAULT_TAB = 'Active Credits';

interface CreditsTabsProps {
  tabs: Array<{ label: string; content: ReactNode }>;
}

export function CreditsTabs({ tabs }: CreditsTabsProps) {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (tabParam) {
      const label = TAB_SLUG_TO_LABEL[tabParam.toLowerCase()];
      if (label && tabs.some((t) => t.label === label)) {
        return label;
      }
    }
    return DEFAULT_TAB;
  });

  useEffect(() => {
    if (tabParam) {
      const label = TAB_SLUG_TO_LABEL[tabParam.toLowerCase()];
      if (label && label !== activeTab) {
        setActiveTab(label);
      }
    } else if (activeTab !== DEFAULT_TAB) {
      setActiveTab(DEFAULT_TAB);
    }
  }, [tabParam, activeTab]);

  const handleTabChange = (tabLabel: string) => {
    setActiveTab(tabLabel);

    const slug = TAB_LABEL_TO_SLUG[tabLabel];
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (slug && slug !== 'active') {
      currentSearchParams.set('tab', slug);
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

