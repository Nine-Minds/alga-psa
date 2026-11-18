'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { Card } from '@alga-psa/ui/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import ClientNameCell from '@alga-psa/ui/components/ClientNameCell';
import { ColumnDefinition } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Coins,
  Calendar,
  TrendingUp,
  Clock,
  Building2,
  AlertCircle,
  Settings2,
  RotateCcw
} from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@alga-psa/ui/components/DropdownMenu';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import {
  getContractRevenueReport,
  getContractExpirationReport,
  getBucketUsageReport,
  getHourBlockUsageReport,
  getContractReportSummary,
  ContractRevenue,
  ContractExpiration,
  BucketUsage,
  HourBlockUsage,
  ContractReportSummary
} from '@alga-psa/billing/actions/contractReportActions';
import type { CurrencyAmount } from '@alga-psa/shared/billingClients/contractMonthlyValue';
import { PrintButton } from '@alga-psa/ui/components/PrintButton';
import { PrintableDetailHeader } from '@alga-psa/ui/components/PrintableDetailHeader';
import { PrintableSummary } from '@alga-psa/ui/components/PrintableSummary';
import { PrintableTable, type PrintableTableColumn } from '@alga-psa/ui/components/PrintableTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import ProfitabilityReport from './ProfitabilityReport';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

const isReturnedActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

type Translator = ReturnType<typeof useTranslation>['t'];

const statusLabel = (value: string, t: Translator): string => (
  value === 'active'
    ? t('contractReports.statusValues.active', { defaultValue: 'Active' })
    : value === 'upcoming'
      ? t('contractReports.statusValues.upcoming', { defaultValue: 'Upcoming' })
      : value.charAt(0).toUpperCase() + value.slice(1)
);

const hourBlockStatusLabel = (value: string, t: Translator): string => (
  value === 'active'
    ? t('contractReports.statusValues.active', { defaultValue: 'Active' })
    : value === 'expired'
      ? t('contractReports.statusValues.expired', { defaultValue: 'Expired' })
      : value === 'voided'
        ? t('contractReports.statusValues.voided', { defaultValue: 'Voided' })
        : value.charAt(0).toUpperCase() + value.slice(1)
);

const yesNoLabel = (value: boolean, t: Translator): string => (
  value
    ? t('contractReports.statusValues.yes', { defaultValue: 'Yes' })
    : t('contractReports.statusValues.no', { defaultValue: 'No' })
);

// Combined Bucket Hours Utilization row: weighted-bucket pool rows plus issued
// prepaid hour-block rows, discriminated by row_kind. Pool rows render dashes
// for block-only fields and vice versa.
type BucketUsageRow = Omit<BucketUsage, 'contract_name' | 'overage_hours'> & Partial<HourBlockUsage> & {
  contract_name: string | null;
  overage_hours?: number;
  row_kind: 'pool' | 'block';
  id: string;
};

// User preference: per-column visibility the user chose in the Bucket Hours
// Utilization table. Only columns listed here override the content defaults.
const BUCKET_USAGE_COLUMNS_PREF_KEY = 'billing.reports.bucketUsage.columnVisibility';

type BucketUsageStatusFilter = 'all' | 'active' | 'expired' | 'voided';

