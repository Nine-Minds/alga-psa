'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import CSVIntegrationSettings from './CSVIntegrationSettings';
import QboIntegrationSettings from './QboIntegrationSettings';
import XeroIntegrationSettings from './XeroIntegrationSettings';
import XeroCsvIntegrationSettings from './XeroCsvIntegrationSettings';
import { AccountingBrandMark, type AccountingBrand } from './accountingBrandLogos';
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
  brand: AccountingBrand;
  kind: 'live' | 'csv';
};

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
      next.push(
        {
          id: 'quickbooks_online',
          title: 'QuickBooks Online',
          brand: 'quickbooks',
          kind: 'live',
          description: t('integrations.accounting.setup.options.qbo.description', {
            defaultValue:
              'Send finalized invoices straight to QuickBooks and keep customers, items, and tax codes in sync.'
          })
        },
        {
          id: 'xero',
          title: 'Xero',
          brand: 'xero',
          kind: 'live',
          description: t('integrations.accounting.setup.options.xero.description', {
            defaultValue:
              'Send finalized invoices straight to Xero and keep contacts, accounts, and tax rates in sync.'
          })
        }
      );
    }

    next.push(
      {
        id: 'quickbooks_csv',
        title: 'QuickBooks CSV',
        brand: 'quickbooks',
        kind: 'csv',
        description: t('integrations.accounting.setup.options.qboCsv.description', {
          defaultValue:
            'Export invoices as a CSV to import into QuickBooks, and bring tax data back from reports.'
        })
      },
      {
        id: 'xero_csv',
        title: 'Xero CSV',
        brand: 'xero',
        kind: 'csv',
        description: t('integrations.accounting.setup.options.xeroCsv.description', {
          defaultValue:
            'Export invoices as a CSV to import into Xero, and bring tax data back from Xero reports.'
        })
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

  const [selected, setSelected] = useState<AccountingIntegrationId | null>(
    () => resolveRequestedSelection()
  );

  useEffect(() => {
    const requested = resolveRequestedSelection();
    if (requested) {
      setSelected(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEEAvailable, qboOauthStatus, xeroOauthStatus, requestedIntegration]);

  // Drop a selection that is no longer available (e.g. EE toggled off).
  useEffect(() => {
    if (selected && !options.some((option) => option.id === selected)) {
      setSelected(null);
    }
  }, [options, selected]);

  const selectedOption =
    options.find((option) => option.id === selected) ?? null;

  const selectIntegration = (next: AccountingIntegrationId | null) => {
    setSelected(next);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', 'integrations');
    params.set('category', 'accounting');
    if (next) {
      params.set('accounting_integration', next);
    } else {
      params.delete('accounting_integration');
    }
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  const kindLabel = (kind: AccountingIntegrationOption['kind']) =>
    kind === 'live'
      ? t('integrations.accounting.setup.kinds.live', {
          defaultValue: 'Live connection'
        })
      : t('integrations.accounting.setup.kinds.csv', {
          defaultValue: 'CSV export'
        });

  const renderPanel = (id: AccountingIntegrationId) => {
    switch (id) {
      case 'quickbooks_online':
        return (
          <QboIntegrationSettings
            syncHealthSlot={qboSyncHealthSlot}
            onboardingSlot={qboOnboardingSlot}
          />
        );
      case 'xero':
        return <XeroIntegrationSettings />;
      case 'quickbooks_csv':
        return <CSVIntegrationSettings />;
      case 'xero_csv':
        return <XeroCsvIntegrationSettings />;
      default:
        return null;
    }
  };

  if (selectedOption) {
    return (
      <div className="space-y-6" id="accounting-integrations-setup">
        <Button
          id="accounting-integrations-back"
          variant="ghost"
          size="sm"
          className="-ml-2"
          onClick={() => selectIntegration(null)}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('integrations.accounting.setup.backToList', {
            defaultValue: 'All accounting integrations'
          })}
        </Button>

        <div className="flex items-center gap-4">
          <AccountingBrandMark brand={selectedOption.brand} size="lg" />
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold text-foreground">
              {selectedOption.title}
            </h3>
            <p className="text-sm text-muted-foreground">
              {kindLabel(selectedOption.kind)}
            </p>
          </div>
        </div>

        {renderPanel(selectedOption.id)}
      </div>
    );
  }

  return (
    <div id="accounting-integrations-setup">
      <div
        className="divide-y rounded-lg border"
        role="list"
        aria-label={t('integrations.accounting.setup.selectorLabel', {
          defaultValue: 'Accounting integration options'
        })}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="listitem"
            id={`accounting-integration-card-${option.id}`}
            className="flex w-full items-center gap-4 px-4 py-4 text-left transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            onClick={() => selectIntegration(option.id)}
          >
            <AccountingBrandMark brand={option.brand} size="sm" />
            <div className="min-w-0 flex-1">
              <span className="text-sm font-medium text-foreground">
                {option.title}
              </span>
              <p className="truncate text-sm text-muted-foreground">
                {option.description}
              </p>
            </div>
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              {kindLabel(option.kind)}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
