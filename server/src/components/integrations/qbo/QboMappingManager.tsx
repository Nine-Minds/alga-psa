'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from 'server/src/components/accounting-mappings/AccountingMappingManager';
import type { AccountingMappingContext } from 'server/src/components/accounting-mappings/types';
import { createQboMappingModules } from './qboMappingModules';

interface QboMappingManagerProps {
  realmId: string;
  realmDisplayValue?: string | null;
}

export function QboMappingManager({ realmId, realmDisplayValue }: QboMappingManagerProps) {
  const modules = useMemo(() => createQboMappingModules(), []);
  const context = useMemo<AccountingMappingContext>(
    () => ({
      realmId,
      realmDisplayValue: realmDisplayValue ?? realmId
    }),
    [realmId, realmDisplayValue]
  );

  const tabStyles = {
    list: 'grid w-full grid-cols-3',
    trigger: 'data-[state=active]:shadow-none'
  };

  return (
    <AccountingMappingManager
      modules={modules}
      context={context}
      realmLabel="QuickBooks Realm ID"
      tabStyles={tabStyles}
    />
  );
}
