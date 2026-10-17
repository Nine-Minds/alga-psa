'use client';

import React, { useMemo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { AccountingMappingManager } from './AccountingMappingManager';
import type { AccountingMappingContext } from './types';
import { createQuickBooksDesktopMappingModules } from './quickBooksDesktopMappingModule';

/** Every QuickBooks Desktop (IIF) mapping in one place: clients, services, discounts, tax codes and terms. */
export function QuickBooksDesktopMappingManager() {
  const { t } = useTranslation('msp/integrations');
  const modules = useMemo(() => createQuickBooksDesktopMappingModules(t), [t]);
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
      urlParamKey="qbdMappingTab"
    />
  );
}
