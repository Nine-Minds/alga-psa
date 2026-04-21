'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from '@alga-psa/integrations/components';
import type { AccountingMappingContext } from '@alga-psa/integrations/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { createXeroCsvMappingModules } from './xeroCsvMappingModules';

export function XeroCsvMappingManager() {
  const { t } = useTranslation('msp/integrations');
  const modules = useMemo(() => createXeroCsvMappingModules(t), [t]);
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
      urlParamKey="mappingTab"
    />
  );
}
