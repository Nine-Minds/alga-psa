'use client';

import React, { useState, useEffect } from 'react';
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
import {
 BarChart,
 Bar,
 XAxis,
 YAxis,
 CartesianGrid,
 Tooltip,
 ResponsiveContainer,
 Legend,
 Cell // Import Cell for coloring bars
} from 'recharts'; // Import recharts components

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
           <Skeleton className="h-64 w-full" />
         ) : bucketData.length > 0 ? (
           <div className="h-64"> {/* Set a fixed height for the chart container */}
             <ResponsiveContainer width="100%" height="100%">
               <BarChart
                 data={bucketData}
                 layout="vertical" // Use vertical layout for better label readability
                 margin={{ top: 5, right: 30, left: 100, bottom: 5 }} // Adjust margins for labels
               >
                 <CartesianGrid strokeDasharray="3 3" />
                 <XAxis type="number" domain={[0, (dataMax: number) => Math.max(dataMax, 10)]} /> {/* Ensure X axis shows hours */}
                 <YAxis dataKey="plan_name" type="category" width={100} /> {/* Use plan name for Y axis */}
                 <Tooltip formatter={(value: number) => `${value.toFixed(1)} hours`} />
                 <Legend />
                 <Bar dataKey="remaining_hours" name="Remaining Hours" fill="rgb(var(--color-primary-400))" />
                 <Bar dataKey="hours_used" name="Hours Used" fill="rgb(var(--color-secondary-400))" />
                 {/* Optional: Add total hours bar if needed */}
                 {/* <Bar dataKey="total_hours" name="Total Hours" fill="rgb(var(--color-accent-200))" /> */}
               </BarChart>
             </ResponsiveContainer>
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