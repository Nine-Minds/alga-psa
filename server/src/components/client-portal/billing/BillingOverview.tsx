'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { CustomTabs, TabContent } from 'server/src/components/ui/CustomTabs';
import {
  getClientBillingPlan,
  getClientInvoices,
  getCurrentUsage
} from 'server/src/lib/actions/client-portal-actions/client-billing';
import {
  getClientHoursByService,
  getClientBucketUsage,
  getClientUsageMetrics,
  ClientHoursByServiceResult,
  ClientBucketUsageResult,
  ClientUsageMetricResult
} from 'server/src/lib/actions/client-portal-actions/client-billing-metrics';
import { format, subDays } from 'date-fns';
import {
  ICompanyBillingPlan,
  IBucketUsage,
  IService
} from 'server/src/interfaces/billing.interfaces';
import { getInvoiceForRendering } from 'server/src/lib/actions/invoiceQueries';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import dynamic from 'next/dynamic';

// Lazy load components that aren't immediately visible
const InvoiceDetailsDialog = dynamic(() => import('./InvoiceDetailsDialog'), {
  loading: () => <div className="loading-dialog-skeleton animate-pulse p-6 bg-white rounded-lg shadow-lg">
    <div className="h-6 w-1/3 bg-gray-200 rounded mb-4"></div>
    <div className="space-y-3">
      <div className="h-4 bg-gray-200 rounded w-full"></div>
      <div className="h-4 bg-gray-200 rounded w-full"></div>
      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
    </div>
  </div>
});

// Always load the overview tab eagerly as it's the default tab
import BillingOverviewTab from './BillingOverviewTab';

// Lazy load other tabs
const InvoicesTab = dynamic(() => import('./InvoicesTab'), {
  loading: () => <div id="invoices-tab-skeleton" className="animate-pulse p-4">
    <div className="h-10 bg-gray-200 rounded w-full mb-4"></div>
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 bg-gray-200 rounded w-full"></div>
      ))}
    </div>
  </div>
});

const HoursByServiceTab = dynamic(() => import('./HoursByServiceTab'), {
  loading: () => <div id="hours-service-tab-skeleton" className="animate-pulse p-4">
    <div className="h-24 bg-gray-200 rounded w-full mb-4"></div>
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 bg-gray-200 rounded w-full"></div>
      ))}
    </div>
  </div>
});

