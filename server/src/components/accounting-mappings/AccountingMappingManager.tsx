import React from 'react';

import CustomTabs, { TabContent } from 'server/src/components/ui/CustomTabs';
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
};

export function AccountingMappingManager({
  modules,
  context,
  realmLabel,
  tabStyles,
  defaultTabId
}: AccountingMappingManagerProps) {
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
      defaultTab={defaultTabId ?? tabs[0]?.label}
      tabStyles={tabStyles}
      data-automation-type="accounting-mapping-tabs"
    />
  );
}
