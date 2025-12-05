'use client';

import React, { useEffect, useState } from 'react';
import { AtSign } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { getPortalDomainStatusAction } from '@/lib/actions/tenant-actions/portalDomainActions';
import type { PortalDomainStatusResponse } from '@/lib/actions/tenant-actions/portalDomain.types';

const ClientPortalDomainSettings = () => {
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
        <CardTitle>
          <div className="flex items-center gap-2">
            <AtSign className="h-5 w-5" />
            Custom Domain
            <Badge variant="secondary" className="uppercase text-[10px] tracking-wide">
              Enterprise
            </Badge>
          </div>
        </CardTitle>
        <CardDescription>
          Enterprise tenants can host the portal on a custom domain. Your default hosted address is shown below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6">
            {portalLoading ? (
              <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
            ) : (
              <div className="space-y-3 text-center">
                <div className="text-sm font-medium text-gray-600">Default portal address</div>
                <code className="inline-block rounded bg-white px-3 py-1 text-sm text-gray-900 shadow-sm">
                  {portalStatus?.canonicalHost ?? '—'}
                </code>
                <p className="text-xs text-gray-500">
                  Upgrade to Enterprise to configure a branded customer portal domain and automated certificates.
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
