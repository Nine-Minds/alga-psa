'use client'

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { formatCurrency } from '@alga-psa/core';
import { formatDateOnly } from '@alga-psa/core';
import { ColumnDefinition } from '@alga-psa/types';
import { ICreditTracking } from '@alga-psa/types';
import { listClientCredits, getCreditDetails } from '@alga-psa/billing/actions/creditActions';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
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

function formatCreditServicePeriod(
  start?: string | null,
  end?: string | null
): string | null {
  if (!start || !end) {
    return null;
  }

  return `${new Date(start).toLocaleDateString()} - ${new Date(end).toLocaleDateString()}`;
}

function renderCreditContext(
  record: ICreditTracking & { transaction_description?: string; invoice_number?: string }
) {
  const periodLabel = formatCreditServicePeriod(
    record.invoice_service_period_start,
    record.invoice_service_period_end
  );

  if (record.invoice_context_status === 'missing_source_context') {
    return (
      <div className="text-sm">
        <div className="font-medium">Lineage Missing</div>
        <div className="text-muted-foreground">
          Source invoice metadata could not be recovered. Treat this as financial-date context until lineage is repaired.
        </div>
      </div>
    );
  }

  if (record.invoice_date_basis === 'canonical_recurring_service_period') {
    return (
      <div className="text-sm">
        <div className="font-medium">
          {record.lineage_origin === 'transferred_credit' ? 'Transferred Recurring Credit' : 'Recurring Source'}
        </div>
        <div className="text-muted-foreground">
          {periodLabel ? `Service Period: ${periodLabel}` : 'Recurring source lineage preserved'}
        </div>
      </div>
    );
  }

  return (
    <div className="text-sm">
      <div className="font-medium">Financial Only</div>
      <div className="text-muted-foreground">No recurring service period</div>
    </div>
  );
}

