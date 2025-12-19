'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from 'server/src/components/accounting-mappings/AccountingMappingManager';
import type { AccountingMappingContext } from 'server/src/components/accounting-mappings/types';
import { createXeroCsvMappingModules } from './xeroCsvMappingModules';

export function XeroCsvMappingManager() {
  const modules = useMemo(() => createXeroCsvMappingModules(), []);
  const context = useMemo<AccountingMappingContext>(() => ({ realmId: null }), []);

  const tabStyles = {
    list: 'grid w-full grid-cols-3',
    trigger: 'data-[state=active]:shadow-none'
  };

  return (
    <AccountingMappingManager
      modules={modules}
      context={context}
      tabStyles={tabStyles}
      defaultTabId="Clients"
    />
  );
}
