'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import Spinner from '@alga-psa/ui/components/Spinner';
import { cn } from '@alga-psa/ui/lib/utils';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import type { RmmProvider } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getAvailableRmmProviderRegistry,
  type RmmProviderMetadata
} from '../../../lib/rmm/providerRegistry';
import {
  getRmmIntegrationStatuses,
  type RmmIntegrationStatus
} from '../../../actions/integrations/rmmIntegrationStatusActions';

import TacticalRmmIntegrationSettings from './TacticalRmmIntegrationSettings';

type RmmIntegrationOption = {
  metadata: RmmProviderMetadata;
  component: React.ComponentType;
};

const PROVIDER_ICON_STYLES: Record<RmmProviderMetadata['icon'], { className: string; label: string }> = {
  tacticalrmm: { className: 'bg-amber-500 text-[9px] font-bold tracking-wider text-white', label: 'TRMM' },
  ninjaone: { className: 'bg-slate-900 text-base font-bold text-white', label: 'N' },
  tanium: { className: 'bg-red-600 text-base font-bold text-white', label: 'T' },
  levelio: { className: 'bg-blue-600 text-base font-bold text-white', label: 'L' },
  huntress: { className: 'bg-emerald-600 text-base font-bold text-white', label: 'H' }
};

function ProviderIcon({ icon }: { icon: RmmProviderMetadata['icon'] }) {
  const style = PROVIDER_ICON_STYLES[icon] ?? { className: 'bg-muted text-xs text-foreground', label: 'RMM' };
  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm ring-1 ring-border',
        style.className
      )}
    >
      {style.label}
    </div>
  );
}

function ProviderStatus({ status, loaded }: { status?: RmmIntegrationStatus; loaded: boolean }) {
  const { t } = useTranslation('msp/integrations');

  if (!loaded) {
    return <span className="h-2 w-24 shrink-0 animate-pulse rounded bg-muted" aria-hidden="true" />;
  }

  if (status?.isActive && status.syncStatus === 'error') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        {t('integrations.rmm.setup.status.syncError', { defaultValue: 'Sync error' })}
      </span>
    );
  }

  if (status?.isActive) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        {status.deviceCount > 0
          ? status.deviceCount === 1
            ? t('integrations.rmm.setup.status.connectedOneDevice', { defaultValue: 'Connected · 1 device' })
            : t('integrations.rmm.setup.status.connectedWithDevices', {
                defaultValue: 'Connected · {{count}} devices',
                count: status.deviceCount
              })
          : t('integrations.rmm.setup.status.connected', { defaultValue: 'Connected' })}
      </span>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="h-2 w-2 rounded-full border border-muted-foreground/40" />
      {t('integrations.rmm.setup.status.notConnected', { defaultValue: 'Not connected' })}
    </span>
  );
}

function ProviderLoading({ title }: { title: string }) {
  const { t } = useTranslation('msp/integrations');
  return (
    <Card>
      <CardContent className="py-8">
        <div className="flex flex-col items-center justify-center gap-2">
          <Spinner size="md" />
          <span className="text-sm text-muted-foreground">
            {t('integrations.rmm.setup.loadingProvider', {
              defaultValue: 'Loading {{title}} integration settings...',
              title
            })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Dynamic imports for EE providers.
const NinjaOneIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/NinjaOneIntegrationSettings'),
  {
    loading: () => <ProviderLoading title="NinjaOne" />,
    ssr: false
  }
);

const TaniumIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/TaniumIntegrationSettings'),
  {
    loading: () => <ProviderLoading title="Tanium" />,
    ssr: false
  }
);

const LevelIoIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/LevelIoIntegrationSettings'),
  {
    loading: () => <ProviderLoading title="Level" />,
    ssr: false
  }
);

const HuntressIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/HuntressIntegrationSettings'),
  {
    loading: () => <ProviderLoading title="Huntress" />,
    ssr: false
  }
);

const providerSettingsComponents: Partial<Record<RmmProvider, React.ComponentType>> = {
  tacticalrmm: TacticalRmmIntegrationSettings,
  ninjaone: NinjaOneIntegrationSettings,
  tanium: TaniumIntegrationSettings,
  levelio: LevelIoIntegrationSettings,
  huntress: HuntressIntegrationSettings
};

