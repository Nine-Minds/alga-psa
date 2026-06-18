'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import CSVIntegrationSettings from './CSVIntegrationSettings';
import QboIntegrationSettings from './QboIntegrationSettings';
import XeroIntegrationSettings from './XeroIntegrationSettings';
import XeroCsvIntegrationSettings from './XeroCsvIntegrationSettings';
import { cn } from '@alga-psa/ui/lib/utils';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type AccountingIntegrationId =
  | 'quickbooks_online'
  | 'xero'
  | 'quickbooks_csv'
  | 'xero_csv';

type AccountingIntegrationOption = {
  id: AccountingIntegrationId;
  title: string;
  description: string;
  disabled?: boolean;
  mode: string;
  highlights: Array<{ label: string; value: string }>;
};

function IntegrationMark({
  option,
  selected
}: {
  option: AccountingIntegrationOption;
  selected: boolean;
}) {
  const label =
    option.id === 'quickbooks_online'
      ? 'QB'
      : option.id === 'xero'
        ? 'XE'
        : option.id === 'xero_csv'
          ? 'XC'
          : 'QC';

  return (
    <div
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tracking-normal',
        selected
          ? 'border-primary-500 bg-primary-50 text-primary-700'
          : 'border-border bg-background text-muted-foreground'
      )}
      aria-hidden="true"
    >
      {label}
    </div>
  );
}

interface AccountingIntegrationsSetupProps {
  qboSyncHealthSlot?: React.ReactNode;
  qboOnboardingSlot?: React.ReactNode;
}

