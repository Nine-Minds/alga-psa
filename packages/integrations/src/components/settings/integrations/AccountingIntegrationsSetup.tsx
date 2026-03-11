'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import CSVIntegrationSettings from './CSVIntegrationSettings';
import XeroIntegrationSettings from './XeroIntegrationSettings';
import XeroCsvIntegrationSettings from './XeroCsvIntegrationSettings';
import { cn } from '@alga-psa/ui/lib/utils';

type AccountingIntegrationId = 'quickbooks_online' | 'xero' | 'quickbooks_csv' | 'xero_csv';

type AccountingIntegrationOption = {
  id: AccountingIntegrationId;
  title: string;
  description: string;
  badge?: { label: string; variant: React.ComponentProps<typeof Badge>['variant'] };
  disabled?: boolean;
  highlights: Array<{ label: string; value: string }>;
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

function IntegrationBanner({ option }: { option: AccountingIntegrationOption }) {
  const icon =
    option.id === 'quickbooks_online' ? (
      <BannerIcon className="bg-green-500 text-xl font-bold text-white">Q</BannerIcon>
    ) : option.id === 'xero' ? (
      <BannerIcon className="bg-sky-500 text-xl font-bold text-white">X</BannerIcon>
    ) : option.id === 'xero_csv' ? (
      <BannerIcon className="bg-sky-500 text-[11px] font-bold tracking-wider text-white">
        X·CSV
      </BannerIcon>
    ) : (
      <BannerIcon className="bg-slate-800 text-[11px] font-bold tracking-wider text-white">
        CSV
      </BannerIcon>
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

export default function AccountingIntegrationsSetup() {
  const searchParams = useSearchParams();
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  const options = useMemo<AccountingIntegrationOption[]>(
    () => {
      const next: AccountingIntegrationOption[] = [
        {
          id: 'quickbooks_online',
          title: 'QuickBooks Online',
          description: 'Connect your realm to sync invoices and manage mappings.',
          disabled: true,
          highlights: [
            { label: 'Sync', value: '2-way' },
            { label: 'Delivery', value: 'Instant' }
          ]
        }
      ];

      if (isEEAvailable) {
        next.push({
          id: 'xero',
          title: 'Xero',
          description: 'Connect your organisation with tenant-owned OAuth credentials for live accounting exports and mappings.',
          badge: { label: 'Enterprise', variant: 'secondary' },
          highlights: [
            { label: 'Sync', value: '2-way' },
            { label: 'Delivery', value: 'Live' }
          ]
        });
      }

      next.push(
        {
          id: 'quickbooks_csv',
          title: 'QuickBooks CSV',
          description: 'Export invoices to CSV for manual import into QuickBooks and import tax data from reports.',
          highlights: [
            { label: 'Export', value: 'Manual' },
            { label: 'Format', value: 'CSV' }
          ]
        },
        {
          id: 'xero_csv',
          title: 'Xero CSV',
          description: 'Export invoices to CSV for manual import into Xero and import tax data from Xero reports.',
          highlights: [
            { label: 'Export', value: 'Manual' },
            { label: 'Format', value: 'CSV' }
          ]
        }
      );

      return next;
    },
    [isEEAvailable]
  );

  const requestedIntegration = searchParams?.get('accounting_integration');
  const oauthStatus = searchParams?.get('xero_status');
  const [selected, setSelected] = useState<AccountingIntegrationId>(() => {
    if ((requestedIntegration === 'xero' || oauthStatus) && isEEAvailable) {
      return 'xero';
    }
    return 'quickbooks_csv';
  });

  useEffect(() => {
    if ((requestedIntegration === 'xero' || oauthStatus) && isEEAvailable) {
      setSelected('xero');
      return;
    }

    if (requestedIntegration === 'xero_csv') {
      setSelected('xero_csv');
      return;
    }

    if (requestedIntegration === 'quickbooks_csv') {
      setSelected('quickbooks_csv');
    }
  }, [isEEAvailable, oauthStatus, requestedIntegration]);

  useEffect(() => {
    if (options.some((option) => option.id === selected)) {
      return;
    }
    setSelected(options[0]?.id ?? 'quickbooks_csv');
  }, [options, selected]);

  const selectedOption = options.find((option) => option.id === selected) ?? options[0];

  const updateUrlSelection = (nextSelection: AccountingIntegrationId) => {
    const currentSearchParams = new URLSearchParams(window.location.search);
    currentSearchParams.set('tab', 'integrations');
    currentSearchParams.set('category', 'accounting');
    currentSearchParams.set('accounting_integration', nextSelection);
    const newUrl = `${window.location.pathname}?${currentSearchParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  };

  return (
    <div className="space-y-6" id="accounting-integrations-setup">
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {options.map((option) => {
          const isSelected = option.id === selected;
          const isDisabled = Boolean(option.disabled);

          return (
            <Card
              key={option.id}
              className={[
                'relative overflow-hidden transition-shadow hover:shadow-md',
                isSelected ? 'ring-2 ring-[rgb(var(--color-primary-500))]' : '',
                isDisabled ? 'opacity-70' : 'cursor-pointer'
              ].join(' ')}
              id={`accounting-integration-card-${option.id}`}
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
                  disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return;
                    setSelected(option.id);
                    updateUrlSelection(option.id);
                  }}
                  id={`accounting-integration-configure-${option.id}`}
                >
                  {isDisabled ? 'Coming Soon' : 'Configure Integration'}
                </Button>
              </CardFooter>

              {isDisabled ? (
                <div className="pointer-events-none absolute inset-0 bg-background/5" />
              ) : null}
            </Card>
          );
        })}
      </div>

      <div className="border-t pt-6" id="accounting-integrations-active-config">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Active Configuration</h3>
          <span className="text-xs text-muted-foreground">
            {selectedOption ? `${selectedOption.title} selected` : null}
          </span>
        </div>

        {selected === 'quickbooks_csv' ? (
          <CSVIntegrationSettings />
        ) : selected === 'xero' ? (
          <XeroIntegrationSettings />
        ) : selected === 'xero_csv' ? (
          <XeroCsvIntegrationSettings />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuration unavailable</CardTitle>
              <CardDescription>
                This integration is not yet available. Select QuickBooks CSV or Xero CSV to configure manual exports.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
