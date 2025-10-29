// server/src/components/integrations/qbo/QboMappingManager.tsx
'use client'; // This component will manage state and potentially fetch data client-side

// server/src/components/integrations/qbo/QboMappingManager.tsx
'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from 'server/src/components/accounting-mappings/AccountingMappingManager';
import type { AccountingMappingContext } from 'server/src/components/accounting-mappings/types';
import { createQboMappingModules } from './qboMappingModules';

interface QboMappingManagerProps {
  realmId: string;
  // Removed tenantId prop
}

export function QboMappingManager({ realmId }: QboMappingManagerProps) {
  const modules = useMemo(() => createQboMappingModules(), []);
  const context = useMemo<AccountingMappingContext>(
    () => ({
      realmId
    }),
    [realmId]
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