// Define columns for the credits table
const columns: ColumnDefinition<ICreditTracking & { transaction_description?: string, invoice_number?: string }>[] = [
  {
    title: 'Credit ID',
    dataIndex: 'credit_id',
    render: (value: string) => (
      <span className="font-mono text-xs">{value.substring(0, 8)}...</span>
    )
  },
  {
    title: 'Created',
    dataIndex: 'created_at',
    render: (value: string) => (
      <span>{new Date(value).toLocaleDateString()}</span>
    )
  },
  {
    title: 'Description',
    dataIndex: 'transaction_description',
    render: (value: string | undefined) => value || 'N/A'
  },
  {
    title: 'Context',
    dataIndex: 'invoice_context_status',
    render: (_value: string | undefined, record) => renderCreditContext(record)
  },
  {
    title: 'Original Amount',
    dataIndex: 'amount',
    render: (value: number) => formatCurrency(value)
  },
  {
    title: 'Remaining',
    dataIndex: 'remaining_amount',
    render: (value: number) => formatCurrency(value)
  },
  {
    title: 'Expires',
    dataIndex: 'expiration_date',
    render: (value: string | undefined) => {
      if (!value) return <span className="text-muted-foreground">Never</span>;
      return <span>{new Date(value).toLocaleDateString()}</span>;
    }
  },
  {
    title: 'Status',
    dataIndex: 'is_expired',
    render: (isExpired: boolean, record) => {
      if (isExpired) {
        return <span className="text-red-600 font-medium">Expired</span>;
      }
      
      if (!record.expiration_date) {
        return <span className="text-blue-600 font-medium">Active</span>;
      }
      
      const now = new Date();
      const expDate = new Date(record.expiration_date);
      const daysUntilExpiration = Math.ceil((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilExpiration <= 7) {
        return <span className="text-orange-500 font-medium">Expiring Soon ({daysUntilExpiration} days)</span>;
      }
      
      return <span className="text-blue-600 font-medium">Active</span>;
    }
  },
  {
    title: 'Actions',
    dataIndex: 'credit_id',
    width: '10%',
    render: (value: string, record) => {
      const isExpired = record.is_expired;
      
      return (
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            id={`view-credit-${value}`}
          >
            View
          </Button>
          {!isExpired && (
            <>
              <Button
                variant="outline"
                size="sm"
                id={`edit-credit-${value}`}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                id={`expire-credit-${value}`}
                className="text-destructive hover:bg-destructive/10"
              >
                Expire
              </Button>
            </>
          )}
        </div>
      );
    }
  },
];

// Note: These are placeholder charts until we have proper analytics endpoints
// In a production environment, this data would come from dedicated analytics endpoints

// Function to generate expiration data based on active credits
const generateExpirationChartData = (credits: ICreditTracking[]) => {
  // Group credits by expiration timeframe
  const within7Days = credits.filter(credit =>
    credit.expiration_date &&
    new Date(credit.expiration_date).getTime() - new Date().getTime() < 7 * 24 * 60 * 60 * 1000
  );
  
  const within30Days = credits.filter(credit =>
    credit.expiration_date &&
    new Date(credit.expiration_date).getTime() - new Date().getTime() < 30 * 24 * 60 * 60 * 1000 &&
    new Date(credit.expiration_date).getTime() - new Date().getTime() >= 7 * 24 * 60 * 60 * 1000
  );
  
  const within90Days = credits.filter(credit =>
    credit.expiration_date &&
    new Date(credit.expiration_date).getTime() - new Date().getTime() < 90 * 24 * 60 * 60 * 1000 &&
    new Date(credit.expiration_date).getTime() - new Date().getTime() >= 30 * 24 * 60 * 60 * 1000
  );
  
  const beyond90Days = credits.filter(credit =>
    credit.expiration_date &&
    new Date(credit.expiration_date).getTime() - new Date().getTime() >= 90 * 24 * 60 * 60 * 1000
  );
  
  return [
    {
      name: '< 7 days',
      value: within7Days.reduce((sum, credit) => sum + credit.remaining_amount, 0),
      count: within7Days.length
    },
    {
      name: '< 30 days',
      value: within30Days.reduce((sum, credit) => sum + credit.remaining_amount, 0),
      count: within30Days.length
    },
    {
      name: '< 90 days',
      value: within90Days.reduce((sum, credit) => sum + credit.remaining_amount, 0),
      count: within90Days.length
    },
    {
      name: '> 90 days',
      value: beyond90Days.reduce((sum, credit) => sum + credit.remaining_amount, 0),
      count: beyond90Days.length
    },
  ];
};

// Placeholder for credit usage history - in production, this would come from an analytics endpoint
const placeholderCreditUsageData = [
  { month: 'Jan', applied: 4000, expired: 1000, issued: 6000 },
  { month: 'Feb', applied: 3000, expired: 500, issued: 4000 },
  { month: 'Mar', applied: 5000, expired: 1500, issued: 3000 },
  { month: 'Apr', applied: 2780, expired: 800, issued: 5000 },
  { month: 'May', applied: 1890, expired: 300, issued: 3500 },
  { month: 'Jun', applied: 2390, expired: 200, issued: 2800 },
];

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

const CREDIT_MANAGEMENT_TABS = ['active-credits', 'expired-credits', 'all-credits'] as const;
const DEFAULT_TAB = 'active-credits';

const CreditManagement: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('creditTab');

  // Determine initial active tab based on URL parameter
  const [activeTab, setActiveTab] = useState<string>(() => {
    const requestedTab = tabParam?.toLowerCase();
    return requestedTab && CREDIT_MANAGEMENT_TABS.includes(requestedTab as typeof CREDIT_MANAGEMENT_TABS[number])
      ? requestedTab
      : DEFAULT_TAB;
  });

  const [loading, setLoading] = useState(true);
  const [activeCredits, setActiveCredits] = useState<ICreditTracking[]>([]);
  const [expiredCredits, setExpiredCredits] = useState<ICreditTracking[]>([]);
  const [allCredits, setAllCredits] = useState<ICreditTracking[]>([]);
  const [isAddCreditModalOpen, setIsAddCreditModalOpen] = useState(false);
  const [creditStats, setCreditStats] = useState({
    totalActive: 0,
    totalExpired: 0,
    expiringWithin30Days: 0,
    totalCreditsIssued: 0,
    totalCreditsApplied: 0
  });

  // State for chart data
  const [expiringCreditsData, setExpiringCreditsData] = useState<Array<{name: string, value: number, count: number}>>([]);
  const [creditUsageData] = useState(placeholderCreditUsageData);

  // Pagination state for Active Credits
  const [activeCurrentPage, setActiveCurrentPage] = useState(1);
  const [activePageSize, setActivePageSize] = useState(10);

  // Pagination state for Expired Credits
  const [expiredCurrentPage, setExpiredCurrentPage] = useState(1);
  const [expiredPageSize, setExpiredPageSize] = useState(10);

  // Pagination state for All Credits
  const [allCurrentPage, setAllCurrentPage] = useState(1);
  const [allPageSize, setAllPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handleActivePageSizeChange = (newPageSize: number) => {
    setActivePageSize(newPageSize);
    setActiveCurrentPage(1);
  };

  const handleExpiredPageSizeChange = (newPageSize: number) => {
    setExpiredPageSize(newPageSize);
    setExpiredCurrentPage(1);
  };

  const handleAllPageSizeChange = (newPageSize: number) => {
    setAllPageSize(newPageSize);
    setAllCurrentPage(1);
  };

  useEffect(() => {
    // Fetch real credit data from server actions
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Get the client ID from the current context
        // In a real implementation, this would come from a context or URL parameter
        const clientId = 'current-client-id'; // This would be dynamically determined
        
        // Fetch active credits (non-expired)
        const activeCreditsResult = await listClientCredits(clientId, false, 1, 100);
        
        // Fetch expired credits
        const expiredCreditsResult = await listClientCredits(clientId, true, 1, 100);
        
        // Filter out the expired credits from the active credits result
        const activeCreditsFiltered = activeCreditsResult.credits.filter(credit => !credit.is_expired);
        
        setActiveCredits(activeCreditsFiltered);
        setExpiredCredits(expiredCreditsResult.credits);
        setAllCredits([...activeCreditsFiltered, ...expiredCreditsResult.credits]);
        
        // Calculate stats for the dashboard
        setCreditStats({
          totalActive: activeCreditsFiltered.reduce((sum, credit) => sum + credit.remaining_amount, 0),
          totalExpired: expiredCreditsResult.credits.reduce((sum, credit) => sum + credit.amount, 0),
          expiringWithin30Days: activeCreditsFiltered
            .filter(credit => credit.expiration_date &&
              new Date(credit.expiration_date).getTime() - new Date().getTime() < 30 * 24 * 60 * 60 * 1000)
            .reduce((sum, credit) => sum + credit.remaining_amount, 0),
          totalCreditsIssued: [...activeCreditsFiltered, ...expiredCreditsResult.credits]
            .reduce((sum, credit) => sum + credit.amount, 0),
          totalCreditsApplied: [...activeCreditsFiltered, ...expiredCreditsResult.credits]
            .reduce((sum, credit) => sum + (credit.amount - credit.remaining_amount), 0)
        });
        
        // Generate chart data
        setExpiringCreditsData(generateExpirationChartData(activeCreditsFiltered));
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching credit data:', error);
        setLoading(false);
      }
    };
    
    fetchData();
  }, []);

  // Update active tab when URL parameter changes
  useEffect(() => {
    const requestedTab = tabParam?.toLowerCase();
    const targetTab = requestedTab && CREDIT_MANAGEMENT_TABS.includes(requestedTab as typeof CREDIT_MANAGEMENT_TABS[number])
      ? requestedTab
      : DEFAULT_TAB;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
  }, [tabParam, activeTab]);

  const updateURL = (tabId: string) => {
    // Build new URL preserving existing parameters
    const currentSearchParams = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_TAB) {
      currentSearchParams.set('creditTab', tabId);
    } else {
      currentSearchParams.delete('creditTab');
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  };

  const handleViewAllCredits = () => {
    router.push('/msp/billing/credits');
  };

  const handleAddCredit = () => {
    setIsAddCreditModalOpen(true);
  };

  const handleSubmitAddCredit = () => {
    // In a real implementation, this would submit the form data
    console.log('Add credit submitted');
    setIsAddCreditModalOpen(false);
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
      <div className="flex justify-between items-center mb-4">
        <div className="space-x-2">
          <Button
            id="add-credit-button"
            onClick={handleAddCredit}
          >
            Add Credit
          </Button>
        </div>
      </div>
      
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Credit Management</h2>
      </div>
      
      {/* Credit Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Credit Expiration Summary</CardTitle>
            <CardDescription>Overview of credits expiring soon</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expiringCreditsData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent }: {name: string, percent: number}) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {expiringCreditsData.map((entry, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value as number)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="bg-primary/10 p-3 rounded-md">
                <p className="text-sm text-primary">Total Active Credits</p>
                <p className="text-xl font-bold">{formatCurrency(creditStats.totalActive)}</p>
              </div>
              <div className="bg-warning/10 p-3 rounded-md">
                <p className="text-sm text-warning">Expiring in 30 Days</p>
                <p className="text-xl font-bold">{formatCurrency(creditStats.expiringWithin30Days)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Credit Usage Trends</CardTitle>
            <CardDescription>Historical credit usage patterns</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={creditUsageData}
                  margin={{
                    top: 5,
                    right: 30,
                    left: 20,
                    bottom: 5,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis tickFormatter={(value) => `$${value}`} />
                  <Tooltip formatter={(value) => formatCurrency(value as number)} />
                  <Legend />
                  <Bar dataKey="issued" fill="#8884d8" name="Credits Issued" />
                  <Bar dataKey="applied" fill="#82ca9d" name="Credits Applied" />
                  <Bar dataKey="expired" fill="#ff8042" name="Credits Expired" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div className="bg-success/10 p-3 rounded-md">
                <p className="text-sm text-success">Total Credits Applied</p>
                <p className="text-xl font-bold">{formatCurrency(creditStats.totalCreditsApplied)}</p>
              </div>
              <div className="bg-destructive/10 p-3 rounded-md">
                <p className="text-sm text-destructive">Total Credits Expired</p>
                <p className="text-xl font-bold">{formatCurrency(creditStats.totalExpired)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Credits Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Credits</CardTitle>
          <CardDescription>
            View and manage your client credits. Credits stay financial artifacts, and recurring service periods appear only when the source invoice carried canonical coverage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CustomTabs
            tabs={[
              {
                id: 'active-credits',
                label: "Active Credits",
                content: (
                  <DataTable
                    id="credit-management-table"
                    columns={columns}
                    data={activeCredits}
                    pagination={true}
                    currentPage={activeCurrentPage}
                    onPageChange={setActiveCurrentPage}
                    pageSize={activePageSize}
                    onItemsPerPageChange={handleActivePageSizeChange}
                  />
                )
              },
              {
                id: 'expired-credits',
                label: "Expired Credits",
                content: (
                  <DataTable
                    id="credit-management-expired-table"
                    columns={columns}
                    data={expiredCredits}
                    pagination={true}
                    currentPage={expiredCurrentPage}
                    onPageChange={setExpiredCurrentPage}
                    pageSize={expiredPageSize}
                    onItemsPerPageChange={handleExpiredPageSizeChange}
                  />
                )
              },
              {
                id: 'all-credits',
                label: "All Credits",
                content: (
                  <DataTable
                    id="credit-management-all-table"
                    columns={columns}
                    data={allCredits}
                    pagination={true}
                    currentPage={allCurrentPage}
                    onPageChange={setAllCurrentPage}
                    pageSize={allPageSize}
                    onItemsPerPageChange={handleAllPageSizeChange}
                  />
                )
              }
            ]}
            defaultTab={activeTab}
            onTabChange={(tabId) => {
              setActiveTab(tabId);
              updateURL(tabId);
            }}
          />
          
          <div className="mt-4 flex justify-end">
            <Button 
              variant="outline" 
              onClick={handleViewAllCredits}
              id="view-all-credits-button"
            >
              View All Credits
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Add Credit Modal */}
      <Dialog
        isOpen={isAddCreditModalOpen}
        onClose={() => setIsAddCreditModalOpen(false)}
        title="Add Credit"
      >
        <DialogContent>
          {/* Add credit form would go here */}
          <div className="py-4">
            <p className="text-muted-foreground">
              Credit amount and details form would be implemented here.
            </p>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="cancel-add-credit-button"
            variant="outline"
            onClick={() => setIsAddCreditModalOpen(false)}
          >
            Cancel
          </Button>
          <Button
            id="submit-add-credit-button"
            onClick={handleSubmitAddCredit}
          >
            Add Credit
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

export default CreditManagement;
