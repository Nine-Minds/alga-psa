'use client';

import React, { useMemo } from 'react';

import { AccountingMappingManager } from 'server/src/components/accounting-mappings/AccountingMappingManager';
import type { AccountingMappingContext } from 'server/src/components/accounting-mappings/types';
import { createXeroMappingModules } from './xeroMappingModules';

interface XeroMappingManagerProps {
  connectionId?: string | null;
}

export function XeroMappingManager({ connectionId }: XeroMappingManagerProps) {
  const modules = useMemo(() => createXeroMappingModules(), []);
  const context = useMemo<AccountingMappingContext>(
    () => ({
      realmId: connectionId ?? null
    }),
    [connectionId]
  );

  const tabStyles = {
    list: 'grid w-full grid-cols-2',
    trigger: 'data-[state=active]:shadow-none'
  };

  return (
    <AccountingMappingManager
      modules={modules}
      context={context}
      realmLabel="Xero Connection ID"
      tabStyles={tabStyles}
    />
  );
}
