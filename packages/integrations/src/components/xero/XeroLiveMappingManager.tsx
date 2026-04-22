'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from '@alga-psa/integrations/components';
import type { AccountingMappingContext } from '@alga-psa/integrations/components';
import type { XeroConnectionSummary } from '../../lib/xero/xeroClientService';
import { createXeroLiveMappingModules } from './xeroLiveMappingModules';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface XeroLiveMappingManagerProps {
  defaultConnection: XeroConnectionSummary;
}

export function XeroLiveMappingManager({ defaultConnection }: XeroLiveMappingManagerProps) {
  const { t } = useTranslation('msp/integrations');
  const modules = useMemo(() => createXeroLiveMappingModules(t), [t]);
  const context = useMemo<AccountingMappingContext>(() => ({
    realmId: defaultConnection.xeroTenantId,
    connectionId: defaultConnection.connectionId,
    realmDisplayValue: defaultConnection.tenantName ?? defaultConnection.xeroTenantId
  }), [defaultConnection]);

  const tabStyles = {
    list: 'grid w-full grid-cols-2',
    trigger: 'data-[state=active]:shadow-none'
  };

  return (
    <AccountingMappingManager
      modules={modules}
      context={context}
      realmLabel={t('integrations.xero.live.defaultOrganisation', { defaultValue: 'Default Xero Organisation' })}
      tabStyles={tabStyles}
      defaultTabId="Items / Services"
      urlParamKey="xeroMappingTab"
    />
  );
}
