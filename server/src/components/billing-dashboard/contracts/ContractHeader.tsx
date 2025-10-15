'use client';

import React from 'react';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { IContractSummary } from 'server/src/lib/actions/contractActions';
import { Calendar, CalendarClock, Check, Copy, FileCheck, Hash, Layers3, Users } from 'lucide-react';

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
  const [copied, setCopied] = React.useState(false);

  const handleCopyContractId = async () => {
    try {
      await navigator.clipboard.writeText(contract.contract_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Unable to copy contract ID to clipboard', error);
    }
  };

  const stats: SummaryStat[] = [
    {
      label: 'Billing Frequency',
      value: formatFrequency(contract.billing_frequency),
      icon: Calendar,
    },
    {
      label: 'Contract Lines',
      value: summary ? formatNumber(summary.contractLineCount) : '—',
      icon: Layers3,
    },
    {
      label: 'Active Clients',
      value: summary ? formatNumber(summary.activeClientCount) : '—',
      icon: Users,
    },
    {
      label: 'Earliest Start',
      value: summary?.earliestStartDate ? formatDate(summary.earliestStartDate) : summary ? '—' : '—',
      icon: Calendar,
    },
    {
      label: 'Latest End',
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
    <div className="w-full rounded-md border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-gray-900">{contract.contract_name}</h1>
            <Badge className={contract.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
              {contract.is_active ? 'Active' : 'Draft'}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            <span className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span>Created {formatDate(contract.created_at)}</span>
            </span>
            {summary && (
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-400" />
                <span>Total Assignments: {formatNumber(summary.totalClientAssignments)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {stats.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-start gap-2 text-sm">
              <Icon className="mt-0.5 h-4 w-4 text-gray-400" />
              <div>
                <p className="text-gray-500">{label}</p>
                <p className="font-semibold text-gray-900">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {contract.contract_description && (
        <p className="mt-4 text-sm text-gray-700">{contract.contract_description}</p>
      )}

      {hasSummary && summary?.poRequiredCount ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <FileCheck className="h-4 w-4" />
          <span>
            {summary.poRequiredCount} assignment{summary.poRequiredCount === 1 ? '' : 's'} require a purchase order.
          </span>
          {summary.poNumbers.length > 0 && (
            <span className="font-medium text-orange-900">
              PO Numbers: {summary.poNumbers.join(', ')}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ContractHeader;
