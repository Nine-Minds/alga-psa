'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
  const { t } = useTranslation('msp/integrations');
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramKey = urlParamKey ?? 'tab';
  const tabParam = searchParams?.get(paramKey);
  const moduleIds = useMemo(() => modules.map((module) => module.id), [modules]);
  const requestedDefaultTab = defaultTabId ?? modules[0]?.id ?? '';
  const defaultTab = moduleIds.includes(requestedDefaultTab) ? requestedDefaultTab : modules[0]?.id ?? '';
  const urlTab = tabParam?.toLowerCase() ?? '';

  const [activeTab, setActiveTab] = useState<string>(() => {
    return moduleIds.includes(urlTab) ? urlTab : defaultTab;
  });

  useEffect(() => {
    setActiveTab(moduleIds.includes(urlTab) ? urlTab : defaultTab);
  }, [defaultTab, urlTab, moduleIds]);

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

    router.replace(newUrl, { scroll: false });
  };

  if (!modules.length) {
    return <div>{t('integrations.accounting.manager.noModules', { defaultValue: 'No mapping modules configured.' })}</div>;
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
      value={activeTab}
      tabStyles={tabStyles}
      onTabChange={(tabId) => {
        setActiveTab(tabId);
        updateURL(tabId);
      }}
      data-automation-type="accounting-mapping-tabs"
    />
  );
}
