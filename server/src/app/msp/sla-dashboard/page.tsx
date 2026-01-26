'use client';

/**
 * SLA Dashboard Page
 *
 * Main dashboard for SLA metrics, compliance, and reporting.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { RefreshCw, Settings, Calendar } from 'lucide-react';
import {
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
  ISlaOverview,
  ISlaTrendDataPoint,
  ISlaBreachRateByDimension,
  ISlaRecentBreach,
  ISlaTicketAtRisk,
  ISlaReportingFilters
} from '@alga-psa/sla/types';
import Link from 'next/link';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

type DateRangeOption = '7d' | '14d' | '30d' | '90d';

const DATE_RANGE_OPTIONS: { value: DateRangeOption; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' }
];

export default function SlaDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRangeOption>('30d');

  // Data state
  const [overview, setOverview] = useState<ISlaOverview | null>(null);
  const [trendData, setTrendData] = useState<ISlaTrendDataPoint[]>([]);
  const [breachByPriority, setBreachByPriority] = useState<ISlaBreachRateByDimension[]>([]);
  const [recentBreaches, setRecentBreaches] = useState<ISlaRecentBreach[]>([]);
  const [atRiskTickets, setAtRiskTickets] = useState<ISlaTicketAtRisk[]>([]);

  const getFilters = useCallback((): ISlaReportingFilters => {
    const days = parseInt(dateRange.replace('d', ''));
    const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return { dateFrom };
  }, [dateRange]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
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
      setLoading(false);
    }
  }, [getFilters, dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold">SLA Dashboard</h1>
          <p className="text-gray-600 text-sm mt-1">
            Monitor SLA compliance, track breaches, and identify at-risk tickets
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <CustomSelect
              value={dateRange}
              onValueChange={(value) => setDateRange(value as DateRangeOption)}
              options={DATE_RANGE_OPTIONS}
              placeholder="Select period"
              className="w-[150px]"
            />
          </div>
          <Button
            id="refresh-sla-dashboard"
            variant="outline"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Link href="/msp/settings/sla">
            <Button id="sla-settings-link" variant="outline">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          </Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <SlaMetricsCards data={overview} loading={loading} />

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SlaTrendChart data={trendData} loading={loading} />
        </div>
        <div>
          <SlaComplianceGauge
            overallRate={overview?.compliance.overallRate || 0}
            responseRate={overview?.compliance.responseRate || 0}
            resolutionRate={overview?.compliance.resolutionRate || 0}
            loading={loading}
          />
        </div>
      </div>

      {/* Breach by Priority */}
      <SlaBreachChart data={breachByPriority} loading={loading} />

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SlaTicketsAtRisk data={atRiskTickets} loading={loading} />
        <SlaBreachesTable data={recentBreaches} loading={loading} />
      </div>
    </div>
  );
}
