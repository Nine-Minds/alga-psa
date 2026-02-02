'use client';

import { Suspense, useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import {
  SlaPolicyList,
  SlaPolicyForm,
  SlaPauseSettings,
  BusinessHoursSettings,
  EscalationManagerSettings,
  SlaMetricsCards,
  SlaComplianceGauge,
  SlaTrendChart,
  SlaBreachChart,
  SlaBreachesTable,
  SlaTicketsAtRisk
} from '@alga-psa/sla/components';
import {
  getSlaOverview,
  getSlaTrend,
  getBreachRateByPriority,
  getRecentBreaches,
  getTicketsAtRisk
} from '@alga-psa/sla/actions';
import {
  ISlaPolicy,
  ISlaOverview,
  ISlaTrendDataPoint,
  ISlaBreachRateByDimension,
  ISlaRecentBreach,
  ISlaTicketAtRisk,
  ISlaReportingFilters
} from '@alga-psa/sla/types';
import { Button } from '@alga-psa/ui/components/Button';
import { ArrowLeft, RefreshCw, Calendar } from 'lucide-react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

// Map URL slugs to tab labels
const TAB_SLUG_TO_LABEL: Record<string, string> = {
  'dashboard': 'Dashboard',
  'policies': 'Policies',
  'business-hours': 'Business Hours',
  'pause-rules': 'Pause Rules',
  'escalation': 'Escalation',
};

// Map tab labels to URL slugs
const TAB_LABEL_TO_SLUG: Record<string, string> = {
  'Dashboard': 'dashboard',
  'Policies': 'policies',
  'Business Hours': 'business-hours',
  'Pause Rules': 'pause-rules',
  'Escalation': 'escalation',
};

const DEFAULT_TAB = 'Dashboard';

type DateRangeOption = '7d' | '14d' | '30d' | '90d';

const DATE_RANGE_OPTIONS: { value: DateRangeOption; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' }
];

export default function SlaSettingsPage() {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get('tab');

  // State for policy form management
  const [editingPolicy, setEditingPolicy] = useState<ISlaPolicy | null>(null);
  const [isAddingPolicy, setIsAddingPolicy] = useState(false);

  // Dashboard state
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');
  const [overview, setOverview] = useState<ISlaOverview | null>(null);
  const [trendData, setTrendData] = useState<ISlaTrendDataPoint[]>([]);
  const [breachByPriority, setBreachByPriority] = useState<ISlaBreachRateByDimension[]>([]);
  const [recentBreaches, setRecentBreaches] = useState<ISlaRecentBreach[]>([]);
  const [atRiskTickets, setAtRiskTickets] = useState<ISlaTicketAtRisk[]>([]);

  // Determine initial tab from URL
  const getInitialTab = (): string => {
    if (!tabParam) return DEFAULT_TAB;
    return TAB_SLUG_TO_LABEL[tabParam.toLowerCase()] || DEFAULT_TAB;
  };

  const [currentTab, setCurrentTab] = useState<string>(getInitialTab());

  // Sync state when URL changes
  useEffect(() => {
    const newTab = getInitialTab();
    if (newTab !== currentTab) {
      setCurrentTab(newTab);
      // Reset form state when switching tabs
      setEditingPolicy(null);
      setIsAddingPolicy(false);
    }
  }, [tabParam]);

  // Update URL when tab changes
  const updateURL = useCallback((tabLabel: string) => {
    const currentSearchParams = new URLSearchParams(window.location.search);
    const urlSlug = TAB_LABEL_TO_SLUG[tabLabel];

    if (urlSlug && tabLabel !== DEFAULT_TAB) {
      currentSearchParams.set('tab', urlSlug);
    } else {
      currentSearchParams.delete('tab');
    }

    const newUrl = currentSearchParams.toString()
      ? `${window.location.pathname}?${currentSearchParams.toString()}`
      : window.location.pathname;

    window.history.pushState({}, '', newUrl);
  }, []);

  // Handle tab change
  const handleTabChange = useCallback((newTab: string) => {
    if (newTab === currentTab) return;
    setCurrentTab(newTab);
    updateURL(newTab);
    // Reset form state when switching tabs
    setEditingPolicy(null);
    setIsAddingPolicy(false);
  }, [currentTab, updateURL]);

  // Policy form handlers
  const handleAddPolicy = useCallback(() => {
    setEditingPolicy(null);
    setIsAddingPolicy(true);
  }, []);

  const handleEditPolicy = useCallback((policy: ISlaPolicy) => {
    setEditingPolicy(policy);
    setIsAddingPolicy(false);
  }, []);

  const handleFormSave = useCallback(() => {
    setEditingPolicy(null);
    setIsAddingPolicy(false);
  }, []);

  const handleFormCancel = useCallback(() => {
    setEditingPolicy(null);
    setIsAddingPolicy(false);
  }, []);

  // Dashboard data fetching
  const getFilters = useCallback((): ISlaReportingFilters => {
    const days = parseInt(dateRange.replace('d', ''));
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { dateFrom };
  }, [dateRange]);

  const fetchDashboardData = useCallback(async () => {
    try {
      setDashboardLoading(true);
      const filters = getFilters();
      const days = parseInt(dateRange.replace('d', ''));

      const [
        overviewData,
        trendResult,
        breachByPriorityResult,
        recentBreachesResult,
        atRiskResult
      ] = await Promise.all([
        getSlaOverview(filters),
        getSlaTrend(filters, days),
        getBreachRateByPriority(filters),
        getRecentBreaches(filters, 10),
        getTicketsAtRisk(10)
      ]);

      setOverview(overviewData);
      setTrendData(trendResult);
      setBreachByPriority(breachByPriorityResult);
      setRecentBreaches(recentBreachesResult);
      setAtRiskTickets(atRiskResult);
    } catch (error) {
      console.error('Error fetching SLA dashboard data:', error);
    } finally {
      setDashboardLoading(false);
    }
  }, [getFilters, dateRange]);

  // Fetch dashboard data when switching to Dashboard tab or when date range changes
  useEffect(() => {
    if (currentTab === 'Dashboard') {
      fetchDashboardData();
    }
  }, [currentTab, dateRange, fetchDashboardData]);

  // Determine if we're showing the form or the list for the Policies tab
  const showPolicyForm = isAddingPolicy || editingPolicy !== null;

  // Render the policies tab content based on state
  const renderPoliciesContent = () => {
    if (showPolicyForm) {
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              id="back-to-policies-list"
              variant="ghost"
              size="sm"
              onClick={handleFormCancel}
              className="gap-1"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Policies
            </Button>
            <h2 className="text-lg font-medium">
              {editingPolicy ? 'Edit SLA Policy' : 'Create SLA Policy'}
            </h2>
          </div>
          <SlaPolicyForm
            policyId={editingPolicy?.sla_policy_id}
            onSave={handleFormSave}
            onCancel={handleFormCancel}
          />
        </div>
      );
    }

    return (
      <Suspense fallback={
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator
            layout="stacked"
            text="Loading SLA policies..."
            spinnerProps={{ size: 'md' }}
          />
        </div>
      }>
        <SlaPolicyList
          onAddPolicy={handleAddPolicy}
          onEditPolicy={handleEditPolicy}
        />
      </Suspense>
    );
  };

  // Render the dashboard tab content
  const renderDashboardContent = () => {
    if (dashboardLoading && !overview) {
      return (
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator
            layout="stacked"
            text="Loading SLA dashboard..."
            spinnerProps={{ size: 'md' }}
          />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Header with date range and refresh */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <CustomSelect
              options={DATE_RANGE_OPTIONS}
              value={dateRange}
              onValueChange={(value) => setDateRange(value as DateRangeOption)}
              placeholder="Select date range"
            />
          </div>
          <Button
            id="refresh-sla-dashboard"
            variant="outline"
            size="sm"
            onClick={fetchDashboardData}
            disabled={dashboardLoading}
            className="gap-1"
          >
            <RefreshCw className={`h-4 w-4 ${dashboardLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Metrics Cards */}
        <SlaMetricsCards data={overview} loading={dashboardLoading} />

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SlaTrendChart data={trendData} loading={dashboardLoading} />
          <SlaComplianceGauge
            overallRate={overview?.compliance?.overallRate ?? 0}
            responseRate={overview?.compliance?.responseRate ?? 0}
            resolutionRate={overview?.compliance?.resolutionRate ?? 0}
            loading={dashboardLoading}
          />
        </div>

        {/* Breach Chart */}
        <SlaBreachChart data={breachByPriority} loading={dashboardLoading} />

        {/* Tables Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SlaTicketsAtRisk data={atRiskTickets} loading={dashboardLoading} />
          <SlaBreachesTable data={recentBreaches} loading={dashboardLoading} />
        </div>
      </div>
    );
  };

  const tabs = [
    {
      label: 'Dashboard',
      content: renderDashboardContent(),
    },
    {
      label: 'Policies',
      content: renderPoliciesContent(),
    },
    {
      label: 'Business Hours',
      content: (
        <Suspense fallback={
          <div className="flex items-center justify-center py-8">
            <LoadingIndicator
              layout="stacked"
              text="Loading business hours..."
              spinnerProps={{ size: 'md' }}
            />
          </div>
        }>
          <BusinessHoursSettings />
        </Suspense>
      ),
    },
    {
      label: 'Pause Rules',
      content: (
        <Suspense fallback={
          <div className="flex items-center justify-center py-8">
            <LoadingIndicator
              layout="stacked"
              text="Loading pause settings..."
              spinnerProps={{ size: 'md' }}
            />
          </div>
        }>
          <SlaPauseSettings />
        </Suspense>
      ),
    },
    {
      label: 'Escalation',
      content: (
        <Suspense fallback={
          <div className="flex items-center justify-center py-8">
            <LoadingIndicator
              layout="stacked"
              text="Loading escalation settings..."
              spinnerProps={{ size: 'md' }}
            />
          </div>
        }>
          <EscalationManagerSettings />
        </Suspense>
      ),
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">SLA Settings</h1>
        <p className="text-gray-600 text-sm mt-1">
          Configure service level agreement policies, business hours, and pause rules
        </p>
      </div>
      <CustomTabs
        tabs={tabs}
        value={currentTab}
        onTabChange={handleTabChange}
        idPrefix="sla-settings"
      />
    </div>
  );
}
