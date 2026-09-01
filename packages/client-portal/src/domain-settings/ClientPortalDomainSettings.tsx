'use client';


import React, { useEffect, useState } from 'react';
import { AtSign } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { getPortalDomainStatusAction } from '@alga-psa/tenancy/actions';
import type { PortalDomainStatusResponse } from '@alga-psa/tenancy/actions/tenant-actions/portalDomain.types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ClientPortalDomainSettingsProps {
  headerAction?: React.ReactNode;
}

const ClientPortalDomainSettings = ({ headerAction }: ClientPortalDomainSettingsProps) => {
  const { t } = useTranslation('client-portal');
  const [portalStatus, setPortalStatus] = useState<PortalDomainStatusResponse | null>(null);
  const [portalLoading, setPortalLoading] = useState(true);

  useEffect(() => {
    const loadPortalStatus = async () => {
      setPortalLoading(true);
      try {
        const status = await getPortalDomainStatusAction();
        setPortalStatus(status);
      } catch (error) {
        console.error('Failed to load portal domain status:', error);
      } finally {
        setPortalLoading(false);
      }
    };

    loadPortalStatus();
  }, []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <CardTitle>
              <span className="flex items-center gap-2">
                <AtSign className="h-5 w-5" />
                {t('clientSettings.domain.title', { defaultValue: 'Custom Domain' })}
                <Badge variant="secondary" className="uppercase text-[10px] tracking-wide">
                  Pro
                </Badge>
              </span>
            </CardTitle>
            <CardDescription>
              {t('clientSettings.domain.description', {
                defaultValue: 'Pro tenants can host the portal on a custom domain. Your default hosted address is shown below.',
              })}
            </CardDescription>
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6">
            {portalLoading ? (
              <div className="h-5 w-48 animate-pulse rounded skeleton-fill" />
            ) : (
              <div className="space-y-3 text-center">
                <div className="text-sm font-medium text-gray-600">
                  {t('clientSettings.domain.defaultAddressLabel', { defaultValue: 'Default portal address' })}
                </div>
                <code className="inline-block rounded bg-white px-3 py-1 text-sm text-gray-900 shadow-sm">
                  {portalStatus?.canonicalHost ?? '—'}
                </code>
                <p className="text-xs text-gray-500">
                  {t('clientSettings.domain.upgradeHint', {
                    defaultValue: 'Upgrade to Pro to configure a branded customer portal domain and automated certificates.',
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ClientPortalDomainSettings;
