'use client';

import { useEffect, useState } from 'react';
import type { Asset } from '@alga-psa/types';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Laptop,
  Server,
  Smartphone,
  Printer,
  Network,
  HardDrive,
  CheckCircle2,
} from 'lucide-react';
import { getClientAssets } from '@alga-psa/client-portal/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { AssetList } from './AssetList';

function iconForType(type: Asset['asset_type']) {
  switch (type) {
    case 'workstation':
      return Laptop;
    case 'server':
      return Server;
    case 'mobile_device':
      return Smartphone;
    case 'printer':
      return Printer;
    case 'network_device':
      return Network;
    default:
      return HardDrive;
  }
}

function labelForType(type: Asset['asset_type'], t: any) {
  switch (type) {
    case 'workstation':
      return t('devices.types.workstation', 'Workstation');
    case 'server':
      return t('devices.types.server', 'Server');
    case 'mobile_device':
      return t('devices.types.mobile', 'Mobile');
    case 'printer':
      return t('devices.types.printer', 'Printer');
    case 'network_device':
      return t('devices.types.network', 'Network');
    default:
      return t('devices.types.unknown', 'Other');
  }
}

export function ClientDevicesPage() {
  const { t } = useTranslation('client-portal');
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const data = await getClientAssets();
        if (mounted) setAssets(data);
      } catch (err: any) {
        console.error(err);
        if (mounted) setError(err?.message || 'Failed to load devices');
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-[rgb(var(--color-text-700))]">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (!assets) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-[rgb(var(--color-text-700))]">
          {t('devices.loading', 'Loading devices…')}
        </CardContent>
      </Card>
    );
  }

  const groups = assets.reduce<Record<string, Asset[]>>((acc, asset) => {
    const key = asset.asset_type;
    (acc[key] ||= []).push(asset);
    return acc;
  }, {});

  const summaryCounts: Array<{ type: Asset['asset_type']; count: number }> = (
    ['workstation', 'server', 'mobile_device', 'printer', 'network_device', 'unknown'] as const
  )
    .map((type) => ({ type, count: groups[type]?.length ?? 0 }))
    .filter((s) => s.count > 0);

  if (assets.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <HardDrive className="mx-auto mb-3 h-12 w-12 text-[rgb(var(--color-text-400))]" />
          <div className="text-base font-medium text-[rgb(var(--color-text-900))]">
            {t('devices.empty.title', 'No devices yet')}
          </div>
          <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">
            {t('devices.empty.body', 'Devices your provider manages will appear here.')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      {summaryCounts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {summaryCounts.map(({ type, count }) => {
            const Icon = iconForType(type);
            return (
              <div
                key={type}
                className="rounded-xl border border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-card))] px-4 py-3"
              >
                <div className="flex items-center gap-2 text-[rgb(var(--color-text-600))]">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs">{labelForType(type, t)}</span>
                </div>
                <div className="mt-1 text-2xl font-semibold text-[rgb(var(--color-text-900))]">
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Status banner */}
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 className="h-5 w-5 text-emerald-600" />
        <div className="min-w-0">
          <div className="text-sm font-medium text-emerald-900">
            {t('devices.statusOkTitle', 'All devices healthy')}
          </div>
          <div className="text-xs text-emerald-700">
            {t('devices.statusOkBody', '{{count}} devices reporting in').replace(
              '{{count}}',
              String(assets.filter((a) => a.status !== 'inactive').length),
            )}
          </div>
        </div>
      </div>

      {/* Full list */}
      <Card>
        <CardContent className="p-4">
          <AssetList assets={assets} />
        </CardContent>
      </Card>
    </div>
  );
}

export default ClientDevicesPage;
