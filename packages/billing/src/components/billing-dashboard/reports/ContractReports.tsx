'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { Badge } from '@alga-psa/ui/components/Badge';
import {
  Coins,
  Calendar,
  TrendingUp,
  Clock,
  Building2,
  AlertCircle
} from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  getContractRevenueReport,
  getContractExpirationReport,
  getBucketUsageReport,
  getProfitabilityReport,
  getContractReportSummary,
  ContractRevenue,
  ContractExpiration,
  BucketUsage,
  Profitability,
  ContractReportSummary
} from '@alga-psa/billing/actions/contractReportActions';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

const ContractReports: React.FC = () => {
  const { t } = useTranslation('msp/reports');
  const { formatCurrency, formatDate } = useFormatters();
  const [activeReport, setActiveReport] = useState('revenue');
  const [revenueData, setRevenueData] = useState<ContractRevenue[]>([]);
  const [expirationData, setExpirationData] = useState<ContractExpiration[]>([]);
  const [bucketUsageData, setBucketUsageData] = useState<BucketUsage[]>([]);
  const [profitabilityData, setProfitabilityData] = useState<Profitability[]>([]);
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

        const [revenue, expiration, bucketUsage, profitability, summaryData] = await Promise.all([
          getContractRevenueReport(),
          getContractExpirationReport(),
          getBucketUsageReport(),
          getProfitabilityReport(),
          getContractReportSummary()
        ]);

        setRevenueData(revenue);
        setExpirationData(expiration);
        setBucketUsageData(bucketUsage);
        setProfitabilityData(profitability);
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

  // Format currency
  const formatCents = (cents: number): string => {
    return formatCurrency(cents / 100, 'USD');
  };

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
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {value}
        </div>
      )
    },
    {
      title: t('contractReports.table.monthlyRecurring', { defaultValue: 'Monthly Recurring' }),
      dataIndex: 'monthly_recurring',
      render: (value: number) => <span className="font-semibold text-green-600">{formatCents(value)}</span>
    },
    {
      title: t('contractReports.table.totalBilledYtd', { defaultValue: 'Total Billed (YTD)' }),
      dataIndex: 'total_billed_ytd',
      render: (value: number) => formatCents(value)
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
          {value === 'active'
            ? t('contractReports.statusValues.active', { defaultValue: 'Active' })
            : value === 'upcoming'
              ? t('contractReports.statusValues.upcoming', { defaultValue: 'Upcoming' })
              : value.charAt(0).toUpperCase() + value.slice(1)}
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
      dataIndex: 'client_name'
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
      render: (value: number) => formatCents(value)
    },
    {
      title: t('contractReports.table.autoRenew', { defaultValue: 'Auto-Renew' }),
      dataIndex: 'auto_renew',
      render: (value: boolean) => (
        <Badge variant="secondary" className={value ? 'border-green-300 text-green-800' : 'border-[rgb(var(--color-border-300))] text-muted-foreground'}>
          {value
            ? t('contractReports.statusValues.yes', { defaultValue: 'Yes' })
            : t('contractReports.statusValues.no', { defaultValue: 'No' })}
        </Badge>
      )
    }
  ];

  // Bucket Usage Columns
  const bucketUsageColumns: ColumnDefinition<BucketUsage>[] = [
    {
      title: t('contractReports.table.contract', { defaultValue: 'Contract' }),
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: t('contractReports.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name'
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
      render: (value: number) => (
        <span className={value > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}>
          {value > 0
            ? `+${value} ${t('units.hoursShort', { defaultValue: 'hrs' })}`
            : t('units.dash', { defaultValue: '—' })}
        </span>
      )
    }
  ];

  // Profitability Columns
  const profitabilityColumns: ColumnDefinition<Profitability>[] = [
    {
      title: t('contractReports.table.contract', { defaultValue: 'Contract' }),
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: t('contractReports.table.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name'
    },
    {
      title: t('contractReports.table.revenueYtd', { defaultValue: 'Revenue (YTD)' }),
      dataIndex: 'revenue',
      render: (value: number) => formatCents(value)
    },
    {
      title: t('contractReports.table.costYtd', { defaultValue: 'Cost (YTD)' }),
      dataIndex: 'cost',
      render: (value: number) => formatCents(value)
    },
    {
      title: t('contractReports.table.profit', { defaultValue: 'Profit' }),
      dataIndex: 'profit',
      render: (value: number) => (
        <span className="font-semibold text-green-600">{formatCents(value)}</span>
      )
    },
    {
      title: t('contractReports.table.margin', { defaultValue: 'Margin' }),
      dataIndex: 'margin_percentage',
      render: (value: number) => (
        <Badge
          variant={value >= 40 ? 'success' : 'warning'}
        >
          {value}{t('units.percent', { defaultValue: '%' })}
        </Badge>
      )
    }
  ];

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

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="h-5 w-5 text-green-600" />
            <h3 className="font-semibold">
              {t('contractReports.summary.totalMRR.title', { defaultValue: 'Total MRR' })}
            </h3>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCents(summary?.totalMRR ?? 0)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('contractReports.summary.totalMRR.subtitle', { defaultValue: 'Monthly Recurring Revenue' })}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">
              {t('contractReports.summary.ytdRevenue.title', { defaultValue: 'YTD Revenue' })}
            </h3>
          </div>
          <p className="text-2xl font-bold text-blue-600">{formatCents(summary?.totalYTD ?? 0)}</p>
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
        </TabsContent>

        <TabsContent value="bucket-usage" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold">
                {t('contractReports.sections.bucketUsage.title', { defaultValue: 'Bucket Hours Utilization' })}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t('contractReports.sections.bucketUsage.description', {
                defaultValue: 'Monitor bucket hours usage and identify overage situations',
              })}
            </p>
            {bucketUsageData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t('contractReports.sections.bucketUsage.empty', { defaultValue: 'No bucket-based contracts found' })}
              </p>
            ) : (
              <DataTable
                id="bucket-usage-table"
                data={bucketUsageData}
                columns={bucketUsageColumns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
              />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="profitability" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold">
                {t('contractReports.sections.profitability.title', { defaultValue: 'Simple Profitability Report' })}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              {t('contractReports.sections.profitability.description', {
                defaultValue: 'Basic profit margins and revenue vs. cost analysis by contract',
              })}
            </p>
            {profitabilityData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {t('contractReports.sections.profitability.empty', { defaultValue: 'No profitability data available' })}
              </p>
            ) : (
              <DataTable
                id="profitability-table"
                data={profitabilityData}
                columns={profitabilityColumns}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={pageSize}
                onItemsPerPageChange={handlePageSizeChange}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ContractReports;
