'use client'

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { DatePicker } from 'server/src/components/ui/DatePicker';import { Button } from 'server/src/components/ui/Button';
import { CustomTabs } from 'server/src/components/ui/CustomTabs';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import { formatCurrency } from 'server/src/lib/utils/formatters';
import { formatDateOnly } from 'server/src/lib/utils/dateTimeUtils';
import { parseISO } from 'date-fns';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ICreditReconciliationReport, ReconciliationStatus } from 'server/src/interfaces/billing.interfaces';
import { validateClientCredit } from '@product/actions/creditReconciliationActions';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import {
  fetchReconciliationReports,
  fetchClientsForDropdown,
  fetchReconciliationStats
} from '@product/actions/reconciliationReportActions';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts';

// Define a type that extends ICreditReconciliationReport with client_name
type ExtendedReconciliationReport = ICreditReconciliationReport & {
  client_name?: string
};

// Define a function to create columns for the reconciliation reports table
const createColumns = (router: any): ColumnDefinition<ExtendedReconciliationReport>[] => [
  {
    title: 'Client',
    dataIndex: 'client_name',
    render: (value: string | undefined) => value || 'N/A'
  },
  {
    title: 'Discrepancy',
    dataIndex: 'difference',
    render: (value: number) => formatCurrency(value)
  },
  {
    title: 'Detected',
    dataIndex: 'detection_date',
    render: (value: string) => formatDateOnly(parseISO(value))
  },
  {
    title: 'Status',
    dataIndex: 'status',
    render: (value: ReconciliationStatus) => {
      switch (value) {
        case 'open':
          return <span className="px-2 py-1 rounded-full bg-[rgb(var(--color-accent-100))] text-[rgb(var(--color-accent-900))] text-xs font-medium">Open</span>;
        case 'in_review':
          return <span className="px-2 py-1 rounded-full bg-[rgb(var(--color-secondary-100))] text-[rgb(var(--color-secondary-900))] text-xs font-medium">In Review</span>;
        case 'resolved':
          return <span className="px-2 py-1 rounded-full bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-900))] text-xs font-medium">Resolved</span>;
        default:
          return value;
      }
    }
  },
  {
    title: 'Expected Balance',
    dataIndex: 'expected_balance',
    render: (value: number) => formatCurrency(value)
  },
  {
    title: 'Actual Balance',
    dataIndex: 'actual_balance',
    render: (value: number) => formatCurrency(value)
  },
  {
    title: 'Actions',
    dataIndex: 'report_id',
    width: '10%',
    render: (value: string, record) => {
      const isResolved = record.status === 'resolved';
      
      return (
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            id={`view-report-${value}`}
            onClick={() => router.push(`/billing-dashboard/reconciliation/${value}`)}
          >
            View
          </Button>
          {!isResolved && (
            <Button
              variant="outline"
              size="sm"
              id={`resolve-report-${value}`}
              className="text-[rgb(var(--color-primary-600))] hover:bg-[rgb(var(--color-primary-50))]"
              onClick={() => router.push(`/billing-dashboard/reconciliation/${value}?action=resolve`)}
            >
              Resolve
            </Button>
          )}
        </div>
      );
    }
  },
];

// Colors for charts - using our design system colors
const COLORS = [
  'rgb(var(--color-primary-400))',
  'rgb(var(--color-secondary-400))',
  'rgb(var(--color-accent-400))',
  'rgb(var(--color-primary-600))'
];

