'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import CSVIntegrationSettings from './CSVIntegrationSettings';
import QboIntegrationSettings from './QboIntegrationSettings';
import XeroIntegrationSettings from './XeroIntegrationSettings';
import XeroCsvIntegrationSettings from './XeroCsvIntegrationSettings';
import { cn } from '@alga-psa/ui/lib/utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useAccountingCapabilities } from './useAccountingCapabilities';

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

function IntegrationMark({ option }: { option: AccountingIntegrationOption }) {
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

  return icon;
}

interface AccountingIntegrationsSetupProps {
  qboSyncHealthSlot?: React.ReactNode;
  xeroSyncHealthSlot?: React.ReactNode;
  qboOnboardingSlot?: React.ReactNode;
}

export default function AccountingIntegrationsSetup({ qboSyncHealthSlot, xeroSyncHealthSlot, qboOnboardingSlot }: AccountingIntegrationsSetupProps = {}) {
  const { t } = useTranslation('msp/integrations');
  const caps = useAccountingCapabilities();
  const searchParams = useSearchParams();
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  const options = useMemo<AccountingIntegrationOption[]>(
    () => {
      const next: AccountingIntegrationOption[] = [];

      if (isEEAvailable) {
        next.push({
          id: 'quickbooks_online',
          title: 'QuickBooks Online',
          description: t('integrations.accounting.setup.options.qbo.description', { defaultValue: 'Keep invoices, payments, and customers in sync.' }),
          badge: { label: t('integrations.accounting.setup.badges.enterprise', { defaultValue: 'Pro' }), variant: 'secondary' },
          highlights: [
            { label: t('integrations.accounting.setup.highlights.sync', { defaultValue: 'Sync' }), value: t('integrations.accounting.setup.highlightValues.twoWay', { defaultValue: '2-way' }) },
            { label: t('integrations.accounting.setup.highlights.delivery', { defaultValue: 'Delivery' }), value: t('integrations.accounting.setup.highlightValues.live', { defaultValue: 'Live' }) }
          ]
        });

        next.push({
          id: 'xero',
          title: 'Xero',
          description: t('integrations.accounting.setup.options.xero.description', { defaultValue: 'Keep invoices, payments, and contacts in sync.' }),
          badge: { label: t('integrations.accounting.setup.badges.enterprise', { defaultValue: 'Pro' }), variant: 'secondary' },
          highlights: [
            { label: t('integrations.accounting.setup.highlights.sync', { defaultValue: 'Sync' }), value: t('integrations.accounting.setup.highlightValues.twoWay', { defaultValue: '2-way' }) },
            { label: t('integrations.accounting.setup.highlights.delivery', { defaultValue: 'Delivery' }), value: t('integrations.accounting.setup.highlightValues.live', { defaultValue: 'Live' }) }
          ]
        });
      }

      next.push(
        {
          id: 'quickbooks_csv',
          title: 'QuickBooks CSV',
          description: t('integrations.accounting.setup.options.qboCsv.description', { defaultValue: 'Export invoices for manual import into QuickBooks.' }),
          highlights: [
            { label: t('integrations.accounting.setup.highlights.export', { defaultValue: 'Export' }), value: t('integrations.accounting.setup.highlightValues.manual', { defaultValue: 'Manual' }) },
            { label: t('integrations.accounting.setup.highlights.format', { defaultValue: 'Format' }), value: t('integrations.accounting.setup.highlightValues.csv', { defaultValue: 'CSV' }) }
          ]
        },
        {
          id: 'xero_csv',
          title: 'Xero CSV',
          description: t('integrations.accounting.setup.options.xeroCsv.description', { defaultValue: 'Export invoices and import Xero tax reports.' }),
          highlights: [
            { label: t('integrations.accounting.setup.highlights.export', { defaultValue: 'Export' }), value: t('integrations.accounting.setup.highlightValues.manual', { defaultValue: 'Manual' }) },
            { label: t('integrations.accounting.setup.highlights.format', { defaultValue: 'Format' }), value: t('integrations.accounting.setup.highlightValues.csv', { defaultValue: 'CSV' }) }
          ]
        }
      );

      return next;
    },
    [isEEAvailable, t]
  );

  const requestedIntegration = searchParams?.get('accounting_integration');
  const xeroOauthStatus = searchParams?.get('xero_status');
  const qboOauthStatus = searchParams?.get('qbo_status');

  // An explicit accounting_integration request wins over OAuth status params so
  // the Xero and QBO callbacks cannot clobber each other's selection.
  const resolveRequestedSelection = (): AccountingIntegrationId | null => {
    if (requestedIntegration === 'quickbooks_online' || requestedIntegration === 'qbo') {
      return isEEAvailable ? 'quickbooks_online' : null;
    }
    if (requestedIntegration === 'xero') {
      return isEEAvailable ? 'xero' : null;
    }
    if (requestedIntegration === 'xero_csv') {
      return 'xero_csv';
    }
    if (requestedIntegration === 'quickbooks_csv') {
      return 'quickbooks_csv';
    }
    if (qboOauthStatus && isEEAvailable) {
      return 'quickbooks_online';
    }
    if (xeroOauthStatus && isEEAvailable) {
      return 'xero';
    }
    return null;
  };

  const [selected, setSelected] = useState<AccountingIntegrationId>(
    () => resolveRequestedSelection() ?? 'quickbooks_csv'
  );
  const [showProviderChooser, setShowProviderChooser] = useState(() => resolveRequestedSelection() === null);
  const [xeroReconnectRequired, setXeroReconnectRequired] = useState(false);

  useEffect(() => {
    const handleXeroStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ reconnectRequired?: boolean }>).detail;
      setXeroReconnectRequired(Boolean(detail?.reconnectRequired));
    };
    window.addEventListener('xero-connection-status-changed', handleXeroStatus);
    return () => window.removeEventListener('xero-connection-status-changed', handleXeroStatus);
  }, []);

  useEffect(() => {
    const requested = resolveRequestedSelection();
    if (requested) {
      setSelected(requested);
      setShowProviderChooser(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEEAvailable, qboOauthStatus, xeroOauthStatus, requestedIntegration]);

  useEffect(() => {
    if (options.some((option) => option.id === selected)) {
      return;
    }
    setSelected(options[0]?.id ?? 'quickbooks_csv');
  }, [options, selected]);

  const selectedOption = options.find((option) => option.id === selected) ?? options[0];

  const updateUrlSelection = (nextSelection: AccountingIntegrationId) => {
    const currentSearchParams = new URLSearchParams(window.location.search);
    currentSearchParams.delete('tab');
    currentSearchParams.set('category', 'accounting');
    currentSearchParams.set('accounting_integration', nextSelection);
    const newUrl = `${window.location.pathname}?${currentSearchParams.toString()}`;
    window.history.pushState({}, '', newUrl);
  };

  // Permission-aware navigation: the accounting integration screens are an
  // Admin/Finance surface. Until the capability check resolves, keep showing
  // the setup grid (no flicker); once resolved, a user with none of the five
  // accounting capabilities sees a notice instead of an actionable configure
  // surface. Users holding at least one capability keep every card — the
  // per-panel controls are gated individually inside each settings panel.
  if (caps.loaded && !caps.hasAny) {
    return (
      <div className="space-y-6" id="accounting-integrations-setup">
        <Card id="accounting-integrations-no-permission-card">
          <CardHeader>
            <CardTitle>
              {t('integrations.accounting.setup.noPermission.title', { defaultValue: 'No access to accounting integrations' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.accounting.setup.noPermission.description', { defaultValue: 'You do not have permission to view or configure accounting integrations. Ask an administrator for access.' })}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" id="accounting-integrations-setup">
      {showProviderChooser ? <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {options.map((option) => {
          const isSelected = option.id === selected;
          const isDisabled = Boolean(option.disabled);

          return (
            <Card
              key={option.id}
              className={[
                'relative overflow-hidden transition-shadow hover:shadow-md',
                isSelected ? 'ring-2 ring-[rgb(var(--color-primary-500))]' : '',
                isDisabled ? 'opacity-70' : ''
              ].join(' ')}
              id={`accounting-integration-card-${option.id}`}
            >
              <CardHeader className="space-y-3 p-4 pb-3">
                <div className="flex items-start justify-between gap-3">
                  <IntegrationMark option={option} />
                  {option.badge ? <Badge variant={option.badge.variant}>{option.badge.label}</Badge> : null}
                </div>
                <div className="space-y-1">
                  <CardTitle className="text-base leading-tight">{option.title}</CardTitle>
                  <CardDescription className="min-h-10 text-sm leading-5">{option.description}</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-3 px-4 pb-3 pt-0">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {option.highlights.map((h) => (
                    <Badge key={`${option.id}-${h.label}`} variant="secondary">
                      {h.label}: {h.value}
                    </Badge>
                  ))}
                </div>
              </CardContent>

              <CardFooter className="px-4 pb-4 pt-0">
                <Button
                  className="w-full"
                  variant={isSelected ? 'default' : 'outline'}
                  disabled={isDisabled}
                  onClick={() => {
                    if (isDisabled) return;
                    setSelected(option.id);
                    setShowProviderChooser(false);
                    updateUrlSelection(option.id);
                  }}
                  id={`accounting-integration-configure-${option.id}`}
                >
                  {isDisabled
                    ? t('integrations.accounting.setup.comingSoon', { defaultValue: 'Coming Soon' })
                    : isSelected
                      ? t('integrations.accounting.setup.selectedAction', { defaultValue: 'Selected' })
                      : t('integrations.accounting.setup.configure', { defaultValue: 'Configure' })}
                </Button>
              </CardFooter>

              {isDisabled ? (
                <div className="pointer-events-none absolute inset-0 bg-background/5" />
              ) : null}
            </Card>
          );
        })}
      </div> : selectedOption ? (
        <Card id="accounting-integration-current-provider">
          <div className="flex flex-wrap items-center gap-4 px-6 py-4">
            <IntegrationMark option={selectedOption} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('integrations.accounting.setup.currentIntegration', { defaultValue: 'Accounting integration' })}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold text-foreground">{selectedOption.title}</p>
                {selected === 'xero' && xeroReconnectRequired ? (
                  <Badge variant="error">
                    {t('integrations.accounting.setup.reconnectRequired', { defaultValue: 'Reconnect required' })}
                  </Badge>
                ) : null}
              </div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowProviderChooser(true)} id="accounting-integration-change-provider">
              {t('integrations.accounting.setup.changeIntegration', { defaultValue: 'Choose another' })}
            </Button>
          </div>
        </Card>
      ) : null}

      <div className={showProviderChooser ? 'border-t pt-6' : ''} id="accounting-integrations-active-config">
        {showProviderChooser ? <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">
            {selectedOption
              ? t('integrations.accounting.setup.settingsTitle', { defaultValue: '{{title}} settings', title: selectedOption.title })
              : t('integrations.accounting.setup.activeConfiguration', { defaultValue: 'Integration settings' })}
          </h3>
        </div> : null}

        {selected === 'quickbooks_csv' ? (
          <CSVIntegrationSettings />
        ) : selected === 'quickbooks_online' ? (
          <QboIntegrationSettings syncHealthSlot={qboSyncHealthSlot} onboardingSlot={qboOnboardingSlot} />
        ) : selected === 'xero' ? (
          <XeroIntegrationSettings syncHealthSlot={xeroSyncHealthSlot} />
        ) : selected === 'xero_csv' ? (
          <XeroCsvIntegrationSettings />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('integrations.accounting.setup.unavailable.title', { defaultValue: 'Configuration unavailable' })}</CardTitle>
              <CardDescription>
                {t('integrations.accounting.setup.unavailable.description', { defaultValue: 'This integration is not yet available. Select QuickBooks CSV or Xero CSV to configure manual exports.' })}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  );
}
