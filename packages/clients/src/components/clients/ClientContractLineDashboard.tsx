'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Text } from '@radix-ui/themes';
import { SectionLoadError } from './SectionLoadError';
import { DataTable } from '@alga-psa/ui/components/DataTable'; // Import DataTable
import { ColumnDefinition } from '@alga-psa/types'; // Import ColumnDefinition
import { getRecentClientInvoices, type RecentInvoice } from '@alga-psa/reporting/actions'; // Import action and type
import { Skeleton } from '@alga-psa/ui/components/Skeleton'; // Import Skeleton for loading state
import { formatCurrencyFromMinorUnits } from '@alga-psa/core'; // invoices.total_amount is in cents
import { formatDateOnly } from '@alga-psa/core'; // Import date formatter
import { parseISO, subDays, format } from 'date-fns'; // Import date functions
import {
 getHoursByServiceType, HoursByServiceResult,
 getRemainingBucketUnits, RemainingBucketUnitsResult,
 getUsageDataMetrics, UsageMetricResult // Import usage action and type
} from '@alga-psa/reporting/actions'; // Import actions and types
import ChartSkeleton from '@alga-psa/ui/components/skeletons/ChartSkeleton';
import { BucketUsageChart } from '@alga-psa/ui/components';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import type {
  PolarAngleAxisProps,
  RadialBarProps,
  ResponsiveContainerProps,
} from 'recharts';
import type { CategoricalChartProps } from 'recharts/types/chart/generateCategoricalChart';

// next/dynamic expects ComponentType; Recharts exports forward-ref/class components.
// Keep the cast bounded to each exported prop type instead of erasing props to any.
const rechartsComponent = <P,>(component: unknown): React.ComponentType<P> =>
  component as React.ComponentType<P>;

const isReturnedActionError = (value: unknown): value is { actionError: string } | { permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

const ResponsiveContainer = dynamic<ResponsiveContainerProps>(
  () => import('recharts').then(mod => rechartsComponent<ResponsiveContainerProps>(mod.ResponsiveContainer)),
  { ssr: false }
);
const RadialBarChart = dynamic<CategoricalChartProps>(
  () => import('recharts').then(mod => rechartsComponent<CategoricalChartProps>(mod.RadialBarChart)),
  { ssr: false }
);
const RadialBar = dynamic<RadialBarProps>(
  () => import('recharts').then(mod => rechartsComponent<RadialBarProps>(mod.RadialBar)),
  { ssr: false }
);
const PolarAngleAxis = dynamic<PolarAngleAxisProps>(
  () => import('recharts').then(mod => rechartsComponent<PolarAngleAxisProps>(mod.PolarAngleAxis)),
  { ssr: false }
);
// Removed Progress import

interface ClientContractLineDashboardProps {
  clientId: string;
}

interface CustomBucketTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: RemainingBucketUnitsResult }>;
  label?: string;
}

// Custom Tooltip Component for Bucket Chart
const CustomBucketTooltip = ({ active, payload, label }: CustomBucketTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload; // Access the full data point for the hovered bar
    return (
      <div className="bg-white p-2 border border-gray-300 rounded shadow-md text-sm">
        <p className="font-medium">{label}</p> {/* display_label */}
        <p className="text-primary-600">{`Used: ${(data.minutes_used / 60).toFixed(2)} hours`}</p>
        <p className="text-gray-600">{`Remaining: ${(data.remaining_minutes / 60).toFixed(2)} hours`}</p>
        <p className="text-gray-600">{`Total: ${(data.total_minutes / 60).toFixed(2)} hours`}</p>
      </div>
    );
  }

  return null;
};


