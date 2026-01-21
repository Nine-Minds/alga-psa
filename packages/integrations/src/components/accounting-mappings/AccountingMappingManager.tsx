'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import CustomTabs, { TabContent } from '@alga-psa/ui/components/CustomTabs';
import { AccountingMappingContext, AccountingMappingModule } from './types';
import { AccountingMappingModuleView } from './AccountingMappingModuleView';

// Helper function to convert tab label to URL-safe slug (kebab-case)
function toSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

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

  // Build mapping between URL slugs and tab labels
  const { slugToLabelMap, labelToSlugMap } = useMemo(() => {
    const slugToLabel: Record<string, string> = {};
    const labelToSlug: Record<string, string> = {};

    modules.forEach((module) => {
      const label = module.labels.tab;
      const slug = toSlug(label);
      slugToLabel[slug] = label;
      labelToSlug[label] = slug;
    });

    return { slugToLabelMap: slugToLabel, labelToSlugMap: labelToSlug };
  }, [modules]);

  // Determine default tab label
  const defaultLabel = defaultTabId ?? modules[0]?.labels.tab ?? '';

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const initialLabel = tabParam ? slugToLabelMap[tabParam.toLowerCase()] : undefined;
    return initialLabel || defaultLabel;
  });

  // Update active tab when URL parameter changes
  useEffect(() => {
    const currentLabel = tabParam ? slugToLabelMap[tabParam.toLowerCase()] : undefined;
    const targetTab = currentLabel || defaultLabel;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, activeTab, slugToLabelMap, defaultLabel]);

  const updateURL = (tabLabel: string) => {
    const urlSlug = labelToSlugMap[tabLabel];
    const defaultSlug = labelToSlugMap[defaultLabel];

    // Build new URL with tab parameter
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (urlSlug && urlSlug !== defaultSlug) {
      currentSearchParams.set(paramKey, urlSlug);
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
      onTabChange={(tab) => {
        setActiveTab(tab);
        updateURL(tab);
      }}
      data-automation-type="accounting-mapping-tabs"
    />
  );
}
