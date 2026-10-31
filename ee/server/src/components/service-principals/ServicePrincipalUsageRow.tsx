'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getServicePrincipalUsage } from '../../lib/actions/service-principal-actions';
import type { ServicePrincipalUsage } from '../../lib/service-principals/usage';

export interface ServicePrincipalUsageRowProps {
  /** Whether the tenant's tier includes service principals (Pro). Below it the row advertises Pro. */
  hasPro: boolean;
  className?: string;
}

/**
 * "Service principals: N of M" usage line for account usage and the appliance license page.
 * Takes the tier decision as a prop so it also works on the appliance page, which reads its
 * tier from the license status rather than a TierProvider.
 */
export function ServicePrincipalUsageRow({ hasPro, className }: ServicePrincipalUsageRowProps) {
  const { t } = useTranslation('msp/settings');
  const [usage, setUsage] = useState<ServicePrincipalUsage | null>(null);

  useEffect(() => {
    if (!hasPro) return;
    let cancelled = false;
    getServicePrincipalUsage()
      .then((value) => {
        if (!cancelled) setUsage(value);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [hasPro]);

  let value: string | null;
  if (!hasPro) {
    value = t('servicePrincipals.usage.availableOnPro', { defaultValue: 'Available on Pro' });
  } else if (usage) {
    value = t('servicePrincipals.usage.row', {
      defaultValue: '{{used}} of {{limit}}',
      used: usage.used,
      limit: usage.limit,
    });
  } else {
    value = null;
  }

  return (
    <div
      data-testid="service-principal-usage-row"
      className={className ?? 'flex items-center justify-between text-sm'}
    >
      <span className="text-muted-foreground">
        {t('servicePrincipals.usage.label', { defaultValue: 'Service principals' })}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default ServicePrincipalUsageRow;
