'use client';

import React, { useState, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Text } from '@radix-ui/themes';
import { DataTable } from 'server/src/components/ui/DataTable'; // Import DataTable
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces'; // Import ColumnDefinition
import { getRecentCompanyInvoices, RecentInvoice } from 'server/src/lib/actions/report-actions'; // Import action and type
import { Skeleton } from 'server/src/components/ui/Skeleton'; // Import Skeleton for loading state
import { formatCurrency } from 'server/src/lib/utils/formatters'; // Import currency formatter
import { formatDateOnly } from 'server/src/lib/utils/dateTimeUtils'; // Import date formatter
import { parseISO, subDays, format } from 'date-fns'; // Import date functions
import {
 getHoursByServiceType, HoursByServiceResult,
 getRemainingBucketUnits, RemainingBucketUnitsResult,
 getUsageDataMetrics, UsageMetricResult // Import usage action and type
} from 'server/src/lib/actions/report-actions'; // Import actions and types
import ChartSkeleton from 'server/src/components/ui/skeletons/ChartSkeleton';

// Dynamic imports for recharts components with type assertions
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer as any), {
  ssr: false
}) as any;
const RadialBarChart = dynamic(() => import('recharts').then(mod => mod.RadialBarChart as any), {
  ssr: false
}) as any;
const RadialBar = dynamic(() => import('recharts').then(mod => mod.RadialBar as any), {
  ssr: false
}) as any;
const PolarAngleAxis = dynamic(() => import('recharts').then(mod => mod.PolarAngleAxis as any), {
  ssr: false
}) as any;
// Removed Progress import

interface ClientBillingDashboardProps {
  companyId: string;
}

// Define columns for the Recent Invoices table
const invoiceColumns: ColumnDefinition<RecentInvoice>[] = [
  {
    title: 'Invoice #',
    dataIndex: 'invoice_number',
    render: (value: string) => value || 'N/A',
  },
  {
    title: 'Invoice Date',
    dataIndex: 'invoice_date',
    render: (value: string | Date) => value ? formatDateOnly(typeof value === 'string' ? parseISO(value) : value) : 'N/A',
  },
  {
    title: 'Due Date',
    dataIndex: 'due_date',
    render: (value: string | Date) => value ? formatDateOnly(typeof value === 'string' ? parseISO(value) : value) : 'N/A',
  },
  {
   title: 'Total Amount',
   dataIndex: 'total_amount',
   // Wrap the formatted currency in a div with text-right class
   render: (value: number) => <div className="text-right">{formatCurrency(value)}</div>,
 },
 {
    title: 'Status',
    dataIndex: 'status',
    render: (value: string) => value || 'N/A', // TODO: Add status badge rendering like in CreditReconciliation
  },
];


// Define columns for the Hours by Service table
const hoursColumns: ColumnDefinition<HoursByServiceResult>[] = [
 {
   title: 'Service Name', // Or 'Service Type Name' if grouped by type
   dataIndex: 'service_name', // Adjust if grouped by type
   render: (value: string) => value || 'N/A',
 },
 {
   title: 'Total Duration (Hours)',
   dataIndex: 'total_duration',
   render: (value: number) => {
     const hours = (value / 60).toFixed(2); // Convert minutes to hours
     return <div className="text-right">{hours}</div>;
   },
},
];

// Define columns for the Usage Metrics table
const usageColumns: ColumnDefinition<UsageMetricResult>[] = [
{
  title: 'Service Name',
  dataIndex: 'service_name',
  render: (value: string) => value || 'N/A',
},
{
  title: 'Total Quantity',
  dataIndex: 'total_quantity',
  render: (value: number) => <div className="text-right">{value}</div>, // Align right
},
{
  title: 'Unit',
  dataIndex: 'unit_of_measure',
  render: (value: string | null) => value || 'N/A',
},
];

