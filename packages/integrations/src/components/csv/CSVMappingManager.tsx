'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from '../accounting-mappings';
import type { AccountingMappingContext } from '../accounting-mappings/types';
import { createCsvMappingModules } from './csvMappingModules';

export function CSVMappingManager() {
  const modules = useMemo(() => createCsvMappingModules(), []);
  const context = useMemo<AccountingMappingContext>(() => ({ realmId: null }), []);

  const tabStyles = {
    list: 'grid w-full grid-cols-4',
    trigger: 'data-[state=active]:shadow-none'
  };

  return (
    <AccountingMappingManager
      modules={modules}
      context={context}
      tabStyles={tabStyles}
      defaultTabId="Clients"
      urlParamKey="mappingTab"
    />
  );
}