const CreditReconciliation: React.FC = () => {
  // State for data
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<ExtendedReconciliationReport[]>([]);
  const [openReports, setOpenReports] = useState<ExtendedReconciliationReport[]>([]);
  const [inReviewReports, setInReviewReports] = useState<ExtendedReconciliationReport[]>([]);
  const [resolvedReports, setResolvedReports] = useState<ExtendedReconciliationReport[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  
  // State for filters and pagination
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<ReconciliationStatus | ''>('');
  const [dateRange, setDateRange] = useState<{ startDate: string | null; endDate: string | null }>({
    startDate: null,
    endDate: null
  });
  const [runningValidation, setRunningValidation] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);
  const [stats, setStats] = useState({
    totalDiscrepancies: 0,
    totalAmount: 0,
    openCount: 0,
    inReviewCount: 0,
    resolvedCount: 0
  });
  const router = useRouter();
  
  // Create columns with router access
  const columns = createColumns(router);

  // Generate status distribution data for pie chart
  const statusDistributionData = [
    { name: 'Open', value: stats.openCount },
    { name: 'In Review', value: stats.inReviewCount },
    { name: 'Resolved', value: stats.resolvedCount }
  ];

  // Placeholder for discrepancy trend data - in production, this would come from an analytics endpoint
  const discrepancyTrendData = [
    { month: 'Jan', count: 5, amount: 2500 },
    { month: 'Feb', count: 3, amount: 1200 },
    { month: 'Mar', count: 7, amount: 3500 },
    { month: 'Apr', count: 2, amount: 800 },
    { month: 'May', count: 4, amount: 2000 },
    { month: 'Jun', count: 6, amount: 3000 },
  ];

  useEffect(() => {
    // Fetch reconciliation reports and clients
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch reports with pagination and filtering
        const result = await fetchReconciliationReports({
          clientId: selectedClient || undefined,
          status: selectedStatus || undefined,
          startDate: dateRange.startDate || undefined,
          endDate: dateRange.endDate || undefined,
          page,
          pageSize
        });
        
        // Fetch clients for dropdown
        const clientsData = await fetchClientsForDropdown();
        
        // Fetch statistics
        const statsData = await fetchReconciliationStats();
        
        // Set the data
        setReports(result.reports as ExtendedReconciliationReport[]);
        setOpenReports(result.reports.filter(r => r.status === 'open') as ExtendedReconciliationReport[]);
        setInReviewReports(result.reports.filter(r => r.status === 'in_review') as ExtendedReconciliationReport[]);
        setResolvedReports(result.reports.filter(r => r.status === 'resolved') as ExtendedReconciliationReport[]);
        setClients(clientsData);
        setTotalItems(result.total);
        
        // Set stats
        setStats(statsData);
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching reconciliation data:', error);
        setLoading(false);
      }
    };
    
    fetchData();
  }, [page, pageSize, selectedClient, selectedStatus, dateRange.startDate, dateRange.endDate]);

  const handleRunValidation = async () => {
    if (!selectedClient) return;
    
    try {
      setRunningValidation(true);
      
      // Get the current user
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }
      
      // Call the server action to run validation for the selected client
      const result = await validateClientCredit(selectedClient, currentUser.user_id);
      
      console.log('Validation result:', result);
      
      // In a real implementation, we would refresh the data after validation
      // For now, just show a success message
      alert(`Validation completed: Found ${result.balanceDiscrepancyCount} balance discrepancies and ${result.missingTrackingCount + result.inconsistentTrackingCount} tracking issues.`);
      
      setRunningValidation(false);
    } catch (error) {
      console.error('Error running validation:', error);
      setRunningValidation(false);
    }
  };

  const handleClientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedClient(e.target.value);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-64" />
          <div className="flex space-x-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
        
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-[rgb(var(--color-text-900))]">Credit Reconciliation Dashboard</h2>
          <div className="flex space-x-2">
            <div className="flex items-center space-x-2">
              <select
                id="client-selector"
                value={selectedClient}
                onChange={handleClientChange}
                className="border border-[rgb(var(--color-border-300))] rounded-md px-3 py-2 text-sm text-[rgb(var(--color-text-700))] bg-white"
              >
                <option value="">Select Client</option>
                {clients.map(client => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
              <Button
                id="run-validation-button"
                onClick={handleRunValidation}
                disabled={!selectedClient || runningValidation}
              >
                {runningValidation ? 'Running...' : 'Run Reconciliation'}
              </Button>
            </div>
          </div>
        </div>
        
        {/* Filter Controls */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div>
                <label htmlFor="status-filter" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  Status
                </label>
                <select
                  id="status-filter"
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value as ReconciliationStatus | '')}
                  className="border border-[rgb(var(--color-border-300))] rounded-md px-3 py-2 text-sm text-[rgb(var(--color-text-700))] bg-white"
                >
                  <option value="">All Statuses</option>
                  <option value="open">Open</option>
                  <option value="in_review">In Review</option>
                  <option value="resolved">Resolved</option>
                </select>
              </div>
              
              <div>
                <label htmlFor="date-from" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  From Date
                </label>
                <input
                  id="date-from"
                  type="date"
                  value={dateRange.startDate || ''}
                  onChange={(e) => setDateRange({...dateRange, startDate: e.target.value || null})}
                  className="border border-[rgb(var(--color-border-300))] rounded-md px-3 py-2 text-sm text-[rgb(var(--color-text-700))] bg-white"
                />
              </div>
              
              <div>
                <label htmlFor="date-to" className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  To Date
                </label>
                <input
                  id="date-to"
                  type="date"
                  value={dateRange.endDate || ''}
                  onChange={(e) => setDateRange({...dateRange, endDate: e.target.value || null})}
                  className="border border-[rgb(var(--color-border-300))] rounded-md px-3 py-2 text-sm text-[rgb(var(--color-text-700))] bg-white"
                />
              </div>
              
              <div className="ml-auto">
                <Button
                  id="clear-filters-button"
                  variant="outline"
                  onClick={() => {
                    setSelectedStatus('');
                    setDateRange({ startDate: null, endDate: null });
                    setSelectedClient('');
                  }}
                  className="mt-6"
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Summary Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-[rgb(var(--color-text-500))]">Total Discrepancies</p>
                <p className="text-2xl font-bold text-[rgb(var(--color-text-900))]">{stats.totalDiscrepancies}</p>
              </div>
              <div className="bg-[rgb(var(--color-primary-100))] p-3 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[rgb(var(--color-primary-600))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-[rgb(var(--color-text-500))]">Total Discrepancy Amount</p>
                <p className="text-2xl font-bold text-[rgb(var(--color-text-900))]">{formatCurrency(stats.totalAmount)}</p>
              </div>
              <div className="bg-[rgb(var(--color-secondary-100))] p-3 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[rgb(var(--color-secondary-600))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm text-[rgb(var(--color-text-500))]">Open Issues</p>
                <p className="text-2xl font-bold text-[rgb(var(--color-text-900))]">{stats.openCount}</p>
              </div>
              <div className="bg-[rgb(var(--color-accent-100))] p-3 rounded-full">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-[rgb(var(--color-accent-600))]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Status Distribution</CardTitle>
            <CardDescription>Overview of reconciliation report statuses</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={statusDistributionData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent }: {name: string, percent: number}) => 
                      `${name} (${(percent * 100).toFixed(0)}%)`
                    }
                  >
                    {statusDistributionData.map((entry, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => value} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Discrepancy Trends</CardTitle>
            <CardDescription>Monthly trends in credit discrepancies</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={discrepancyTrendData}
                  margin={{
                    top: 5,
                    right: 30,
                    left: 20,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis yAxisId="left" orientation="left" stroke="rgb(var(--color-primary-400))" />
                  <YAxis yAxisId="right" orientation="right" stroke="rgb(var(--color-secondary-400))" />
                  <Tooltip formatter={(value) => typeof value === 'number' && value % 1 === 0 ? value : formatCurrency(value as number)} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="count" fill="rgb(var(--color-primary-400))" name="Number of Discrepancies" />
                  <Bar yAxisId="right" dataKey="amount" fill="rgb(var(--color-secondary-400))" name="Total Amount" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Reconciliation Reports Table */}
      <Card>
        <CardHeader>
          <CardTitle>Reconciliation Reports</CardTitle>
          <CardDescription>
            View and manage credit balance discrepancies
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomTabs
            tabs={[
              {
                label: `All (${reports.length})`,
                content: (
                  <DataTable
                    id="all-reports-table"
                    columns={columns}
                    data={reports}
                    pagination={true}
                    currentPage={page}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    totalItems={totalItems}
                  />
                )
              },
              {
                label: `Open (${openReports.length})`,
                content: (
                  <DataTable
                    id="open-reports-table"
                    columns={columns}
                    data={openReports}
                    pagination={true}
                    currentPage={page}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    totalItems={openReports.length}
                  />
                )
              },
              {
                label: `In Review (${inReviewReports.length})`,
                content: (
                  <DataTable
                    id="in-review-reports-table"
                    columns={columns}
                    data={inReviewReports}
                    pagination={true}
                    currentPage={page}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    totalItems={inReviewReports.length}
                  />
                )
              },
              {
                label: `Resolved (${resolvedReports.length})`,
                content: (
                  <DataTable
                    id="resolved-reports-table"
                    columns={columns}
                    data={resolvedReports}
                    pagination={true}
                    currentPage={page}
                    onPageChange={setPage}
                    pageSize={pageSize}
                    totalItems={resolvedReports.length}
                  />
                )
              }
            ]}
            defaultTab={`All (${reports.length})`}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default CreditReconciliation;