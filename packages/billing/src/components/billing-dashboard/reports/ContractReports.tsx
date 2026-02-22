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

const ContractReports: React.FC = () => {
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
        setError(err instanceof Error ? err.message : 'Failed to load report data');
      } finally {
        setIsLoading(false);
      }
    };

    loadReportData();
  }, []);

  // Format currency
  const formatCurrency = (cents: number): string => {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Revenue Report Columns
  const revenueColumns: ColumnDefinition<ContractRevenue>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value: string) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {value}
        </div>
      )
    },
    {
      title: 'Monthly Recurring',
      dataIndex: 'monthly_recurring',
      render: (value: number) => <span className="font-semibold text-green-600">{formatCurrency(value)}</span>
    },
    {
      title: 'Total Billed (YTD)',
      dataIndex: 'total_billed_ytd',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: string) => (
        <Badge
          variant={
            value === 'active' ? 'success' :
            value === 'upcoming' ? 'info' :
            'default-muted'
          }
        >
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </Badge>
      )
    }
  ];

  // Expiration Report Columns
  const expirationColumns: ColumnDefinition<ContractExpiration>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name'
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value: string) => new Date(value).toLocaleDateString()
    },
    {
      title: 'Days Until Expiration',
      dataIndex: 'days_until_expiration',
      render: (value: number) => (
        <span className={value <= 30 ? 'text-red-600 font-semibold' : value <= 60 ? 'text-amber-600' : ''}>
          {value} days
        </span>
      )
    },
    {
      title: 'Monthly Value',
      dataIndex: 'monthly_value',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Auto-Renew',
      dataIndex: 'auto_renew',
      render: (value: boolean) => (
        <Badge variant="secondary" className={value ? 'border-green-300 text-green-800' : 'border-[rgb(var(--color-border-300))] text-muted-foreground'}>
          {value ? 'Yes' : 'No'}
        </Badge>
      )
    }
  ];

  // Bucket Usage Columns
  const bucketUsageColumns: ColumnDefinition<BucketUsage>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name'
    },
    {
      title: 'Total Hours',
      dataIndex: 'total_hours',
      render: (value: number) => `${value} hrs`
    },
    {
      title: 'Used Hours',
      dataIndex: 'used_hours',
      render: (value: number) => `${value} hrs`
    },
    {
      title: 'Remaining',
      dataIndex: 'remaining_hours',
      render: (value: number) => (
        <span className={value === 0 ? 'text-red-600 font-semibold' : ''}>
          {value} hrs
        </span>
      )
    },
    {
      title: 'Utilization',
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
            {value}%
          </span>
        </div>
      )
    },
    {
      title: 'Overage',
      dataIndex: 'overage_hours',
      render: (value: number) => (
        <span className={value > 0 ? 'text-red-600 font-semibold' : 'text-muted-foreground'}>
          {value > 0 ? `+${value} hrs` : '—'}
        </span>
      )
    }
  ];

  // Profitability Columns
  const profitabilityColumns: ColumnDefinition<Profitability>[] = [
    {
      title: 'Contract',
      dataIndex: 'contract_name',
      render: (value: string) => <span className="font-medium">{value}</span>
    },
    {
      title: 'Client',
      dataIndex: 'client_name'
    },
    {
      title: 'Revenue (YTD)',
      dataIndex: 'revenue',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Cost (YTD)',
      dataIndex: 'cost',
      render: (value: number) => formatCurrency(value)
    },
    {
      title: 'Profit',
      dataIndex: 'profit',
      render: (value: number) => (
        <span className="font-semibold text-green-600">{formatCurrency(value)}</span>
      )
    },
    {
      title: 'Margin',
      dataIndex: 'margin_percentage',
      render: (value: number) => (
        <Badge
          variant={value >= 40 ? 'success' : 'warning'}
        >
          {value}%
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
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
          <h2 className="text-2xl font-bold mb-2">Contract Reports</h2>
          <p className="text-muted-foreground text-sm">
            Analyze contract performance, revenue, and utilization metrics
          </p>
        </div>

        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-semibold mb-1">Error Loading Reports</p>
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Contract Reports</h2>
        <p className="text-muted-foreground text-sm">
          Analyze contract performance, revenue, and utilization metrics
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="h-5 w-5 text-green-600" />
            <h3 className="font-semibold">Total MRR</h3>
          </div>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(summary?.totalMRR ?? 0)}</p>
          <p className="text-xs text-muted-foreground mt-1">Monthly Recurring Revenue</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <h3 className="font-semibold">YTD Revenue</h3>
          </div>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(summary?.totalYTD ?? 0)}</p>
          <p className="text-xs text-muted-foreground mt-1">Year to Date</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-5 w-5 text-purple-600" />
            <h3 className="font-semibold">Active Contracts</h3>
          </div>
          <p className="text-2xl font-bold text-purple-600">{summary?.activeContractCount ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-1">Billable clients</p>
        </Card>
      </div>

      {/* Report Tabs */}
      <Tabs value={activeReport} onValueChange={setActiveReport}>
        <TabsList>
          <TabsTrigger value="revenue">Contract Revenue</TabsTrigger>
          <TabsTrigger value="expiration">Expiration</TabsTrigger>
          <TabsTrigger value="bucket-usage">Bucket Hours</TabsTrigger>
          <TabsTrigger value="profitability">Profitability</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4">
          <Card className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Coins className="h-5 w-5 text-green-600" />
              <h3 className="text-lg font-semibold">Contract Revenue Report</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Overview of monthly recurring revenue and year-to-date billing by contract
            </p>
            {revenueData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No contract revenue data available</p>
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
              <h3 className="text-lg font-semibold">Contract Expiration and Renewal Decisions</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Track upcoming contract expirations and renewal decision due dates.
            </p>
            {expirationData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No upcoming contract expirations or renewal decisions in the near term</p>
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
              <h3 className="text-lg font-semibold">Bucket Hours Utilization</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Monitor bucket hours usage and identify overage situations
            </p>
            {bucketUsageData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No bucket-based contracts found</p>
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
              <h3 className="text-lg font-semibold">Simple Profitability Report</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Basic profit margins and revenue vs. cost analysis by contract
            </p>
            {profitabilityData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No profitability data available</p>
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