const UsageMetricsTab = dynamic(() => import('./UsageMetricsTab'), {
  loading: () => <div id="usage-metrics-tab-skeleton" className="animate-pulse p-4">
    <div className="h-24 bg-gray-200 rounded w-full mb-4"></div>
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 bg-gray-200 rounded w-full"></div>
      ))}
    </div>
  </div>
});
export default function BillingOverview() {
  const [currentTab, setCurrentTab] = useState('Overview');
  const [billingPlan, setBillingPlan] = useState<ICompanyBillingPlan | null>(null);
  const [invoices, setInvoices] = useState<InvoiceViewModel[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [usage, setUsage] = useState<{ bucketUsage: IBucketUsage | null; services: IService[] }>({
    bucketUsage: null,
    services: []
  });
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceViewModel | null>(null);
  const [isInvoiceDialogOpen, setIsInvoiceDialogOpen] = useState(false);
  const [hoursByService, setHoursByService] = useState<ClientHoursByServiceResult[]>([]);
  const [bucketUsage, setBucketUsage] = useState<ClientBucketUsageResult[]>([]);
  const [usageMetrics, setUsageMetrics] = useState<ClientUsageMetricResult[]>([]);
  const [isBucketUsageLoading, setIsBucketUsageLoading] = useState(false);
  const [isHoursLoading, setIsHoursLoading] = useState(false);
  const [isUsageMetricsLoading, setIsUsageMetricsLoading] = useState(false);
  const [hasInvoiceAccess, setHasInvoiceAccess] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [dateRange, setDateRange] = useState({
    startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd')
  });

  // Set isClient to true when component mounts (client-side only)
  useEffect(() => {
    setIsClient(true);
    return () => {
      // Cleanup function to prevent memory leaks
      setIsClient(false);
    };
  }, []);

  // Load billing data
  useEffect(() => {
    let isMounted = true;
    const loadBillingData = async () => {
      try {
        // Load billing plan and usage data for all users
        const [plan, usageData] = await Promise.all([
          getClientBillingPlan(),
          getCurrentUsage()
        ]);

        if (!isMounted) return;
        
        setBillingPlan(plan);
        setUsage(usageData);
        
        // Try to load invoices (will fail if user doesn't have permission)
        try {
          const invoiceData = await getClientInvoices();
          if (!isMounted) return;
          setInvoices(invoiceData);
          setHasInvoiceAccess(true);
        } catch (error) {
          if (!isMounted) return;
          console.error('User does not have access to invoices:', error);
          setHasInvoiceAccess(false);
        }
        
        // Load enhanced bucket usage data
        setIsBucketUsageLoading(true);
        try {
          const bucketUsageData = await getClientBucketUsage();
          if (!isMounted) return;
          setBucketUsage(bucketUsageData);
        } catch (error) {
          if (!isMounted) return;
          console.error('Error loading bucket usage data:', error);
        } finally {
          if (isMounted) {
            setIsBucketUsageLoading(false);
          }
        }
        
      } catch (error) {
        if (!isMounted) return;
        console.error('Error loading billing data:', error);
      }
    };

    loadBillingData();
    
    // Cleanup function to prevent memory leaks
    return () => {
      isMounted = false;
    };
  }, []);
  
  // Load hours by service data when tab changes or date range changes (all users have access)
  useEffect(() => {
    let isMounted = true;
    
    const loadHoursByService = async () => {
      if (currentTab === 'Hours by Service') {
        setIsHoursLoading(true);
        try {
          const data = await getClientHoursByService({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            groupByServiceType: false
          });
          if (!isMounted) return;
          setHoursByService(data);
        } catch (error) {
          if (!isMounted) return;
          console.error('Error loading hours by service data:', error);
        } finally {
          if (isMounted) {
            setIsHoursLoading(false);
          }
        }
      }
    };

    loadHoursByService();
    
    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [currentTab, dateRange]);

  // Load usage metrics data when tab changes or date range changes (all users have access)
  useEffect(() => {
    let isMounted = true;
    
    const loadUsageMetrics = async () => {
      if (currentTab === 'Usage Metrics') {
        setIsUsageMetricsLoading(true);
        try {
          const data = await getClientUsageMetrics({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate
          });
          if (!isMounted) return;
          setUsageMetrics(data);
        } catch (error) {
          if (!isMounted) return;
          console.error('Error loading usage metrics data:', error);
        } finally {
          if (isMounted) {
            setIsUsageMetricsLoading(false);
          }
        }
      }
    };

    loadUsageMetrics();
    
    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [currentTab, dateRange]);

  // Memoize formatters to prevent unnecessary re-creation
  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }, []);

  // Safe date formatter that works consistently on both server and client
  const formatDate = useCallback((date: string | { toString(): string } | undefined | null) => {
    if (!date) {
      return 'N/A';
    }
    try {
      const dateStr = typeof date === 'string' ? date : date.toString();
      const dateObj = new Date(dateStr);
      
      // Use a more consistent date formatting approach
      const year = dateObj.getFullYear();
      const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(dateObj);
      const day = dateObj.getDate();
      
      return `${month} ${day}, ${year}`;
    } catch (error) {
      console.error('Error formatting date:', error);
      return 'Invalid date';
    }
  }, []);

  // Use useCallback for event handlers to prevent unnecessary re-renders
  const handleInvoiceClick = useCallback(async (invoice: InvoiceViewModel) => {
    try {
      setIsInvoiceDialogOpen(true); // Show dialog immediately with loading state
      const fullInvoice = await getInvoiceForRendering(invoice.invoice_id);
      setSelectedInvoice(fullInvoice);
    } catch (error) {
      console.error('Failed to fetch invoice details:', error);
      setSelectedInvoice(invoice); // fallback to basic invoice
    }
  }, []);

  // Handle date range change
  const handleDateRangeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>, field: 'startDate' | 'endDate') => {
    setDateRange(prev => ({
      ...prev,
      [field]: e.target.value
    }));
  }, []);

  // Create a function to switch to the Invoices tab
  const handleViewAllInvoices = useCallback(() => {
    setCurrentTab('Invoices');
  }, []);

  // Memoize tabs to prevent unnecessary re-renders
  const tabs: TabContent[] = useMemo(() => {
    const tabsArray: TabContent[] = [
      {
        label: 'Overview',
        content: (
          <div id="overview-tab">
            <BillingOverviewTab
              billingPlan={billingPlan}
              invoices={invoices}
              bucketUsage={bucketUsage}
              isBucketUsageLoading={isBucketUsageLoading}
              isClient={isClient}
              formatCurrency={formatCurrency}
              formatDate={formatDate}
              onViewAllInvoices={handleViewAllInvoices}
            />
          </div>
        ),
      }
    ];

    // Add Invoices tab only if user has access
    if (hasInvoiceAccess) {
      tabsArray.push({
        label: 'Invoices',
        content: (
          <div id="invoices-tab">
            <InvoicesTab
              formatCurrency={formatCurrency}
              formatDate={formatDate}
            />
          </div>
        ),
      });
    }

    // Add Hours by Service tab (all users have access)
    tabsArray.push({
      label: 'Hours by Service',
      content: (
        <div id="hours-service-tab">
          <HoursByServiceTab
            hoursByService={hoursByService}
            isHoursLoading={isHoursLoading}
            dateRange={dateRange}
            handleDateRangeChange={handleDateRangeChange}
          />
        </div>
      ),
    });

    // Add Usage Metrics tab (all users have access)
    tabsArray.push({
      label: 'Usage Metrics',
      content: (
        <div id="usage-metrics-tab">
          <UsageMetricsTab
            usageMetrics={usageMetrics}
            isUsageMetricsLoading={isUsageMetricsLoading}
            dateRange={dateRange}
            handleDateRangeChange={handleDateRangeChange}
          />
        </div>
      ),
    });
    
    return tabsArray;
  }, [
    billingPlan,
    invoices,
    bucketUsage,
    isBucketUsageLoading,
    isClient,
    hasInvoiceAccess,
    currentPage,
    hoursByService,
    isHoursLoading,
    usageMetrics,
    isUsageMetricsLoading,
    dateRange,
    formatCurrency,
    formatDate,
    handleInvoiceClick,
    handleDateRangeChange,
    handleViewAllInvoices
  ]);

  // Memoize the tab change handler
  const handleTabChange = useCallback((tabValue: string) => {
    setCurrentTab(tabValue);
  }, []);

  // Memoize the dialog close handler
  const handleDialogClose = useCallback(() => {
    setIsInvoiceDialogOpen(false);
  }, []);

  return (
    <div id="client-billing-overview" className="space-y-6">
      <CustomTabs
        tabs={tabs}
        defaultTab={currentTab}
        onTabChange={handleTabChange}
      />

      <InvoiceDetailsDialog
        invoiceId={selectedInvoice?.invoice_id || null}
        isOpen={isInvoiceDialogOpen}
        onClose={handleDialogClose}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
      />
    </div>
  );
}
