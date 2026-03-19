'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import { AccountingMappingContext, AccountingMappingModule } from './types';
import { AccountingMappingModuleView } from './AccountingMappingModuleView';

type AccountingMappingManagerProps = {
  modules: AccountingMappingModule[];
  context: AccountingMappingContext;
  realmLabel?: string;
  tabStyles?: {
    list?: string;
    trigger?: string;
  };
  defaultTabId?: string;
  urlParamKey?: string;
};

export function AccountingMappingManager({
  modules,
  context,
  realmLabel,
  tabStyles,
  defaultTabId,
  urlParamKey
}: AccountingMappingManagerProps) {
  const searchParams = useSearchParams();
  const paramKey = urlParamKey ?? 'tab';
  const tabParam = searchParams?.get(paramKey);

  const defaultTab = defaultTabId ?? modules[0]?.id ?? '';

  const [activeTab, setActiveTab] = useState<string>(() => {
    return tabParam?.toLowerCase() || defaultTab;
  });

  useEffect(() => {
    const targetTab = tabParam?.toLowerCase() || defaultTab;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, activeTab, defaultTab]);

  const updateURL = (tabId: string) => {
    // Build new URL with tab parameter
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId && tabId !== defaultTab) {
      currentSearchParams.set(paramKey, tabId);
    } else {
      currentSearchParams.delete(paramKey);
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  };

  if (!modules.length) {
    return <div>No mapping modules configured.</div>;
  }

  const tabs: TabContent[] = modules.map((module) => ({
    id: module.id,
    label: module.labels.tab,
    content: (
      <AccountingMappingModuleView
        key={module.id}
        module={module}
        context={context}
        realmLabel={realmLabel}
      />
    )
  }));

  return (
    <CustomTabs
      tabs={tabs}
      defaultTab={activeTab}
      tabStyles={tabStyles}
      onTabChange={(tabId) => {
        setActiveTab(tabId);
        updateURL(tabId);
      }}
      data-automation-type="accounting-mapping-tabs"
    />
  );
}
