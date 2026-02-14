'use client';

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import Spinner from '@alga-psa/ui/components/Spinner';
import { cn } from '@alga-psa/ui/lib/utils';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

import TacticalRmmIntegrationSettings from './TacticalRmmIntegrationSettings';

type RmmIntegrationId = 'tacticalrmm' | 'ninjaone';

type RmmIntegrationOption = {
  id: RmmIntegrationId;
  title: string;
  description: string;
  badge?: { label: string; variant: React.ComponentProps<typeof Badge>['variant'] };
  highlights: Array<{ label: string; value: string }>;
  component: React.ComponentType;
};

function BannerIcon({
  className,
  children
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold shadow-sm ring-1 ring-border',
        className
      )}
    >
      {children}
    </div>
  );
}

function IntegrationBanner({ option }: { option: RmmIntegrationOption }) {
  const icon =
    option.id === 'tacticalrmm' ? (
      <BannerIcon className="bg-amber-500 text-[11px] font-bold tracking-wider text-white">
        TRMM
      </BannerIcon>
    ) : (
      <BannerIcon className="bg-slate-900 text-xl font-bold text-white">N</BannerIcon>
    );

  return (
    <div className="relative flex h-24 w-full items-center justify-center rounded-lg bg-muted/40">
      {option.badge ? (
        <div className="absolute right-3 top-3">
          <Badge variant={option.badge.variant}>{option.badge.label}</Badge>
        </div>
      ) : null}
      {icon}
    </div>
  );
}

// Dynamic import for NinjaOne (EE feature).
const NinjaOneIntegrationSettings = dynamic(
  () => import('@enterprise/components/settings/integrations/NinjaOneIntegrationSettings'),
  {
    loading: () => (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center justify-center gap-2">
            <Spinner size="md" />
            <span className="text-sm text-muted-foreground">Loading NinjaOne integration settings...</span>
          </div>
        </CardContent>
      </Card>
    ),
    ssr: false
  }
);

export default function RmmIntegrationsSetup() {
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  const tacticalFlag = useFeatureFlag('tactical-rmm-integration', { defaultValue: false });
  const isTacticalEnabled = !!tacticalFlag?.enabled;

  const options = useMemo<RmmIntegrationOption[]>(
    () => {
      const next: RmmIntegrationOption[] = [];

      if (isTacticalEnabled) {
        next.push({
          id: 'tacticalrmm',
          title: 'Tactical RMM',
          description: 'Sync devices and ingest alerts via Tactical RMM (beta API + alert-action webhooks).',
          highlights: [
            { label: 'Sync', value: 'Devices' },
            { label: 'Realtime', value: 'Alerts' }
          ],
          component: TacticalRmmIntegrationSettings
        });
      }

      if (isEEAvailable) {
        next.push({
          id: 'ninjaone',
          title: 'NinjaOne',
          description: 'Sync devices, receive alerts, and enable remote access (Enterprise).',
          badge: { label: 'Enterprise', variant: 'secondary' },
          highlights: [
            { label: 'Sync', value: 'Devices' },
            { label: 'Realtime', value: 'Webhooks' }
          ],
          component: NinjaOneIntegrationSettings
        });
      }

      return next;
    },
    [isTacticalEnabled, isEEAvailable]
  );

  const [selected, setSelected] = useState<RmmIntegrationId>(() => {
    if (isTacticalEnabled) return 'tacticalrmm';
    return isEEAvailable ? 'ninjaone' : 'tacticalrmm';
  });
  const selectedOption = options.find((option) => option.id === selected) ?? options[0];

  useEffect(() => {
    if (options.length > 0 && !options.some((option) => option.id === selected)) {
      setSelected(options[0]?.id ?? 'ninjaone');
    }
  }, [options, selected]);

  // In CE, Tactical is the only supported RMM provider UI we expose today.
  if (!isEEAvailable) {
    if (!isTacticalEnabled) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>RMM Integrations</CardTitle>
            <CardDescription>RMM integration coming soon</CardDescription>
          </CardHeader>
        </Card>
      );
    }
    return <TacticalRmmIntegrationSettings />;
  }

  return (
    <div className="space-y-6" id="rmm-integrations-setup">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {options.map((option) => {
          const isSelected = option.id === selected;
          return (
            <Card
              key={option.id}
              className={[
                'relative overflow-hidden transition-shadow hover:shadow-md',
                isSelected ? 'ring-2 ring-[rgb(var(--color-primary-500))]' : '',
                'cursor-pointer'
              ].join(' ')}
              id={`rmm-integration-card-${option.id}`}
            >
              <CardHeader className="space-y-4 pb-3">
                <IntegrationBanner option={option} />
                <div className="space-y-1">
                  <CardTitle className="text-base">{option.title}</CardTitle>
                  <CardDescription className="text-sm">{option.description}</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 pt-0">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  {option.highlights.map((h) => (
                    <div key={`${option.id}-${h.label}`} className="flex items-center gap-1">
                      <span className="font-medium text-foreground/80">{h.label}</span>
                      <span>{h.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>

              <CardFooter className="pt-0">
                <Button
                  className="w-full"
                  variant={isSelected ? 'default' : 'outline'}
                  onClick={() => setSelected(option.id)}
                  id={`rmm-integration-configure-${option.id}`}
                >
                  Configure Integration
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="border-t pt-6" id="rmm-integrations-active-config">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Active Configuration</h3>
          <span className="text-xs text-muted-foreground">
            {selectedOption ? `${selectedOption.title} selected` : null}
          </span>
        </div>

        {selectedOption ? <selectedOption.component /> : null}
      </div>
    </div>
  );
}
