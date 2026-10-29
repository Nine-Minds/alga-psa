'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import type { ClientContractDerivedStatus, IContract } from '@alga-psa/types';
import type { IContractSummary } from '@alga-psa/billing/actions/contractActions';
import { Calendar, CalendarClock, FileCheck, Layers3, Coins } from 'lucide-react';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';
import { toCalendarDisplayDate } from '@alga-psa/core';

interface ContractHeaderProps {
  contract: IContract;
  summary?: IContractSummary | null;
  liveStatus?: ClientContractDerivedStatus;
}

type SummaryStat = {
  label: string;
  value: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const formatNumber = (locale: string, value?: number, emptyLabel: string = '—'): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return emptyLabel;
  }

  return value.toLocaleString(locale);
};

const ContractHeader: React.FC<ContractHeaderProps> = ({ contract, summary, liveStatus }) => {
  const { t } = useTranslation('msp/contracts');
  const { locale, formatDate } = useFormatters();
  // Calendar days (start/end) are pinned with toCalendarDisplayDate; updated_at is a
  // true instant and goes straight to formatDate.
  const formatCalendarDate = (value: string | Date | null | undefined, emptyLabel: string): string => {
    const displayDate = toCalendarDisplayDate(value);
    return displayDate ? formatDate(displayDate, { dateStyle: 'medium' }) : emptyLabel;
  };
  const formatBillingFrequency = useFormatBillingFrequency();
  const emptyLabel = t('common.notAvailable', { defaultValue: '—' });
  const status = liveStatus ?? contract.status;
  const stats: SummaryStat[] = [
    {
      label: t('contractHeader.labels.billingFrequency', { defaultValue: 'Billing Frequency' }),
      value: contract.billing_frequency
        ? formatBillingFrequency(contract.billing_frequency)
        : emptyLabel,
      icon: Calendar,
    },
    {
      label: t('contractHeader.labels.currency', { defaultValue: 'Currency' }),
      value: contract.currency_code || 'USD',
      icon: Coins,
    },
    {
      label: t('contractHeader.labels.contractLines', { defaultValue: 'Contract Lines' }),
      value: summary ? formatNumber(locale, summary.contractLineCount, emptyLabel) : emptyLabel,
      icon: Layers3,
    },
    {
      label: t('contractHeader.labels.startDate', { defaultValue: 'Start Date' }),
      value: summary?.earliestStartDate
        ? formatCalendarDate(summary.earliestStartDate, emptyLabel)
        : summary
          ? emptyLabel
          : emptyLabel,
      icon: Calendar,
    },
    {
      label: t('contractHeader.labels.endDate', { defaultValue: 'End Date' }),
      value: summary
        ? summary.latestEndDate
          ? formatCalendarDate(summary.latestEndDate, emptyLabel)
          : summary.totalClientAssignments > 0
            ? t('contractHeader.values.ongoing', { defaultValue: 'Ongoing' })
            : emptyLabel
        : emptyLabel,
      icon: CalendarClock,
    },
    {
      label: t('contractHeader.labels.lastUpdated', { defaultValue: 'Last Updated' }),
      value: contract.updated_at ? formatDate(contract.updated_at, { dateStyle: 'medium' }) : emptyLabel,
      icon: CalendarClock,
    },
  ];

  const hasSummary = Boolean(summary);

  return (
    <div className="w-full rounded-md border border-[rgb(var(--color-border-200))] bg-card p-4 card-elevated">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">{contract.contract_name}</h1>
          <Badge variant={
            status === 'active' ? 'success' :
            status === 'scheduled' ? 'info' :
            status === 'terminated' ? 'warning' :
            status === 'expired' ? 'error' :
            'default-muted'
          }>
            {status === 'active'
              ? t('contractHeader.status.active', { defaultValue: 'Active' })
              : status === 'scheduled'
                ? t('contractHeader.status.scheduled', { defaultValue: 'Scheduled' })
              : status === 'terminated'
                ? t('contractHeader.status.terminated', { defaultValue: 'Terminated' })
                : status === 'expired'
                  ? t('contractHeader.status.expired', { defaultValue: 'Expired' })
                  : t('contractHeader.status.draft', { defaultValue: 'Draft' })}
          </Badge>
          {contract.is_template !== false && (
            <Badge variant="info">
              {t('contractHeader.badges.template', { defaultValue: 'Template' })}
            </Badge>
          )}
          {contract.is_template === false && contract.owner_client_id && (
            <Badge variant="default-muted">
              {t('contractHeader.badges.clientOwned', { defaultValue: 'Client-owned' })}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {stats.map(({ label, value, icon: Icon }, index) => (
            <React.Fragment key={label}>
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">{label}:</span>
                <span className="font-medium text-foreground">{value}</span>
              </span>
              {index < stats.length - 1 && <span className="text-muted-foreground">•</span>}
            </React.Fragment>
          ))}
        </div>

        {contract.contract_description && (
          <p className="text-sm text-[rgb(var(--color-text-700))]">{contract.contract_description}</p>
        )}

        {hasSummary && summary?.poRequiredCount ? (
          <Alert variant="warning">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <FileCheck className="h-4 w-4" />
              <span>
                {t('contractHeader.po.requiredForContract', {
                  defaultValue: 'Purchase order required for this contract.',
                })}
              </span>
              {summary.poNumbers.length > 0 && (
                <span className="font-medium">
                  {t('contractHeader.po.prefix', { defaultValue: 'PO' })}: {summary.poNumbers.join(', ')}
                </span>
              )}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  );
};

export default ContractHeader;