const ContractReports: React.FC = () => {
  const { t } = useTranslation('msp/reports');
  const { formatCurrency, formatDate, locale } = useFormatters();
  const { currencyCode: tenantCurrency } = useCurrencyFormat();
  const [activeReport, setActiveReport] = useState('revenue');
  const [revenueData, setRevenueData] = useState<ContractRevenue[]>([]);
  const [expirationData, setExpirationData] = useState<ContractExpiration[]>([]);
  const [bucketUsageData, setBucketUsageData] = useState<BucketUsage[]>([]);
  const [hourBlockUsageData, setHourBlockUsageData] = useState<HourBlockUsage[]>([]);
  const [summary, setSummary] = useState<ContractReportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Load report data on component mount
  useEffect(() => {
    const loadReportData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const [revenue, expiration, bucketUsage, hourBlockUsage, summaryData] = await Promise.all([
          getContractRevenueReport(),
          getContractExpirationReport(),
          getBucketUsageReport(),
          getHourBlockUsageReport(),
          getContractReportSummary()
        ]);
        const expectedLoadError = [revenue, expiration, bucketUsage, hourBlockUsage, summaryData].find(isReturnedActionError);
        if (expectedLoadError) {
          setError(getErrorMessage(expectedLoadError));
          return;
        }

        setRevenueData(revenue);
        setExpirationData(expiration);
        setBucketUsageData(bucketUsage);
        setHourBlockUsageData(hourBlockUsage);
        setSummary(summaryData);
      } catch (err) {
        console.error('Error loading report data:', err);
        setError(
          err instanceof Error
            ? err.message
            : t('contractReports.errors.loadData', { defaultValue: 'Failed to load report data' })
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadReportData();
  }, [t]);

  // Format minor units in a specific contract currency; the tenant currency is
  // only a fallback for rows that carry no currency of their own.
  // Block values are minor units of the block's own currency, so the currency's exponent applies.
  const formatBlockMinor = (minor: number, currencyCode?: string | null): string =>
    formatCurrencyFromMinorUnits(minor, locale, currencyCode || tenantCurrency);

  const formatCents = (cents: number, currencyCode?: string | null): string => {
    return formatCurrency(cents / 100, currencyCode || tenantCurrency);
  };

  // One label per currency — currencies are never summed into a single number.
  const currencyAmountsLabel = (amounts: CurrencyAmount[] | undefined): string => {
    if (!amounts || amounts.length === 0) {
      return formatCents(0);
    }
    return amounts.map((amount) => formatCents(amount.totalCents, amount.currencyCode)).join(' · ');
  };

  const variableUsageOnlyLabel = t('contractReports.table.variableUsage', { defaultValue: 'Variable usage' });

  // Revenue Report Columns
  const revenueColumns: ColumnDefinition<ContractRevenue>[] = [
    {
      title: t('contractReports.table.contract', { defaultValue: 'Contract' }),
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: t('contractReports.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value, record) => <ClientNameCell clientName={value as string | null | undefined} clientId={record.client_id} logoUrl={record.logoUrl ?? null} />
    },
    {
      title: t('contractReports.table.monthlyRecurring', { defaultValue: 'Monthly Recurring' }),
      dataIndex: 'monthly_recurring',
      // Usage revenue is variable (billed from recorded usage), so it is
      // labeled instead of misstated as part of a fixed recurring amount. A
      // pure-usage contract shows "Variable usage", never a fixed zero.
      render: (value: number, record) => (
        record.has_variable_usage && value === 0 ? (
          <span className="text-muted-foreground">{variableUsageOnlyLabel}</span>
        ) : (
          <span className="font-semibold text-green-600 dark:text-green-400">
            {formatCents(value, record.currency_code)}
            {record.has_variable_usage && (
              <span className="ml-1 font-normal text-muted-foreground">
                {t('contractReports.table.plusVariableUsage', { defaultValue: '+ variable usage' })}
              </span>
            )}
          </span>
        )
      )
    },
    {
      title: t('contractReports.table.totalBilledYtd', { defaultValue: 'Total Billed (YTD)' }),
      dataIndex: 'total_billed_ytd',
      render: (value: number, record) => formatCents(value, record.currency_code)
    },
    {
      title: t('contractReports.table.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (value: string) => (
        <Badge
          variant={
            value === 'active' ? 'success' :
            value === 'upcoming' ? 'info' :
            'default-muted'
          }
        >
          {statusLabel(value, t)}
        </Badge>
      )
    }
  ];

  // Expiration Report Columns
  const expirationColumns: ColumnDefinition<ContractExpiration>[] = [
    {
      title: t('contractReports.table.contract', { defaultValue: 'Contract' }),
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: t('contractReports.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value, record) => <ClientNameCell clientName={value as string | null | undefined} clientId={record.client_id} logoUrl={record.logoUrl ?? null} />
    },
    {
      title: t('contractReports.table.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      render: (value: string) => formatDate(value)
    },
    {
      title: t('contractReports.table.daysUntilExpiration', { defaultValue: 'Days Until Expiration' }),
      dataIndex: 'days_until_expiration',
      render: (value: number) => (
        <span className={value <= 30 ? 'text-red-600 font-semibold' : value <= 60 ? 'text-amber-600' : ''}>
          {value} {t('units.days', { defaultValue: 'days' })}
        </span>
      )
    },
    {
      title: t('contractReports.table.monthlyValue', { defaultValue: 'Monthly Value' }),
      dataIndex: 'monthly_value',
      render: (value: number, record) => (
        record.has_variable_usage && value === 0 ? (
          <span className="text-muted-foreground">{variableUsageOnlyLabel}</span>
        ) : (
          <span>
            {formatCents(value, record.currency_code)}
            {record.has_variable_usage && (
              <span className="ml-1 text-muted-foreground">
                {t('contractReports.table.plusVariableUsage', { defaultValue: '+ variable usage' })}
              </span>
            )}
          </span>
        )
      )
    },
    {
      title: t('contractReports.table.autoRenew', { defaultValue: 'Auto-Renew' }),
      dataIndex: 'auto_renew',
      render: (value: boolean) => (
        <Badge variant="secondary" className={value ? 'border-green-300 text-green-800' : 'border-[rgb(var(--color-border-300))] text-muted-foreground'}>
          {yesNoLabel(value, t)}
        </Badge>
      )
    }
  ];

  // Combined Bucket Hours Utilization rows: weighted pools first, then issued
  // prepaid blocks. 'id' is what DataTable uses as the stable row key.
  const bucketUsageRows: BucketUsageRow[] = useMemo(() => {
    const poolRows: BucketUsageRow[] = bucketUsageData.map((row) => ({
      ...row,
      row_kind: 'pool' as const,
      id: `pool-${row.client_id ?? ''}-${row.contract_name}`
    }));
    const blockRows: BucketUsageRow[] = hourBlockUsageData.map((row) => ({
      ...row,
      contract_name: row.contract_name ?? null,
      overage_hours: undefined,
      row_kind: 'block' as const,
      id: `block-${row.block_id}`
    }));
    return [...poolRows, ...blockRows];
  }, [bucketUsageData, hourBlockUsageData]);

  const hasPoolRows = bucketUsageData.length > 0;
  const hasBlockRows = hourBlockUsageData.length > 0;

  // Block-status filter for the table. Bucket pools are live by definition, so
  // they show under 'all' and 'active' and drop out of the expired/voided views.
  const [bucketUsageStatusFilter, setBucketUsageStatusFilter] = useState<BucketUsageStatusFilter>('all');

  const bucketUsageStatusOptions = useMemo(() => [
    { value: 'all', label: t('contractReports.statusValues.all', { defaultValue: 'All statuses' }) },
    { value: 'active', label: t('contractReports.statusValues.active', { defaultValue: 'Active' }) },
    { value: 'expired', label: t('contractReports.statusValues.expired', { defaultValue: 'Expired' }) },
    { value: 'voided', label: t('contractReports.statusValues.voided', { defaultValue: 'Voided' }) },
  ], [t]);

  const visibleBucketUsageRows = useMemo(() => (
    bucketUsageStatusFilter === 'all'
      ? bucketUsageRows
      : bucketUsageRows.filter((row) => (
        row.row_kind === 'block'
          ? row.status === bucketUsageStatusFilter
          : bucketUsageStatusFilter === 'active'
      ))
  ), [bucketUsageRows, bucketUsageStatusFilter]);

  // Per-column visibility the user chose, persisted server-side per user (like
  // the client list view preferences). A column the user never touched follows
  // its content default below; one the user set keeps the user's choice.
  const { value: userColumnVisibility, setValue: setUserColumnVisibility } = useUserPreference<Record<string, boolean>>(
    BUCKET_USAGE_COLUMNS_PREF_KEY,
    { defaultValue: {}, localStorageKey: BUCKET_USAGE_COLUMNS_PREF_KEY, debounceMs: 300 }
  );
  const userOverrides = useMemo<Record<string, boolean>>(
    () => (userColumnVisibility && typeof userColumnVisibility === 'object' && !Array.isArray(userColumnVisibility)
      ? userColumnVisibility
      : {}),
    [userColumnVisibility]
  );

  // Columns the menu offers, in table order. Client and Contract are not
  // offered: they anchor every row and are always shown. defaultVisible for the
  // rest: Overage only when the table holds bucket pools; block columns only
  // when it holds prepaid blocks.
  const bucketUsageColumnOptions = useMemo(() => [
    { id: 'service_name', titleKey: 'contractReports.table.service', fallback: 'Service', defaultVisible: hasBlockRows },
    { id: 'total_hours', titleKey: 'contractReports.table.totalHours', fallback: 'Total Hours', defaultVisible: true },
    { id: 'used_hours', titleKey: 'contractReports.table.usedHours', fallback: 'Used Hours', defaultVisible: true },
    { id: 'remaining_hours', titleKey: 'contractReports.table.remaining', fallback: 'Remaining', defaultVisible: true },
    { id: 'utilization_percentage', titleKey: 'contractReports.table.utilization', fallback: 'Utilization', defaultVisible: true },
    { id: 'overage_hours', titleKey: 'contractReports.table.overage', fallback: 'Overage', defaultVisible: hasPoolRows },
    { id: 'hourly_rate', titleKey: 'contractReports.table.hourlyRate', fallback: 'Rate / hr', defaultVisible: hasBlockRows },
    { id: 'remaining_value', titleKey: 'contractReports.table.remainingValue', fallback: 'Remaining value', defaultVisible: hasBlockRows },
    { id: 'valid_from', titleKey: 'contractReports.table.validFrom', fallback: 'Valid from', defaultVisible: hasBlockRows },
    { id: 'expiration_date', titleKey: 'contractReports.table.expirationDate', fallback: 'Expires', defaultVisible: hasBlockRows },
    { id: 'status', titleKey: 'contractReports.table.status', fallback: 'Status', defaultVisible: hasBlockRows },
  ], [hasPoolRows, hasBlockRows]);

  const bucketUsageVisibility = useMemo(() => {
    const visibility: Record<string, boolean> = { client_name: true, contract_name: true };
    for (const option of bucketUsageColumnOptions) {
      const override = userOverrides[option.id];
      visibility[option.id] = typeof override === 'boolean' ? override : option.defaultVisible;
    }
    return visibility;
  }, [bucketUsageColumnOptions, userOverrides]);

  const hasColumnOverrides = Object.keys(userOverrides).length > 0;

  const toggleBucketUsageColumn = (columnId: string, visible: boolean) => {
    setUserColumnVisibility((prev) => ({
      ...(prev && typeof prev === 'object' && !Array.isArray(prev) ? prev : {}),
      [columnId]: visible
    }));
  };

  const blockStatusBadge = (value: string) => (
    <Badge
      variant={
        value === 'active' ? 'success' :
        value === 'expired' ? 'error' :
        'default-muted'
      }
    >
      {hourBlockStatusLabel(value, t)}
    </Badge>
  );

  const dash = <span className="text-muted-foreground">{t('units.dash', { defaultValue: '—' })}</span>;

  // Combined Bucket Hours Utilization Columns (weighted pools + prepaid blocks)
  const bucketUsageColumns: ColumnDefinition<BucketUsageRow>[] = [
    {
      title: t('contractReports.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value, record) => <ClientNameCell clientName={value as string | null | undefined} clientId={record.client_id} logoUrl={record.logoUrl ?? null} />
    },
    {
      title: t('contractReports.table.contract', { defaultValue: 'Contract' }),
      dataIndex: 'contract_name',
      render: (value: string | null, record) => record.row_kind === 'block' && !value
        ? <span className="text-muted-foreground">{t('contractReports.table.adhocBlock', { defaultValue: 'Ad-hoc' })}</span>
        : value
          ? <span className="font-medium">{value}</span>
          : dash
    },
    {
      title: t('contractReports.table.service', { defaultValue: 'Service' }),
      dataIndex: 'service_name',
      render: (value: string | undefined, record) => record.row_kind === 'block' && value
        ? <span className="font-medium">{value}</span>
        : dash
    },
    {
      title: t('contractReports.table.totalHours', { defaultValue: 'Total Hours' }),
      dataIndex: 'total_hours',
      render: (value: number) => `${value} ${t('units.hoursShort', { defaultValue: 'hrs' })}`
    },
    {
      title: t('contractReports.table.usedHours', { defaultValue: 'Used Hours' }),
      dataIndex: 'used_hours',
      render: (value: number) => `${value} ${t('units.hoursShort', { defaultValue: 'hrs' })}`
    },
    {
      title: t('contractReports.table.remaining', { defaultValue: 'Remaining' }),
      dataIndex: 'remaining_hours',
      render: (value: number) => (
        <span className={value === 0 ? 'text-red-600 font-semibold' : ''}>
          {value} {t('units.hoursShort', { defaultValue: 'hrs' })}
        </span>
      )
    },
    {
      title: t('contractReports.table.utilization', { defaultValue: 'Utilization' }),
      dataIndex: 'utilization_percentage',
      render: (value: number) => (
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-[rgb(var(--color-border-200))] rounded-full h-2 max-w-[100px]">
            <div
              className={`h-2 rounded-full ${value > 100 ? 'bg-destructive' : value > 80 ? 'bg-warning' : 'bg-success'}`}
              style={{ width: `${Math.min(value, 100)}%` }}
            />
          </div>
          <span className={`text-sm font-medium ${value > 100 ? 'text-destructive' : ''}`}>
            {value}{t('units.percent', { defaultValue: '%' })}
          </span>
        </div>
      )
    },
    {
      title: t('contractReports.table.overage', { defaultValue: 'Overage' }),
      dataIndex: 'overage_hours',
      render: (value: number | undefined) => value == null ? dash : (
        <span className={value > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}>
          {value > 0
            ? `+${value} ${t('units.hoursShort', { defaultValue: 'hrs' })}`
            : t('units.dash', { defaultValue: '—' })}
        </span>
      )
    },
    {
      title: t('contractReports.table.hourlyRate', { defaultValue: 'Rate / hr' }),
      dataIndex: 'hourly_rate',
      render: (value: number | undefined, record) => record.row_kind === 'block' && value != null
        ? formatBlockMinor(value, record.currency_code)
        : dash
    },
    {
      title: t('contractReports.table.remainingValue', { defaultValue: 'Remaining value' }),
      dataIndex: 'remaining_value',
      render: (value: number | undefined, record) => record.row_kind === 'block' && value != null
        ? formatBlockMinor(value, record.currency_code)
        : dash
    },
    {
      title: t('contractReports.table.validFrom', { defaultValue: 'Valid from' }),
      dataIndex: 'valid_from',
      render: (value: string | null | undefined, record) => record.row_kind !== 'block' || !value ? dash : formatDate(value)
    },
    {
      title: t('contractReports.table.expirationDate', { defaultValue: 'Expires' }),
      dataIndex: 'expiration_date',
      render: (value: string | null | undefined, record) => record.row_kind !== 'block'
        ? dash
        : value
          ? formatDate(value)
          : <span className="text-muted-foreground">{t('contractReports.table.neverExpires', { defaultValue: 'Never' })}</span>
    },
    {
      title: t('contractReports.table.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (value: string | undefined, record) => record.row_kind === 'block' && value ? blockStatusBadge(value) : dash
    }
  ];

  // Print columns mirror the on-screen tables but drop badges/bars and render every
  // row — the screen tables paginate.
  const revenuePrintColumns: PrintableTableColumn<ContractRevenue>[] = [
    { key: 'contract', header: t('contractReports.table.contract', { defaultValue: 'Contract' }), render: (row) => row.contract_name },
    { key: 'client', header: t('contractReports.table.client', { defaultValue: 'Client' }), render: (row) => row.client_name },
    {
      key: 'mrr',
      header: t('contractReports.table.monthlyRecurring', { defaultValue: 'Monthly Recurring' }),
      render: (row) => (row.has_variable_usage
        ? (row.monthly_recurring === 0
          ? variableUsageOnlyLabel
          : `${formatCents(row.monthly_recurring, row.currency_code)} ${t('contractReports.table.plusVariableUsage', { defaultValue: '+ variable usage' })}`)
        : formatCents(row.monthly_recurring, row.currency_code)),
    },
    { key: 'ytd', header: t('contractReports.table.totalBilledYtd', { defaultValue: 'Total Billed (YTD)' }), render: (row) => formatCents(row.total_billed_ytd, row.currency_code) },
    { key: 'status', header: t('contractReports.table.status', { defaultValue: 'Status' }), render: (row) => statusLabel(row.status, t) },
  ];

  const expirationPrintColumns: PrintableTableColumn<ContractExpiration>[] = [
    { key: 'contract', header: t('contractReports.table.contract', { defaultValue: 'Contract' }), render: (row) => row.contract_name },
    { key: 'client', header: t('contractReports.table.client', { defaultValue: 'Client' }), render: (row) => row.client_name },
    { key: 'endDate', header: t('contractReports.table.endDate', { defaultValue: 'End Date' }), render: (row) => formatDate(row.end_date) },
    {
      key: 'daysUntil',
      header: t('contractReports.table.daysUntilExpiration', { defaultValue: 'Days Until Expiration' }),
      render: (row) => `${row.days_until_expiration} ${t('units.days', { defaultValue: 'days' })}`,
    },
    {
      key: 'monthlyValue',
      header: t('contractReports.table.monthlyValue', { defaultValue: 'Monthly Value' }),
      render: (row) => (row.has_variable_usage
        ? (row.monthly_value === 0
          ? variableUsageOnlyLabel
          : `${formatCents(row.monthly_value, row.currency_code)} ${t('contractReports.table.plusVariableUsage', { defaultValue: '+ variable usage' })}`)
        : formatCents(row.monthly_value, row.currency_code)),
    },
    { key: 'autoRenew', header: t('contractReports.table.autoRenew', { defaultValue: 'Auto-Renew' }), render: (row) => yesNoLabel(row.auto_renew, t) },
  ];

  // Keys match the screen table's column ids so one visibility map drives both.
  const bucketUsagePrintColumns: PrintableTableColumn<BucketUsageRow>[] = [
    { key: 'client_name', header: t('contractReports.table.client', { defaultValue: 'Client' }), render: (row) => row.client_name },
    { key: 'contract_name', header: t('contractReports.table.contract', { defaultValue: 'Contract' }), render: (row) => row.contract_name ?? (row.row_kind === 'block' ? t('contractReports.table.adhocBlock', { defaultValue: 'Ad-hoc' }) : t('units.dash', { defaultValue: '—' })) },
    { key: 'service_name', header: t('contractReports.table.service', { defaultValue: 'Service' }), render: (row) => row.row_kind === 'block' ? (row.service_name ?? t('units.dash', { defaultValue: '—' })) : t('units.dash', { defaultValue: '—' }) },
    { key: 'total_hours', header: t('contractReports.table.totalHours', { defaultValue: 'Total Hours' }), render: (row) => `${row.total_hours} ${t('units.hoursShort', { defaultValue: 'hrs' })}` },
    { key: 'used_hours', header: t('contractReports.table.usedHours', { defaultValue: 'Used Hours' }), render: (row) => `${row.used_hours} ${t('units.hoursShort', { defaultValue: 'hrs' })}` },
    { key: 'remaining_hours', header: t('contractReports.table.remaining', { defaultValue: 'Remaining' }), render: (row) => `${row.remaining_hours} ${t('units.hoursShort', { defaultValue: 'hrs' })}` },
    { key: 'utilization_percentage', header: t('contractReports.table.utilization', { defaultValue: 'Utilization' }), render: (row) => `${row.utilization_percentage}${t('units.percent', { defaultValue: '%' })}` },
    {
      key: 'overage_hours',
      header: t('contractReports.table.overage', { defaultValue: 'Overage' }),
      render: (row) => (row.overage_hours != null && row.overage_hours > 0
        ? `+${row.overage_hours} ${t('units.hoursShort', { defaultValue: 'hrs' })}`
        : t('units.dash', { defaultValue: '—' })),
    },
    { key: 'hourly_rate', header: t('contractReports.table.hourlyRate', { defaultValue: 'Rate / hr' }), render: (row) => row.row_kind === 'block' && row.hourly_rate != null ? formatBlockMinor(row.hourly_rate, row.currency_code) : t('units.dash', { defaultValue: '—' }) },
    { key: 'remaining_value', header: t('contractReports.table.remainingValue', { defaultValue: 'Remaining value' }), render: (row) => row.row_kind === 'block' && row.remaining_value != null ? formatBlockMinor(row.remaining_value, row.currency_code) : t('units.dash', { defaultValue: '—' }) },
    { key: 'valid_from', header: t('contractReports.table.validFrom', { defaultValue: 'Valid from' }), render: (row) => row.row_kind === 'block' && row.valid_from ? formatDate(row.valid_from) : t('units.dash', { defaultValue: '—' }) },
    { key: 'expiration_date', header: t('contractReports.table.expirationDate', { defaultValue: 'Expires' }), render: (row) => row.row_kind !== 'block' ? t('units.dash', { defaultValue: '—' }) : row.expiration_date ? formatDate(row.expiration_date) : t('contractReports.table.neverExpires', { defaultValue: 'Never' }) },
    { key: 'status', header: t('contractReports.table.status', { defaultValue: 'Status' }), render: (row) => row.row_kind === 'block' && row.status ? hourBlockStatusLabel(row.status, t) : t('units.dash', { defaultValue: '—' }) },
  ];

  const visibleBucketUsagePrintColumns = bucketUsagePrintColumns.filter(
    (column) => bucketUsageVisibility[column.key] !== false
  );

  const printSummaryMetrics = [
    { label: t('contractReports.summary.totalMRR.title', { defaultValue: 'Fixed MRR' }), value: currencyAmountsLabel(summary?.fixedMrrByCurrency) },
    { label: t('contractReports.summary.ytdRevenue.title', { defaultValue: 'YTD Revenue' }), value: currencyAmountsLabel(summary?.ytdRevenueByCurrency) },
    { label: t('contractReports.summary.activeContracts.title', { defaultValue: 'Active Contracts' }), value: summary?.activeContractCount ?? 0 },
    { label: t('contractReports.summary.renewalDecisions.title', { defaultValue: 'Renewal Decisions Due' }), value: summary?.atRiskDecisionCount ?? 0 },
  ];

  // Plain function, not a component: keeps the print markup out of the render tree's identity.
  const printRoot = (id: string, title: string, subtitle: string, table: React.ReactNode) => (
    <div className="app-print-root app-print-only" id={id}>
      <PrintableDetailHeader title={title} subtitle={subtitle} />
      <PrintableSummary metrics={printSummaryMetrics} />
      {table}
    </div>
  );

  // Show loading state
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={`summary-skeleton-${index}`} className="p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-3 w-28" />
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className="h-5 w-48" />
          </div>

          <div className="mb-4">
            <Skeleton className="h-4 w-64" />
          </div>

          <div className="flex gap-2 mb-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`tab-pill-${index}`} className="h-8 w-28 rounded-full" />
            ))}
          </div>

          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={`table-row-${index}`} className="h-4 w-full rounded" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold mb-2">
            {t('contractReports.title', { defaultValue: 'Contract Reports' })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('contractReports.description', {
              defaultValue: 'Analyze contract performance, revenue, and utilization metrics',
            })}
          </p>
        </div>

        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-semibold mb-1">
              {t('contractReports.errors.loadingTitle', { defaultValue: 'Error Loading Reports' })}
            </p>
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-2">
            {t('contractReports.title', { defaultValue: 'Contract Reports' })}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('contractReports.description', {
              defaultValue: 'Analyze contract performance, revenue, and utilization metrics',
            })}
          </p>
        </div>
        {/* Profitability carries its own print button — it owns its date filters and load state. */}
        {activeReport !== 'profitability' && (
          <PrintButton id="contract-reports-print" size="sm" variant="outline" />
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="h-5 w-5 text-green-600" />
            <h3 className="font-semibold">
              {t('contractReports.summary.totalMRR.title', { defaultValue: 'Fixed MRR' })}
            </h3>
          </div>
          {(summary?.fixedMrrByCurrency?.length ?? 0) > 1 ? (
            <div data-testid="fixed-mrr-by-currency">
              {summary!.fixedMrrByCurrency.map((amount) => (
                <p key={amount.currencyCode} className="text-xl font-bold text-green-600">
                  {formatCents(amount.totalCents, amount.currencyCode)}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-2xl font-bold text-green-600" data-testid="fixed-mrr-by-currency">
              {currencyAmountsLabel(summary?.fixedMrrByCurrency)}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {t('contractReports.summary.totalMRR.subtitle', { defaultValue: 'Fixed Monthly Recurring Revenue of active contracts' })}
          </p>
          {(summary?.variableUsageContractCount ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground mt-1" data-testid="mrr-variable-usage-note">
              {t('contractReports.summary.totalMRR.variableUsageNote', {
                count: summary?.variableUsageContractCount ?? 0,
                defaultValue: '{{count}} active contracts also bill variable usage (not included)',
              })}
            </p>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">
              {t('contractReports.summary.ytdRevenue.title', { defaultValue: 'YTD Revenue' })}
            </h3>
          </div>
          {(summary?.ytdRevenueByCurrency?.length ?? 0) > 1 ? (
            <div data-testid="ytd-revenue-by-currency">
              {summary!.ytdRevenueByCurrency.map((amount) => (
                <p key={amount.currencyCode} className="text-xl font-bold text-blue-600">
                  {formatCents(amount.totalCents, amount.currencyCode)}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-2xl font-bold text-blue-600" data-testid="ytd-revenue-by-currency">
              {currencyAmountsLabel(summary?.ytdRevenueByCurrency)}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {t('contractReports.summary.ytdRevenue.subtitle', { defaultValue: 'Year to Date by billed service period' })}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold">
              {t('contractReports.summary.activeContracts.title', { defaultValue: 'Active Contracts' })}
            </h3>
          </div>
          <p className="text-2xl font-bold text-purple-600">{summary?.activeContractCount ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('contractReports.summary.activeContracts.subtitle', { defaultValue: 'Active assignments' })}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold">
              {t('contractReports.summary.renewalDecisions.title', { defaultValue: 'Renewal Decisions Due' })}
            </h3>
          </div>
          <p className="text-2xl font-bold text-amber-600">{summary?.atRiskDecisionCount ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('contractReports.summary.renewalDecisions.subtitle', { defaultValue: 'Decision due dates in the next 90 days' })}
          </p>
        </Card>
      </div>

      {/* Report Tabs */}
      <Tabs value={activeReport} onValueChange={setActiveReport}>
        <TabsList>
          <TabsTrigger value="revenue">{t('contractReports.tabs.revenue', { defaultValue: 'Contract Revenue' })}</TabsTrigger>
          <TabsTrigger value="expiration">{t('contractReports.tabs.expiration', { defaultValue: 'Expiration' })}</TabsTrigger>
          <TabsTrigger value="bucket-usage">{t('contractReports.tabs.bucketUsage', { defaultValue: 'Bucket Hours' })}</TabsTrigger>
          <TabsTrigger value="profitability">{t('contractReports.tabs.profitability', { defaultValue: 'Profitability' })}</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Coins className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold">
                {t('contractReports.sections.revenue.title', { defaultValue: 'Contract Revenue Report' })}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t('contractReports.sections.revenue.description', {
                defaultValue: 'Overview of monthly recurring revenue and year-to-date billed service periods by contract.',
              })}
            </p>
            {revenueData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t('contractReports.sections.revenue.empty', { defaultValue: 'No contract revenue data available' })}
              </p>
            ) : (
              <DataTable
                id="contract-reports-table"
                data={revenueData}
                columns={revenueColumns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
              />
            )}
          </Card>
          {printRoot(
            'contract-revenue-print',
            t('contractReports.sections.revenue.title', { defaultValue: 'Contract Revenue Report' }),
            t('contractReports.sections.revenue.description', {
              defaultValue: 'Overview of monthly recurring revenue and year-to-date billed service periods by contract.',
            }),
            <PrintableTable
              rows={revenueData}
              columns={revenuePrintColumns}
              getRowKey={(row) => `${row.contract_name}-${row.client_id ?? ''}`}
              emptyMessage={t('contractReports.sections.revenue.empty', { defaultValue: 'No contract revenue data available' })}
            />
          )}
        </TabsContent>

        <TabsContent value="expiration" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="h-5 w-5 text-amber-600" />
              <h3 className="text-lg font-semibold">
                {t('contractReports.sections.expiration.title', {
                  defaultValue: 'Contract Expiration and Renewal Decisions',
                })}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t('contractReports.sections.expiration.description', {
                defaultValue: 'Track upcoming contract expirations and renewal decision due dates.',
              })}
            </p>
            {expirationData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t('contractReports.sections.expiration.empty', {
                  defaultValue: 'No upcoming contract expirations or renewal decisions in the near term',
                })}
              </p>
            ) : (
              <DataTable
                id="contract-expiration-table"
                data={expirationData}
                columns={expirationColumns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
              />
            )}
          </Card>
          {printRoot(
            'contract-expiration-print',
            t('contractReports.sections.expiration.title', { defaultValue: 'Contract Expiration and Renewal Decisions' }),
            t('contractReports.sections.expiration.description', {
              defaultValue: 'Track upcoming contract expirations and renewal decision due dates.',
            }),
            <PrintableTable
              rows={expirationData}
              columns={expirationPrintColumns}
              getRowKey={(row) => `${row.contract_name}-${row.client_id ?? ''}-${row.end_date}`}
              emptyMessage={t('contractReports.sections.expiration.empty', {
                defaultValue: 'No upcoming contract expirations or renewal decisions in the near term',
              })}
            />
          )}
        </TabsContent>

        <TabsContent value="bucket-usage" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold">
                {t('contractReports.sections.bucketUsage.title', { defaultValue: 'Bucket Hours Utilization' })}
              </h3>
              <div className="ml-auto flex items-center gap-2">
                <CustomSelect
                  id="bucket-usage-status-filter"
                  value={bucketUsageStatusFilter}
                  options={bucketUsageStatusOptions}
                  placeholder={t('contractReports.statusValues.all', { defaultValue: 'All statuses' })}
                  onValueChange={(value) => {
                    setBucketUsageStatusFilter(value as BucketUsageStatusFilter);
                    setCurrentPage(1);
                  }}
                  className="min-w-[150px]"
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id="bucket-usage-columns-trigger"
                      variant="outline"
                      className="flex items-center gap-1.5 h-[38px]"
                    >
                      <Settings2 className="h-4 w-4" />
                      {t('contractReports.columnsMenu.label', { defaultValue: 'Columns' })}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 p-0">
                    <div className="px-3 py-2 border-b border-gray-100 dark:border-[rgb(var(--color-border-200))]">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]">
                        {t('contractReports.columnsMenu.title', { defaultValue: 'Columns' })}
                      </div>
                    </div>
                    <div className="max-h-[260px] overflow-y-auto py-1">
                      {bucketUsageColumnOptions.map((option) => {
                        const checked = bucketUsageVisibility[option.id] !== false;
                        return (
                          <div key={option.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                            <Checkbox
                              id={`bucket-usage-column-toggle-${option.id}`}
                              checked={checked}
                              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                                toggleBucketUsageColumn(option.id, event.target.checked)
                              }
                              className="m-0"
                              skipRegistration
                            />
                            <span className="truncate">
                              {t(option.titleKey, { defaultValue: option.fallback })}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {hasColumnOverrides && (
                      <div className="border-t border-gray-100 dark:border-[rgb(var(--color-border-200))] py-1">
                        <button
                          type="button"
                          id="bucket-usage-columns-reset"
                          onClick={() => setUserColumnVisibility({})}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[rgb(var(--color-border-50))]"
                        >
                          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                          {t('contractReports.columnsMenu.reset', { defaultValue: 'Reset to default columns' })}
                        </button>
                      </div>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t('contractReports.sections.bucketUsage.description', {
                defaultValue: 'Monitor bucket hours usage and identify overage situations. Prepaid hour blocks (contract-issued and ad-hoc) are listed with their burn-down.',
              })}
            </p>
            {visibleBucketUsageRows.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t('contractReports.sections.bucketUsage.empty', { defaultValue: 'No bucket-based contracts found' })}
              </p>
            ) : (
              <DataTable
                id="bucket-usage-table"
                data={visibleBucketUsageRows}
                columns={bucketUsageColumns}
                columnVisibility={bucketUsageVisibility}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
              />
            )}
          </Card>
          {printRoot(
            'bucket-usage-print',
            t('contractReports.sections.bucketUsage.title', { defaultValue: 'Bucket Hours Utilization' }),
            t('contractReports.sections.bucketUsage.description', {
              defaultValue: 'Monitor bucket hours usage and identify overage situations. Prepaid hour blocks (contract-issued and ad-hoc) are listed with their burn-down.',
            }),
            <PrintableTable
              rows={visibleBucketUsageRows}
              columns={visibleBucketUsagePrintColumns}
              getRowKey={(row) => row.id}
              emptyMessage={t('contractReports.sections.bucketUsage.empty', { defaultValue: 'No bucket-based contracts found' })}
            />
          )}
        </TabsContent>

        <TabsContent value="profitability" className="mt-4">
          <ProfitabilityReport />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContractReports;
