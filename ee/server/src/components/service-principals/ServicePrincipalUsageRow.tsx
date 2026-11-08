'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
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
  }, []);

  let value: string | null;
  if (!hasPro) {
    const availability = t('servicePrincipals.usage.availableOnPro', { defaultValue: 'Available on Pro' });
    const blockedCount = usage
      ? t('servicePrincipals.usage.blockedCount', {
          defaultValue: '{{used}} active principals blocked by plan',
          used: usage.used,
        })
      : null;
    value = blockedCount ? `${availability} · ${blockedCount}` : availability;
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
      <div className="flex flex-col">
        <span className="text-muted-foreground">
          {t('servicePrincipals.usage.label', { defaultValue: 'Service principals' })}
        </span>
        <span className="text-xs text-muted-foreground">
          {t('servicePrincipals.usage.seatNote', { defaultValue: "Service principals don't use seats." })}
        </span>
        {!hasPro && (
          <span className="text-xs text-muted-foreground" data-testid="service-principal-usage-blocked-note">
            {t('servicePrincipals.usage.blockedAccess', { defaultValue: 'API and MCP access is blocked below Pro.' })}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="font-medium">{value}</span>
        <Link className="text-xs text-primary underline-offset-4 hover:underline" href="/msp/security-settings?tab=service-principals">
          {t('servicePrincipals.usage.settingsLink', { defaultValue: 'Service principal settings' })}
        </Link>
      </div>
    </div>
  );
}

export default ServicePrincipalUsageRow;
