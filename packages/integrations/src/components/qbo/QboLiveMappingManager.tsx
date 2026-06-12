'use client';

import React, { useMemo } from 'react';
import { AccountingMappingManager } from '@alga-psa/integrations/components';
import type { AccountingMappingContext } from '@alga-psa/integrations/components';
import type { QboConnectionSummary } from '../../actions/qboActions';
import { createQboLiveMappingModules } from './qboLiveMappingModules';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface QboLiveMappingManagerProps {
  defaultConnection: QboConnectionSummary;
}

export function QboLiveMappingManager({ defaultConnection }: QboLiveMappingManagerProps) {
  const { t } = useTranslation('msp/integrations');
  const modules = useMemo(() => createQboLiveMappingModules(t), [t]);
  const context = useMemo<AccountingMappingContext>(() => ({
    realmId: defaultConnection.realmId,
    connectionId: defaultConnection.realmId,
    realmDisplayValue: defaultConnection.displayName ?? defaultConnection.realmId
  }), [defaultConnection]);

  const tabStyles = {
    list: 'grid w-full grid-cols-3',
    trigger: 'data-[state=active]:shadow-none'
  };

  return (
    <AccountingMappingManager
      modules={modules}
      context={context}
      realmLabel={t('integrations.qbo.live.defaultCompany', { defaultValue: 'Connected QuickBooks Company' })}
      tabStyles={tabStyles}
      defaultTabId="Items / Services"
      urlParamKey="qboMappingTab"
    />
  );
}