// Custom Tooltip Component for Bucket Chart
const CustomBucketTooltip = ({ active, payload, label }: any) => {
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


const ClientBillingDashboard: React.FC<ClientBillingDashboardProps> = ({ companyId }) => {
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
// Derived state for chart-specific data (optional, could transform inline)
// const [chartBucketData, setChartBucketData] = useState<any[]>([]);

// State for Usage Metrics
const [loadingUsage, setLoadingUsage] = useState(true);
const [usageData, setUsageData] = useState<UsageMetricResult[]>([]);

  // Fetch recent invoices on mount
  useEffect(() => {
    const fetchInvoices = async () => {
      try {
        setLoadingInvoices(true);
        const fetchedInvoices = await getRecentCompanyInvoices({ companyId }); // Default limit is 10
        setInvoices(fetchedInvoices);
      } catch (error) {
        console.error("Error fetching recent invoices:", error);
        // TODO: Add user-facing error handling (e.g., toast notification)
      } finally {
        setLoadingInvoices(false);
      }
    };

   fetchInvoices();
 }, [companyId]);

 // Fetch hours by service on mount and when date range changes
 useEffect(() => {
   const fetchHours = async () => {
     try {
       setLoadingHours(true);
       const fetchedHours = await getHoursByServiceType({
         companyId,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        groupByServiceType: false // Explicitly set to false
       });
       setHoursData(fetchedHours);
     } catch (error) {
       console.error("Error fetching hours by service:", error);
       // TODO: Add user-facing error handling
     } finally {
       setLoadingHours(false);
     }
   };

   fetchHours();
 }, [companyId, dateRange]);


// Fetch bucket usage on mount
useEffect(() => {
  const fetchBuckets = async () => {
    try {
      setLoadingBuckets(true);
      const currentDate = format(new Date(), 'yyyy-MM-dd'); // Get current date in YYYY-MM-DD format
      const fetchedBuckets = await getRemainingBucketUnits({
        companyId,
        currentDate,
      });
      setBucketData(fetchedBuckets);
    } catch (error) {
      console.error("Error fetching bucket usage:", error);
      // TODO: Add user-facing error handling
    } finally {
      setLoadingBuckets(false);
    }
  };

  fetchBuckets();
}, [companyId]);


// Fetch usage metrics on mount and when date range changes
useEffect(() => {
 const fetchUsage = async () => {
   try {
     setLoadingUsage(true);
     const fetchedUsage = await getUsageDataMetrics({
       companyId,
       startDate: dateRange.startDate,
       endDate: dateRange.endDate,
     });
     setUsageData(fetchedUsage);
   } catch (error) {
     console.error("Error fetching usage metrics:", error);
     // TODO: Add user-facing error handling
   } finally {
     setLoadingUsage(false);
   }
 };

 fetchUsage();
}, [companyId, dateRange]);

 // TODO: Add UI elements to change the dateRange state

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingInvoices ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : invoices.length > 0 ? (
            <DataTable
              columns={invoiceColumns}
              data={invoices}
              // No pagination needed for a short list of recent items
            />
          ) : (
            <Text>No recent invoices found.</Text>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
         <CardTitle>Hours by Service (Last 30 Days)</CardTitle>
         {/* TODO: Add Date Range Picker here */}
       </CardHeader>
       <CardContent>
         {loadingHours ? (
           <div className="space-y-2">
             <Skeleton className="h-8 w-full" />
             <Skeleton className="h-8 w-full" />
           </div>
         ) : hoursData.length > 0 ? (
           <DataTable
             columns={hoursColumns}
             data={hoursData}
           />
         ) : (
           <Text>No hours recorded in the selected period.</Text>
         )}
        </CardContent>
      </Card>

      <Card>
       <CardHeader>
         <CardTitle>Bucket Usage</CardTitle>
       </CardHeader>
       <CardContent>
         {loadingBuckets ? (
           // Skeleton for grid layout
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
             {[1, 2, 3].map(i => (
               <div key={i} className="flex flex-col items-center space-y-2">
                 <Skeleton className="h-6 w-3/4" />
                 <Skeleton className="h-20 w-20 rounded-full" />
                 <Skeleton className="h-4 w-1/2" />
               </div>
             ))}
           </div>
         ) : bucketData.length > 0 ? (
           // Render radial charts in a grid
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             {bucketData.map((bucket) => (
               <div key={`${bucket.plan_id}-${bucket.service_id}`} className="flex flex-col items-center text-center p-4 border rounded-lg">
                 <span className="text-sm font-medium text-gray-700 mb-2 h-10 flex items-center justify-center">{bucket.display_label}</span>
                 <div className="w-24 h-24 mb-2"> {/* Container for the chart */}
                   <Suspense fallback={<ChartSkeleton height="96px" type="radial" title="Usage Chart" showLegend={false} />}>
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
                   {(bucket.minutes_used / 60).toFixed(2)} / {((bucket.total_minutes + bucket.rolled_over_minutes) / 60).toFixed(2)} hours used
                 </span>
               </div>
             ))}
           </div>
         ) : (
           <Text>No active bucket plans found.</Text>
         )}
        </CardContent>
      </Card>

      <Card>
       <CardHeader>
         <CardTitle>Usage Metrics (Last 30 Days)</CardTitle>
          {/* TODO: Link this title/data to the Date Range Picker */}
       </CardHeader>
       <CardContent>
         {loadingUsage ? (
           <div className="space-y-2">
             <Skeleton className="h-8 w-full" />
             <Skeleton className="h-8 w-full" />
           </div>
         ) : usageData.length > 0 ? (
           <DataTable
             columns={usageColumns}
             data={usageData}
             // No pagination needed for this view yet
           />
         ) : (
           <Text>No usage data found in the selected period.</Text>
         )}
       </CardContent>
      </Card>
    </div>
  );
};

export default ClientBillingDashboard;
