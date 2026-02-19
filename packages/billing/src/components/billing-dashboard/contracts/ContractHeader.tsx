'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { IContract } from '@alga-psa/types';
import type { IContractSummary } from '@alga-psa/billing/actions/contractActions';
import { Calendar, CalendarClock, FileCheck, Layers3, Coins } from 'lucide-react';

interface ContractHeaderProps {
  contract: IContract;
  summary?: IContractSummary | null;
}

type SummaryStat = {
  label: string;
  value: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
};

const formatFrequency = (value?: string | null): string => {
  if (!value) {
    return '—';
  }

  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
};

const formatDate = (value?: string | Date | null): string => {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
};

const formatNumber = (value?: number): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }

  return value.toLocaleString();
};

const ContractHeader: React.FC<ContractHeaderProps> = ({ contract, summary }) => {
  const stats: SummaryStat[] = [
    {
      label: 'Billing Frequency',
      value: formatFrequency(contract.billing_frequency),
      icon: Calendar,
    },
    {
      label: 'Currency',
      value: contract.currency_code || 'USD',
      icon: Coins,
    },
    {
      label: 'Contract Lines',
      value: summary ? formatNumber(summary.contractLineCount) : '—',
      icon: Layers3,
    },
    {
      label: 'Start Date',
      value: summary?.earliestStartDate ? formatDate(summary.earliestStartDate) : summary ? '—' : '—',
      icon: Calendar,
    },
    {
      label: 'End Date',
      value: summary
        ? summary.latestEndDate
          ? formatDate(summary.latestEndDate)
          : summary.totalClientAssignments > 0
            ? 'Ongoing'
            : '—'
        : '—',
      icon: CalendarClock,
    },
    {
      label: 'Last Updated',
      value: formatDate(contract.updated_at),
      icon: CalendarClock,
    },
  ];

  const hasSummary = Boolean(summary);

  return (
    <div className="w-full rounded-md border border-[rgb(var(--color-border-200))] bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground">{contract.contract_name}</h1>
          <Badge variant={
            contract.status === 'active' ? 'success' :
            contract.status === 'terminated' ? 'warning' :
            contract.status === 'expired' ? 'error' :
            'default-muted'
          }>
            {contract.status === 'active' ? 'Active' :
             contract.status === 'terminated' ? 'Terminated' :
             contract.status === 'expired' ? 'Expired' :
             'Draft'}
          </Badge>
          {contract.is_template !== false && (
            <Badge variant="info">
              Template
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
                Purchase order required for this contract.
              </span>
              {summary.poNumbers.length > 0 && (
                <span className="font-medium">
                  PO: {summary.poNumbers.join(', ')}
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