const ClientContractLineDashboard: React.FC<ClientContractLineDashboardProps> = ({ clientId }) => {
 const { t } = useTranslation('msp/clients');
 const notAvailable = t('common.states.na', { defaultValue: 'N/A' });

 // Order is admission priority at narrow widths (computeColumnFit): Status —
 // what month-close actually needs — sits early instead of being the first
 // column dropped; Total keeps its rightmost slot via an explicit width
 // (width-bearing columns are prioritized), leaving Invoice Date as the
 // drop candidate.
 const invoiceColumns: ColumnDefinition<RecentInvoice>[] = [
  {
    title: t('clientContractLineDashboard.invoiceNumber', { defaultValue: 'Invoice number' }),
    dataIndex: 'invoice_number',
    render: (value: string) => value || notAvailable,
  },
  {
    title: t('clientContractLineDashboard.status', { defaultValue: 'Status' }),
    dataIndex: 'status',
    render: (value: string) => value || notAvailable,
  },
  {
    title: t('clientContractLineDashboard.dueDate', { defaultValue: 'Due date' }),
    dataIndex: 'due_date',
    render: (value: string | Date) => value ? formatDateOnly(typeof value === 'string' ? parseISO(value) : value) : notAvailable,
  },
  {
    title: t('clientContractLineDashboard.invoiceDate', { defaultValue: 'Invoice date' }),
    dataIndex: 'invoice_date',
    render: (value: string | Date) => value ? formatDateOnly(typeof value === 'string' ? parseISO(value) : value) : notAvailable,
  },
  {
   title: t('clientContractLineDashboard.totalAmount', { defaultValue: 'Amount' }),
   dataIndex: 'total_amount',
   width: '130px',
   render: (value: number, record: RecentInvoice) => (
     <div className="text-right">{formatCurrencyFromMinorUnits(value, 'en-US', record.currency_code || 'USD')}</div>
   ),
 },
 {
   // W6 (roast gap): the one invoice table on the client's billing page
   // could not say which invoices are unpaid. Drafts owe nothing yet —
   // em dash, not $0.
   title: t('clientContractLineDashboard.balanceDue', { defaultValue: 'Balance due' }),
   dataIndex: 'balance_due',
   width: '130px',
   render: (value: number | null, record: RecentInvoice) => (
     <div className={`text-right ${value ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
       {value == null ? '—' : formatCurrencyFromMinorUnits(value, 'en-US', record.currency_code || 'USD')}
     </div>
   ),
 },
 ];

 const hoursColumns: ColumnDefinition<HoursByServiceResult>[] = [
 {
   title: t('clientContractLineDashboard.serviceName', { defaultValue: 'Service' }),
   dataIndex: 'service_name',
   render: (value: string) => value || notAvailable,
 },
 {
   title: t('clientContractLineDashboard.totalDurationHours', { defaultValue: 'Hours' }),
   dataIndex: 'total_duration',
   render: (value: number) => {
     const hours = (value / 60).toFixed(2);
     return <div className="text-right">{hours}</div>;
   },
},
 ];

 const usageColumns: ColumnDefinition<UsageMetricResult>[] = [
{
  title: t('clientContractLineDashboard.serviceName', { defaultValue: 'Service' }),
  dataIndex: 'service_name',
  render: (value: string) => value || notAvailable,
},
{
  title: t('clientContractLineDashboard.totalQuantity', { defaultValue: 'Quantity' }),
  dataIndex: 'total_quantity',
  render: (value: number) => <div className="text-right">{value}</div>,
},
{
  title: t('clientContractLineDashboard.unit', { defaultValue: 'Unit' }),
  dataIndex: 'unit_of_measure',
  render: (value: string | null) => value || notAvailable,
},
 ];

 // State for Invoices
 const [loadingInvoices, setLoadingInvoices] = useState(true);
 const [invoices, setInvoices] = useState<RecentInvoice[]>([]);

 // State for Date Range Filter (Default: Last 30 days)
 const [dateRange, setDateRange] = useState(() => {
   const endDate = new Date();
   const startDate = subDays(endDate, 30);
  return {
    startDate: format(startDate, 'yyyy-MM-dd'), // Use format directly
    endDate: format(endDate, 'yyyy-MM-dd'),     // Use format directly
   };
 });

// State for Hours by Service
const [loadingHours, setLoadingHours] = useState(true);
const [hoursData, setHoursData] = useState<HoursByServiceResult[]>([]);

// State for Bucket Usage
const [loadingBuckets, setLoadingBuckets] = useState(true);
const [bucketData, setBucketData] = useState<RemainingBucketUnitsResult[]>([]);

// State for Usage Metrics
const [loadingUsage, setLoadingUsage] = useState(true);
const [usageData, setUsageData] = useState<UsageMetricResult[]>([]);

  // Pagination state for Invoices
  const [invoicesCurrentPage, setInvoicesCurrentPage] = useState(1);
  const [invoicesPageSize, setInvoicesPageSize] = useState(10);

  // Pagination state for Hours by Service
  const [hoursCurrentPage, setHoursCurrentPage] = useState(1);
  const [hoursPageSize, setHoursPageSize] = useState(10);

  // Pagination state for Usage Metrics
  const [usageCurrentPage, setUsageCurrentPage] = useState(1);
  const [usagePageSize, setUsagePageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handleInvoicesPageSizeChange = (newPageSize: number) => {
    setInvoicesPageSize(newPageSize);
    setInvoicesCurrentPage(1);
  };

  const handleHoursPageSizeChange = (newPageSize: number) => {
    setHoursPageSize(newPageSize);
    setHoursCurrentPage(1);
  };

  const handleUsagePageSizeChange = (newPageSize: number) => {
    setUsagePageSize(newPageSize);
    setUsageCurrentPage(1);
  };

  // Per-section error flags — a failed fetch must not masquerade as empty.
  const [invoicesError, setInvoicesError] = useState(false);
  const [hoursError, setHoursError] = useState(false);
  const [bucketsError, setBucketsError] = useState(false);
  const [usageError, setUsageError] = useState(false);
  const [invoicesErrorMessage, setInvoicesErrorMessage] = useState<string | null>(null);
  const [hoursErrorMessage, setHoursErrorMessage] = useState<string | null>(null);
  const [bucketsErrorMessage, setBucketsErrorMessage] = useState<string | null>(null);
  const [usageErrorMessage, setUsageErrorMessage] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    try {
      setLoadingInvoices(true);
      setInvoicesError(false);
      setInvoicesErrorMessage(null);
      const fetchedInvoices = await getRecentClientInvoices({ clientId }); // Default limit is 10
      if (isReturnedActionError(fetchedInvoices)) {
        setInvoices([]);
        setInvoicesErrorMessage(getErrorMessage(fetchedInvoices));
        setInvoicesError(true);
        return;
      }
      setInvoices(fetchedInvoices);
    } catch (error) {
      console.error("Error fetching recent invoices:", error);
      setInvoicesError(true);
    } finally {
      setLoadingInvoices(false);
    }
  }, [clientId]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const fetchHours = useCallback(async () => {
    try {
      setLoadingHours(true);
      setHoursError(false);
      setHoursErrorMessage(null);
      const fetchedHours = await getHoursByServiceType({
        clientId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        groupByServiceType: false // Explicitly set to false
      });
      if (isReturnedActionError(fetchedHours)) {
        setHoursData([]);
        setHoursErrorMessage(getErrorMessage(fetchedHours));
        setHoursError(true);
        return;
      }
      setHoursData(fetchedHours);
    } catch (error) {
      console.error("Error fetching hours by service:", error);
      setHoursError(true);
    } finally {
      setLoadingHours(false);
    }
  }, [clientId, dateRange]);

  useEffect(() => { fetchHours(); }, [fetchHours]);

  const fetchBuckets = useCallback(async () => {
    try {
      setLoadingBuckets(true);
      setBucketsError(false);
      setBucketsErrorMessage(null);
      const currentDate = format(new Date(), 'yyyy-MM-dd'); // Get current date in YYYY-MM-DD format
      const fetchedBuckets = await getRemainingBucketUnits({
        clientId,
        currentDate,
      });
      if (isReturnedActionError(fetchedBuckets)) {
        setBucketData([]);
        setBucketsErrorMessage(getErrorMessage(fetchedBuckets));
        setBucketsError(true);
        return;
      }
      setBucketData(fetchedBuckets);
    } catch (error) {
      console.error("Error fetching bucket usage:", error);
      setBucketsError(true);
    } finally {
      setLoadingBuckets(false);
    }
  }, [clientId]);

  useEffect(() => { fetchBuckets(); }, [fetchBuckets]);

  const fetchUsage = useCallback(async () => {
    try {
      setLoadingUsage(true);
      setUsageError(false);
      setUsageErrorMessage(null);
      const fetchedUsage = await getUsageDataMetrics({
        clientId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
      if (isReturnedActionError(fetchedUsage)) {
        setUsageData([]);
        setUsageErrorMessage(getErrorMessage(fetchedUsage));
        setUsageError(true);
        return;
      }
      setUsageData(fetchedUsage);
    } catch (error) {
      console.error("Error fetching usage metrics:", error);
      setUsageError(true);
    } finally {
      setLoadingUsage(false);
    }
  }, [clientId, dateRange]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  const retryLabel = t('clientContractLineDashboard.retry', { defaultValue: 'Retry' });
  const loadErrorMessage = t('clientContractLineDashboard.loadError', { defaultValue: 'This section failed to load.' });

 // TODO: Add UI elements to change the dateRange state

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('clientContractLineDashboard.recentInvoices', { defaultValue: 'Recent invoices' })}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingInvoices ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : invoicesError ? (
            <SectionLoadError id="client-dashboard-invoices-retry" message={invoicesErrorMessage || loadErrorMessage} retryLabel={retryLabel} onRetry={fetchInvoices} />
          ) : invoices.length > 0 ? (
            <DataTable
              id="client-contract-line-dashboard-table"
              columns={invoiceColumns}
              data={invoices}
              pagination={true}
              currentPage={invoicesCurrentPage}
              onPageChange={setInvoicesCurrentPage}
              pageSize={invoicesPageSize}
              onItemsPerPageChange={handleInvoicesPageSizeChange}
            />
          ) : (
            <Text>{t('clientContractLineDashboard.noInvoices', { defaultValue: 'No recent invoices found.' })}</Text>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
         <CardTitle>{t('clientContractLineDashboard.hoursByService', { defaultValue: 'Hours by service (last 30 days)' })}</CardTitle>
         {/* TODO: Add Date Range Picker here */}
       </CardHeader>
       <CardContent>
         {loadingHours ? (
           <div className="space-y-2">
             <Skeleton className="h-8 w-full" />
             <Skeleton className="h-8 w-full" />
           </div>
         ) : hoursError ? (
           <SectionLoadError id="client-dashboard-hours-retry" message={hoursErrorMessage || loadErrorMessage} retryLabel={retryLabel} onRetry={fetchHours} />
         ) : hoursData.length > 0 ? (
           <DataTable
             id="hours-by-service-table"
             columns={hoursColumns}
             data={hoursData}
             pagination={true}
             currentPage={hoursCurrentPage}
             onPageChange={setHoursCurrentPage}
             pageSize={hoursPageSize}
             onItemsPerPageChange={handleHoursPageSizeChange}
           />
         ) : (
           <Text>{t('clientContractLineDashboard.noHours', { defaultValue: 'No hours logged in the last 30 days.' })}</Text>
         )}
        </CardContent>
      </Card>

      <Card>
       <CardHeader>
         <CardTitle>{t('clientContractLineDashboard.bucketUsage', { defaultValue: 'Bucket usage' })}</CardTitle>
       </CardHeader>
       <CardContent>
         {loadingBuckets ? (
           // Skeleton for grid layout
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             {[1, 2].map(i => (
               <Skeleton key={i} className="h-40 w-full" />
             ))}
           </div>
         ) : bucketsError ? (
           <SectionLoadError id="client-dashboard-buckets-retry" message={bucketsErrorMessage || loadErrorMessage} retryLabel={retryLabel} onRetry={fetchBuckets} />
         ) : bucketData.length > 0 ? (
           // Render enhanced bucket usage charts in a grid
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {bucketData.map((bucket) => (
              <div key={`${bucket.contract_line_id}-${bucket.service_id}`} className="flex flex-col items-center text-center p-4 border rounded-lg">
                <span className="text-sm font-medium text-gray-700 mb-2 h-10 flex items-center justify-center">{bucket.display_label}</span>
                <div className="w-24 h-24 mb-2"> {/* Container for the chart */}
                   <Suspense fallback={<ChartSkeleton height="96px" type="radial" title={t('clientContractLineDashboard.usageChart', { defaultValue: 'Usage Chart' })} showLegend={false} />}>
                     <ResponsiveContainer width="100%" height="100%">
                       <RadialBarChart
                         cx="50%"
                         cy="50%"
                         innerRadius="70%" // Adjust for thickness
                         outerRadius="90%" // Adjust for thickness
                          barSize={10} // Adjust bar size
                           data={[bucket]} // Pass single data item in an array
                           startAngle={225} // Start at bottom-left
                           endAngle={-45}  // End at bottom-right (270 degree sweep)
                         >
                           {/* Background track */}
                           <PolarAngleAxis
                           type="number"
                           domain={[0, (bucket.total_minutes + bucket.rolled_over_minutes) > 0 ? (bucket.total_minutes + bucket.rolled_over_minutes) : 1]} // Domain is 0 to total *available* minutes (total + rollover)
                           angleAxisId={0}
                            tick={false}
                          />
                          <RadialBar
                            background={{ fill: 'rgb(var(--color-secondary-100))' }}
                            dataKey="minutes_used"
                            angleAxisId={0}
                            fill="rgb(var(--color-primary-500))" // Use theme primary color for fill
                            cornerRadius={5} // Rounded corners
                          />
                          {/* Optional: Add text inside the circle */}
                         {/* <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="text-lg font-semibold">
                           {`${((bucket.hours_used / (bucket.total_hours || 1)) * 100).toFixed(0)}%`}
                         </text> */}
                       </RadialBarChart>
                     </ResponsiveContainer>
                   </Suspense>
                 </div>
                 <span className="text-xs text-gray-500">
                   {t('clientContractLineDashboard.hoursUsedSummary', {
                     defaultValue: '{{used}} / {{total}} hours used',
                     used: (bucket.minutes_used / 60).toFixed(2),
                     total: ((bucket.total_minutes + bucket.rolled_over_minutes) / 60).toFixed(2)
                   })}
                 </span>
               </div>
             ))}
           </div>
         ) : (
           <Text>{t('clientContractLineDashboard.noActiveBucketPlans', { defaultValue: 'No active bucket plans found.' })}</Text>
         )}
        </CardContent>
      </Card>

      <Card>
       <CardHeader>
         <CardTitle>{t('clientContractLineDashboard.title', { defaultValue: 'Usage metrics (last 30 days)' })}</CardTitle>
          {/* TODO: Link this title/data to the Date Range Picker */}
       </CardHeader>
       <CardContent>
         {loadingUsage ? (
           <div className="space-y-2">
             <Skeleton className="h-8 w-full" />
             <Skeleton className="h-8 w-full" />
           </div>
         ) : usageError ? (
           <SectionLoadError id="client-dashboard-usage-retry" message={usageErrorMessage || loadErrorMessage} retryLabel={retryLabel} onRetry={fetchUsage} />
         ) : usageData.length > 0 ? (
           <DataTable
             id="usage-metrics-table"
             columns={usageColumns}
             data={usageData}
             pagination={true}
             currentPage={usageCurrentPage}
             onPageChange={setUsageCurrentPage}
             pageSize={usagePageSize}
             onItemsPerPageChange={handleUsagePageSizeChange}
           />
         ) : (
           <Text>{t('clientContractLineDashboard.noUsage', { defaultValue: 'No usage data in the last 30 days.' })}</Text>
         )}
       </CardContent>
      </Card>
    </div>
  );
};

export default ClientContractLineDashboard;