export default function RmmIntegrationsSetup() {
  const { t } = useTranslation('msp/integrations');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const tacticalFlag = useFeatureFlag('tactical-rmm-integration', { defaultValue: false });
  const taniumFlag = useFeatureFlag('tanium-rmm-integration', { defaultValue: false });
  const levelIoFlag = useFeatureFlag('levelio-rmm-integration', { defaultValue: false });
  const huntressFlag = useFeatureFlag('huntress-rmm-integration', { defaultValue: false });
  const isTacticalEnabled = !!tacticalFlag?.enabled;
  const isTaniumEnabled = !!taniumFlag?.enabled;
  const isLevelIoEnabled = !!levelIoFlag?.enabled;
  const isHuntressEnabled = !!huntressFlag?.enabled;

  const options = useMemo<RmmIntegrationOption[]>(
    () => {
      const availableProviders = getAvailableRmmProviderRegistry({
        isEnterprise: isEEAvailable,
        enabledFeatureFlags: {
          'tactical-rmm-integration': isTacticalEnabled,
          'tanium-rmm-integration': isTaniumEnabled,
          'levelio-rmm-integration': isLevelIoEnabled,
          'huntress-rmm-integration': isHuntressEnabled
        }
      });

      return availableProviders
        .map((metadata) => {
          const component = providerSettingsComponents[metadata.id];
          if (!component) {
            return null;
          }

          return { metadata, component };
        })
        .filter((option): option is RmmIntegrationOption => option !== null);
    },
    [isEEAvailable, isTacticalEnabled, isTaniumEnabled, isLevelIoEnabled, isHuntressEnabled]
  );

  const [selected, setSelected] = useState<RmmProvider | null>(
    () => (searchParams?.get('rmmProvider') as RmmProvider | null) ?? null
  );
  const selectedOption = selected ? options.find((option) => option.metadata.id === selected) ?? null : null;

  const [statuses, setStatuses] = useState<Record<string, RmmIntegrationStatus>>({});
  const [statusesLoaded, setStatusesLoaded] = useState(false);

  const loadStatuses = useCallback(async () => {
    try {
      const result = await getRmmIntegrationStatuses();
      if (result.success && result.statuses) {
        setStatuses(result.statuses);
      }
    } catch {
      // Status is supplemental; rows fall back to "Not connected".
    } finally {
      setStatusesLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  const selectProvider = useCallback(
    (provider: RmmProvider | null) => {
      setSelected(provider);
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      if (provider) {
        params.set('rmmProvider', provider);
      } else {
        params.delete('rmmProvider');
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const sortedOptions = useMemo(() => {
    return [...options].sort((a, b) => {
      const aActive = statuses[a.metadata.id]?.isActive ? 0 : 1;
      const bActive = statuses[b.metadata.id]?.isActive ? 0 : 1;
      return aActive - bActive;
    });
  }, [options, statuses]);

  // In CE, Tactical is the only supported RMM provider UI we expose today.
  if (!isEEAvailable) {
    if (!isTacticalEnabled) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>{t('integrations.rmm.setup.title', { defaultValue: 'RMM Integrations' })}</CardTitle>
            <CardDescription>{t('integrations.rmm.setup.comingSoon', { defaultValue: 'RMM integration coming soon' })}</CardDescription>
          </CardHeader>
        </Card>
      );
    }
    return <TacticalRmmIntegrationSettings />;
  }

  if (selectedOption) {
    const status = statuses[selectedOption.metadata.id];
    return (
      <div className="space-y-4" id="rmm-integrations-setup">
        <Button
          id="rmm-integrations-back"
          variant="ghost"
          size="sm"
          onClick={() => {
            selectProvider(null);
            void loadStatuses();
          }}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('integrations.rmm.setup.backToList', { defaultValue: 'All RMM integrations' })}
        </Button>

        <div className="flex items-center gap-3">
          <ProviderIcon icon={selectedOption.metadata.icon} />
          <h3 className="text-base font-semibold">{selectedOption.metadata.title}</h3>
          {selectedOption.metadata.badge ? (
            <Badge variant={selectedOption.metadata.badge.variant}>{selectedOption.metadata.badge.label}</Badge>
          ) : null}
          <div className="ml-auto">
            <ProviderStatus status={status} loaded={statusesLoaded} />
          </div>
        </div>

        <selectedOption.component />
      </div>
    );
  }

  return (
    <div id="rmm-integrations-setup">
      <div className="divide-y rounded-lg border" role="list">
        {sortedOptions.map((option) => (
          <button
            key={option.metadata.id}
            type="button"
            role="listitem"
            id={`rmm-integration-row-${option.metadata.id}`}
            className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            onClick={() => selectProvider(option.metadata.id)}
          >
            <ProviderIcon icon={option.metadata.icon} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{option.metadata.title}</span>
                {option.metadata.badge ? (
                  <Badge variant={option.metadata.badge.variant}>{option.metadata.badge.label}</Badge>
                ) : null}
              </div>
              <p className="truncate text-sm text-muted-foreground">{option.metadata.description}</p>
            </div>
            <ProviderStatus status={statuses[option.metadata.id]} loaded={statusesLoaded} />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
