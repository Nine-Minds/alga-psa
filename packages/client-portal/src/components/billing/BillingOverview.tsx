'use client';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal billing screens intentionally compose billing feature components for customer-facing account pages. */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { useSearchParams } from 'next/navigation';
import { CustomTabs, TabContent } from '@alga-psa/ui/components/CustomTabs';
import {
  getClientContractLine,
  getClientInvoices,
  getClientQuotes,
  getClientExternalCreditNotice,
  getCurrentUsage
} from '@alga-psa/client-portal/actions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  getClientHoursByService,
  getClientBucketUsage,
  getClientBucketUsageHistory,
  getClientUsageMetrics,
  ClientHoursByServiceResult,
  ClientBucketUsageResult,
  ClientUsageMetricResult
} from '@alga-psa/client-portal/actions';
import { format, subDays } from 'date-fns';
import {
  IClientContractLine,
  IBucketUsage,
  IService
} from '@alga-psa/types';
import { getInvoiceForRendering } from '@alga-psa/billing/actions/invoiceQueries';
import type { InvoiceViewModel, IQuoteWithClient } from '@alga-psa/types';
import dynamic from 'next/dynamic';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

// Lazy load components that aren't immediately visible
const InvoiceDetailsDialog = dynamic(() => import('./InvoiceDetailsDialog'), {
  loading: () => <div className="loading-dialog-skeleton animate-pulse p-6 bg-[rgb(var(--color-card))] rounded-lg shadow-lg">
    <div className="h-6 w-1/3 skeleton-fill rounded mb-4"></div>
    <div className="space-y-3">
      <div className="h-4 skeleton-fill rounded w-full"></div>
      <div className="h-4 skeleton-fill rounded w-full"></div>
      <div className="h-4 skeleton-fill rounded w-3/4"></div>
    </div>
  </div>
});

// Always load the overview tab eagerly as it's the default tab
import BillingOverviewTab from './BillingOverviewTab';
import { getPortalBillingProfiles } from '../../actions/client-portal-actions/client-billing-segments';
import BillingSegmentsTab from './BillingSegmentsTab';

// Lazy load other tabs
const InvoicesTab = dynamic(() => import('./InvoicesTab'), {
  loading: () => <div id="invoices-tab-skeleton" className="animate-pulse p-4">
    <div className="h-10 skeleton-fill rounded w-full mb-4"></div>
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 skeleton-fill rounded w-full"></div>
      ))}
    </div>
  </div>
});

const QuotesTab = dynamic(() => import('./QuotesTab'), {
  loading: () => <div id="quotes-tab-skeleton" className="animate-pulse p-4">
    <div className="h-10 skeleton-fill rounded w-full mb-4"></div>
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-12 skeleton-fill rounded w-full"></div>
      ))}
    </div>
  </div>
});

const HoursByServiceTab = dynamic(() => import('./HoursByServiceTab'), {
  loading: () => <div id="hours-service-tab-skeleton" className="animate-pulse p-4">
    <div className="h-24 skeleton-fill rounded w-full mb-4"></div>
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 skeleton-fill rounded w-full"></div>
      ))}
    </div>
  </div>
});

const UsageMetricsTab = dynamic(() => import('./UsageMetricsTab'), {
  loading: () => <div id="usage-metrics-tab-skeleton" className="animate-pulse p-4">
    <div className="h-24 skeleton-fill rounded w-full mb-4"></div>
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 skeleton-fill rounded w-full"></div>
      ))}
    </div>
  </div>
});

const BucketUsageHistoryChart = dynamic(() => import('./BucketUsageHistoryChart'), {
  loading: () => <div id="bucket-history-skeleton" className="animate-pulse p-4">
    <div className="h-48 skeleton-fill rounded w-full"></div>
  </div>
});

