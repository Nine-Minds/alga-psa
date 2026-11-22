'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from '@alga-psa/integrations/components';
import type { AccountingMappingContext } from '@alga-psa/integrations/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useClientAlgaSearch } from '../accounting-mappings/clientAlgaSearch';
import { createCsvMappingModules } from './csvMappingModules';

export function CSVMappingManager() {
  const { t } = useTranslation('msp/integrations');
  const clients = useClientAlgaSearch();
  const modules = useMemo(() => createCsvMappingModules(t, clients), [t, clients]);
  const context = useMemo<AccountingMappingContext>(() => ({ realmId: null }), []);

  const tabStyles = {
    list: 'flex w-full flex-wrap',
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