export default function AccountingIntegrationsSetup({
  qboSyncHealthSlot,
  qboOnboardingSlot
}: AccountingIntegrationsSetupProps = {}) {
  const { t } = useTranslation('msp/integrations');
  const searchParams = useSearchParams();
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  const options = useMemo<AccountingIntegrationOption[]>(() => {
    const next: AccountingIntegrationOption[] = [];

    if (isEEAvailable) {
      next.push({
        id: 'quickbooks_online',
        title: 'QuickBooks Online',
        description: t(
          'integrations.accounting.setup.options.qbo.description',
          {
            defaultValue:
              'Connect your QuickBooks company for live invoice delivery and mappings.'
          }
        ),
        mode: t('integrations.accounting.setup.modes.liveOauth', {
          defaultValue: 'Live connection'
        }),
        highlights: [
          {
            label: t('integrations.accounting.setup.highlights.sync', {
              defaultValue: 'Sync'
            }),
            value: t('integrations.accounting.setup.highlightValues.twoWay', {
              defaultValue: '2-way'
            })
          },
          {
            label: t('integrations.accounting.setup.highlights.delivery', {
              defaultValue: 'Delivery'
            }),
            value: t('integrations.accounting.setup.highlightValues.live', {
              defaultValue: 'Live'
            })
          }
        ]
      });

      next.push({
        id: 'xero',
        title: 'Xero',
        description: t(
          'integrations.accounting.setup.options.xero.description',
          {
            defaultValue:
              'Connect your Xero organisation for live accounting exports and mappings.'
          }
        ),
        mode: t('integrations.accounting.setup.modes.liveOauth', {
          defaultValue: 'Live connection'
        }),
        highlights: [
          {
            label: t('integrations.accounting.setup.highlights.sync', {
              defaultValue: 'Sync'
            }),
            value: t('integrations.accounting.setup.highlightValues.twoWay', {
              defaultValue: '2-way'
            })
          },
          {
            label: t('integrations.accounting.setup.highlights.delivery', {
              defaultValue: 'Delivery'
            }),
            value: t('integrations.accounting.setup.highlightValues.live', {
              defaultValue: 'Live'
            })
          }
        ]
      });
    }

    next.push(
      {
        id: 'quickbooks_csv',
        title: 'QuickBooks CSV',
        description: t(
          'integrations.accounting.setup.options.qboCsv.description',
          {
            defaultValue:
              'Export invoices to CSV for manual import into QuickBooks and import tax data from reports.'
          }
        ),
        mode: t('integrations.accounting.setup.modes.fileWorkflow', {
          defaultValue: 'File workflow'
        }),
        highlights: [
          {
            label: t('integrations.accounting.setup.highlights.export', {
              defaultValue: 'Export'
            }),
            value: t('integrations.accounting.setup.highlightValues.manual', {
              defaultValue: 'Manual'
            })
          },
          {
            label: t('integrations.accounting.setup.highlights.format', {
              defaultValue: 'Format'
            }),
            value: t('integrations.accounting.setup.highlightValues.csv', {
              defaultValue: 'CSV'
            })
          }
        ]
      },
      {
        id: 'xero_csv',
        title: 'Xero CSV',
        description: t(
          'integrations.accounting.setup.options.xeroCsv.description',
          {
            defaultValue:
              'Export invoices to CSV for manual import into Xero and import tax data from Xero reports.'
          }
        ),
        mode: t('integrations.accounting.setup.modes.fileWorkflow', {
          defaultValue: 'File workflow'
        }),
        highlights: [
          {
            label: t('integrations.accounting.setup.highlights.export', {
              defaultValue: 'Export'
            }),
            value: t('integrations.accounting.setup.highlightValues.manual', {
              defaultValue: 'Manual'
            })
          },
          {
            label: t('integrations.accounting.setup.highlights.format', {
              defaultValue: 'Format'
            }),
            value: t('integrations.accounting.setup.highlightValues.csv', {
              defaultValue: 'CSV'
            })
          }
        ]
      }
    );

    return next;
  }, [isEEAvailable, t]);

  const requestedIntegration = searchParams?.get('accounting_integration');
  const xeroOauthStatus = searchParams?.get('xero_status');
  const qboOauthStatus = searchParams?.get('qbo_status');

  // An explicit accounting_integration request wins over OAuth status params so
  // the Xero and QBO callbacks cannot clobber each other's selection.
  const resolveRequestedSelection = (): AccountingIntegrationId | null => {
    if (
      requestedIntegration === 'quickbooks_online' ||
      requestedIntegration === 'qbo'
    ) {
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

  useEffect(() => {
    const requested = resolveRequestedSelection();
    if (requested) {
      setSelected(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEEAvailable, qboOauthStatus, xeroOauthStatus, requestedIntegration]);

  useEffect(() => {
    if (options.some((option) => option.id === selected)) {
      return;
    }
    setSelected(options[0]?.id ?? 'quickbooks_csv');
  }, [options, selected]);

  const selectedOption =
    options.find((option) => option.id === selected) ?? options[0];

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
      <div
        className="divide-y rounded-md border"
        role="list"
        aria-label={t('integrations.accounting.setup.selectorLabel', {
          defaultValue: 'Accounting integration options'
        })}
      >
        {options.map((option) => {
          const isSelected = option.id === selected;
          const isDisabled = Boolean(option.disabled);

          return (
            <div
              key={option.id}
              role="listitem"
              className={cn(
                'grid gap-4 p-4 transition-colors sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:items-center',
                isSelected
                  ? 'bg-primary-50/60'
                  : 'bg-background hover:bg-muted/30',
                isDisabled ? 'opacity-70' : ''
              )}
              id={`accounting-integration-card-${option.id}`}
            >
              <IntegrationMark option={option} selected={isSelected} />

              <div className="min-w-0 space-y-2">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-base font-semibold text-foreground">
                      {option.title}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {option.mode}
                    </span>
                  </div>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    {option.description}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  {option.highlights.map((h) => (
                    <div
                      key={`${option.id}-${h.label}`}
                      className="flex items-center gap-1"
                    >
                      <span className="font-medium text-foreground/80">
                        {h.label}
                      </span>
                      <span>{h.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                className="w-full sm:w-auto"
                variant={isSelected ? 'default' : 'outline'}
                disabled={isDisabled}
                onClick={() => {
                  if (isDisabled) return;
                  setSelected(option.id);
                  updateUrlSelection(option.id);
                }}
                id={`accounting-integration-configure-${option.id}`}
              >
                {isDisabled
                  ? t('integrations.accounting.setup.comingSoon', {
                      defaultValue: 'Coming Soon'
                    })
                  : t('integrations.accounting.setup.configure', {
                      defaultValue: 'Configure Integration'
                    })}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="border-t pt-6" id="accounting-integrations-active-config">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">
            {t('integrations.accounting.setup.activeConfiguration', {
              defaultValue: 'Active Configuration'
            })}
          </h3>
          <span className="text-xs text-muted-foreground">
            {selectedOption
              ? t('integrations.accounting.setup.selected', {
                  defaultValue: '{{title}} selected',
                  title: selectedOption.title
                })
              : null}
          </span>
        </div>

        {selected === 'quickbooks_csv' ? (
          <CSVIntegrationSettings />
        ) : selected === 'quickbooks_online' ? (
          <QboIntegrationSettings
            syncHealthSlot={qboSyncHealthSlot}
            onboardingSlot={qboOnboardingSlot}
          />
        ) : selected === 'xero' ? (
          <XeroIntegrationSettings />
        ) : selected === 'xero_csv' ? (
          <XeroCsvIntegrationSettings />
        ) : (
          <div className="space-y-1 border-t pt-4">
            <h3 className="text-base font-semibold text-foreground">
              {t('integrations.accounting.setup.unavailable.title', {
                defaultValue: 'Configuration unavailable'
              })}
            </h3>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t('integrations.accounting.setup.unavailable.description', {
                defaultValue:
                  'This integration is not yet available. Select QuickBooks CSV or Xero CSV to configure manual exports.'
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