// Flag to control visibility of advanced usage tabs and metrics
const SHOW_USAGE_FEATURES = true;
const DEFAULT_BILLING_TAB = 'overview';
// Single source of truth for every billing tab id the URL `?tab=` param may
// select. Keep this in sync with the tabs assembled in the `tabs` memo below —
// a tab that renders but is missing here is unreachable, because the URL-sync
// effect resets any unrecognised value back to DEFAULT_BILLING_TAB. (A tab that
// is conditionally hidden, e.g. `segments` at segmentCount <= 1, is still safe
// to list: CustomTabs falls back gracefully when the selected id isn't present.)
const BILLING_TAB_IDS = [
  'overview',
  'invoices',
  'quotes',
  'segments',
  'hours-by-service',
  'usage-metrics',
] as const;
const isBillingActionError = (
  value: unknown
): value is { readonly actionError: string } | { readonly permissionError: string } =>
  isActionMessageError(value) || isActionPermissionError(value);

export default function BillingOverview() {
  const { money } = useCurrencyFormat();
  const { t } = useTranslation('features/billing');
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // Determine initial tab from URL parameter
  const initialTab = useMemo(() => {
    if (tabParam && (BILLING_TAB_IDS as readonly string[]).includes(tabParam)) {
      return tabParam;
    }
    return DEFAULT_BILLING_TAB;
  }, [tabParam]);

  const [currentTab, setCurrentTab] = useState<string | null>(initialTab);
  const [contractLine, setContractLine] = useState<IClientContractLine | null>(null);
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
  const [bucketUsageHistory, setBucketUsageHistory] = useState<Array<{
    service_id: string;
    service_name: string;
    history: Array<{
      period_start: string;
      period_end: string;
      percentage_used: number;
      hours_used: number;
      hours_total: number;
    }>;
  }>>([]);
  const [usageMetrics, setUsageMetrics] = useState<ClientUsageMetricResult[]>([]);
  const [isBucketUsageLoading, setIsBucketUsageLoading] = useState(false);
  const [isBucketHistoryLoading, setIsBucketHistoryLoading] = useState(false);
  const [isHoursLoading, setIsHoursLoading] = useState(false);
  const [isUsageMetricsLoading, setIsUsageMetricsLoading] = useState(false);
  const [quotes, setQuotes] = useState<IQuoteWithClient[]>([]);
  const [hasInvoiceAccess, setHasInvoiceAccess] = useState(true); // Default to true to avoid hydration mismatch
  // Segment count drives the D6 invisibility rule on the portal (F072/F077): a
  // client with one billing profile sees exactly the portal it saw before.
  const [segmentCount, setSegmentCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: ''
  });

  // Set date range after mount to avoid hydration issues
  useEffect(() => {
    const now = new Date();
    setDateRange({
      startDate: format(subDays(now, 30), 'yyyy-MM-dd'),
      endDate: format(now, 'yyyy-MM-dd')
    });
  }, []);

  // Update active tab when URL parameter changes
  useEffect(() => {
    const targetTab = tabParam && (BILLING_TAB_IDS as readonly string[]).includes(tabParam)
      ? tabParam
      : DEFAULT_BILLING_TAB;
    if (targetTab !== currentTab) {
      setCurrentTab(targetTab);
    }
  }, [tabParam, currentTab]);

  // Credit held in the MSP's accounting system: invoices can show open here
  // until the bookkeeper applies that credit, so tell the customer.
  const [externalCredit, setExternalCredit] = useState<{ hasExternalCredit: boolean; note: string | null } | null>(null);
  useEffect(() => {
    let isMounted = true;
    getClientExternalCreditNotice()
      .then((notice) => {
        if (isMounted) setExternalCredit(notice);
      })
      .catch(() => {
        // The notice is best-effort; billing renders without it.
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Load billing data
  useEffect(() => {
    let isMounted = true;
    const loadBillingData = async () => {
      try {
        setBillingError(null);

        // Load contract line and usage data for all users
        const [plan, usageData] = await Promise.all([
          getClientContractLine(),
          getCurrentUsage()
        ]);

        if (!isMounted) return;

        if (isBillingActionError(plan)) {
          setContractLine(null);
          setBillingError(getErrorMessage(plan));
        } else {
          setContractLine(plan);
        }

        if (isBillingActionError(usageData)) {
          setUsage({ bucketUsage: null, services: [] });
          setBillingError((current) => current ?? getErrorMessage(usageData));
        } else {
          setUsage(usageData);
        }
        
        // Try to load invoices and quotes (will fail if user doesn't have permission)
        try {
          const [invoiceData, quotesData] = await Promise.all([
            getClientInvoices(),
            getClientQuotes(),
          ]);
          if (!isMounted) return;

          if (isBillingActionError(invoiceData) || isBillingActionError(quotesData)) {
            const message = isBillingActionError(invoiceData)
              ? getErrorMessage(invoiceData)
              : getErrorMessage(quotesData);
            setInvoices([]);
            setQuotes([]);
            setHasInvoiceAccess(false);
            setBillingError((current) => current ?? message);
          } else {
            setInvoices(invoiceData);
            setQuotes(quotesData);
            setHasInvoiceAccess(true);
          }
        } catch (error) {
          if (!isMounted) return;
          console.error('User does not have access to invoices:', error);
          setHasInvoiceAccess(false);
        }

        // How many billing profiles this viewer may see. Zero or one means the
        // client is not segmented (or this user is restricted to one segment),
        // and no segment UI is offered at all.
        try {
          const segments = await getPortalBillingProfiles();
          if (isMounted) {
            setSegmentCount(Array.isArray(segments) ? segments.length : 0);
          }
        } catch {
          if (isMounted) setSegmentCount(0);
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

        // Load bucket usage history
        setIsBucketHistoryLoading(true);
        try {
          const bucketHistoryData = await getClientBucketUsageHistory();
          if (!isMounted) return;
          setBucketUsageHistory(bucketHistoryData);
        } catch (error) {
          if (!isMounted) return;
          console.error('Error loading bucket usage history:', error);
        } finally {
          if (isMounted) {
            setIsBucketHistoryLoading(false);
          }
        }
        
      } catch (error) {
        if (!isMounted) return;
        console.error('Error loading billing data:', error);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
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
      // Compare against the tab id: currentTab carries ids, and the display
      // label is translated so it can never be a stable comparison key.
      if (currentTab === 'hours-by-service') {
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
      if (currentTab === 'usage-metrics') {
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
  // Note: Invoice amounts are stored in cents; money() takes minor units and
  // formats with the tenant's locale + currency from CurrencyFormatProvider.
  const formatCurrency = useCallback((amountInCents: number, currencyCode?: string) => {
    return money(amountInCents, currencyCode);
  }, [money]);

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
      if (isActionMessageError(fullInvoice) || isActionPermissionError(fullInvoice)) {
        console.error('Failed to fetch invoice details:', getErrorMessage(fullInvoice));
        setSelectedInvoice(invoice);
        return;
      }
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
    setCurrentTab('invoices');
    // Update URL when navigating to Invoices tab
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('tab', 'invoices');
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.pushState({}, '', newUrl);
    }
  }, []);

  // Create a function to switch to the Quotes tab
  const handleViewAllQuotes = useCallback(() => {
    setCurrentTab('quotes');
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      params.set('tab', 'quotes');
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.pushState({}, '', newUrl);
    }
  }, []);

  // Memoize tabs to prevent unnecessary re-renders
  const tabs: TabContent[] = useMemo(() => {
    const tabsArray: TabContent[] = [
      {
        id: 'overview',
        label: t('tabs.overview'),
        content: (
          <div id="overview-tab">
            <BillingOverviewTab
              contractLine={contractLine}
              invoices={invoices}
              quotes={quotes}
              bucketUsage={bucketUsage}
              isBucketUsageLoading={isBucketUsageLoading}
              isLoading={isLoading}
              formatCurrency={formatCurrency}
              formatDate={formatDate}
              onViewAllInvoices={handleViewAllInvoices}
              onViewAllQuotes={handleViewAllQuotes}
            />
          </div>
        ),
      }
    ];

    // Add Invoices tab only if user has access
    if (hasInvoiceAccess) {
      tabsArray.push({
        id: 'invoices',
        label: t('tabs.invoices'),
        content: (
          <div id="invoices-tab">
            <InvoicesTab
              formatCurrency={formatCurrency}
              formatDate={formatDate}
            />
          </div>
        ),
      });

      tabsArray.push({
        id: 'quotes',
        label: t('tabs.quotes', 'Quotes'),
        content: (
          <div id="quotes-tab">
            <QuotesTab
              formatCurrency={formatCurrency}
              formatDate={formatDate}
            />
          </div>
        ),
      });
    }

    // Segments tab — only once the client actually has more than one billing
    // profile. One profile means one segment, and a breakdown of one row is
    // not information (F077).
    if (hasInvoiceAccess && segmentCount > 1) {
      tabsArray.push({
        id: 'segments',
        label: t('tabs.segments', { defaultValue: 'By segment' }),
        content: (
          <div id="segments-tab">
            <BillingSegmentsTab formatCurrency={formatCurrency} formatDate={formatDate} />
          </div>
        ),
      });
    }

    if (SHOW_USAGE_FEATURES) {
      // Add Hours by Service tab
      tabsArray.push({
        id: 'hours-by-service',
        label: t('tabs.hoursByService', 'Hours by Service'),
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

      // Add Usage Metrics tab
      tabsArray.push({
        id: 'usage-metrics',
        label: t('tabs.usageMetrics', 'Usage Metrics'),
        content: (
          <div id="usage-metrics-tab">
            <UsageMetricsTab
              usageMetrics={usageMetrics}
              isUsageMetricsLoading={isUsageMetricsLoading}
              bucketUsageHistory={bucketUsageHistory}
              isBucketHistoryLoading={isBucketHistoryLoading}
              dateRange={dateRange}
              handleDateRangeChange={handleDateRangeChange}
            />
          </div>
        ),
      });
    }
    
    return tabsArray;
  }, [
    contractLine,
    invoices,
    bucketUsage,
    isBucketUsageLoading,
    bucketUsageHistory,
    isBucketHistoryLoading,
    isLoading,
    hasInvoiceAccess,
    segmentCount,
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
    handleViewAllInvoices,
    handleViewAllQuotes,
    quotes,
    t
  ]);

  // Helper function to update URL with tab parameter
  const updateURL = useCallback((tabId: string) => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);

    if (tabId !== DEFAULT_BILLING_TAB) {
      params.set('tab', tabId);
    } else {
      params.delete('tab');
    }

    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  }, []);

  // Memoize the tab change handler
  const handleTabChange = useCallback((tabValue: string) => {
    setCurrentTab(tabValue);
    updateURL(tabValue);
  }, [updateURL]);

  // Memoize the dialog close handler
  const handleDialogClose = useCallback(() => {
    setIsInvoiceDialogOpen(false);
  }, []);

  return (
    <div id="client-billing-overview" className="space-y-6">
      {billingError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {billingError}
        </div>
      )}

      {externalCredit?.hasExternalCredit && (
        <Alert id="client-billing-external-credit-notice">
          <AlertDescription>
            {t(
              'externalCreditNotice',
              'Your account has a credit balance on file with our billing team. Recent invoices may show as open until that credit is applied.'
            )}
            {externalCredit.note ? ` ${externalCredit.note}` : ''}
          </AlertDescription>
        </Alert>
      )}
      <CustomTabs
        tabs={tabs}
        defaultTab={currentTab || tabs[0]?.id}
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
