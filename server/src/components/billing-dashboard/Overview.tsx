// Overview.tsx - Updated to use hierarchical report system
'use client'
import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from 'server/src/components/ui/Card';
import { 
  FileSpreadsheet, 
  Building2, 
  CreditCard, 
  Clock, 
  Calendar,
  DollarSign,
  FileText,
  AlertCircle,
  TrendingUp,
  Users,
  Loader2
} from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { getBillingOverview } from 'server/src/lib/reports/actions';
import { ReportResult, FormattedMetricValue } from 'server/src/lib/reports/core/types';

interface MetricCardProps {
  title: string;
  value: any;
  icon: React.ComponentType<{ className?: string }>;
  loading?: boolean;
  error?: boolean;
  subtitle?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ 
  title, 
  value, 
  icon: Icon, 
  loading = false, 
  error = false,
  subtitle 
}) => {
  const getDisplayValue = () => {
    if (loading) return '...';
    if (error) return 'Error';
    
    // Handle formatted metric values
    if (value && typeof value === 'object' && 'formatted' in value) {
      return (value as FormattedMetricValue).formatted;
    }
    
    // Handle raw values
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    
    return value || '0';
  };

  return (
    <Card className={error ? 'border-red-200' : ''}>
      <CardHeader>
        <h3 className="text-lg font-semibold">{title}</h3>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-4">
          <div className="p-3 rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-[rgb(var(--color-primary-500))]" />
            ) : (
              <Icon className="h-6 w-6 text-[rgb(var(--color-primary-500))]" />
            )}
          </div>
          <div>
            <p className={`text-2xl font-bold ${error ? 'text-red-600' : ''}`}>
              {getDisplayValue()}
            </p>
            <p className="text-sm text-gray-500">{subtitle || title}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
  <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-white hover:shadow-lg transition-shadow p-4">
    <div className="flex items-start space-x-4">
      <div className="p-2 rounded-lg" style={{ background: 'rgb(var(--color-primary-50))' }}>
        <Icon className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
      </div>
      <div>
        <h3 className="font-semibold mb-1" style={{ color: 'rgb(var(--color-text-900))' }}>{title}</h3>
        <p className="text-sm" style={{ color: 'rgb(var(--color-text-500))' }}>{description}</p>
      </div>
    </div>
  </div>
);

const Overview = () => {
  const [reportData, setReportData] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchBillingOverview() {
      try {
        setLoading(true);
        setError(null);
        const data = await getBillingOverview();
        setReportData(data);
      } catch (err) {
        console.error('Error fetching billing overview:', err);
        setError(err instanceof Error ? err.message : 'Failed to load billing data');
      } finally {
        setLoading(false);
      }
    }

    fetchBillingOverview();
  }, []);

  const metrics = reportData?.metrics || {};
  const hasError = !!error;

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-5 w-5" />
            <div>
              <p className="font-medium">Unable to load billing data</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* Primary Billing Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title="Active Contract Lines"
          value={metrics.active_plans_count}
          icon={FileSpreadsheet}
          loading={loading}
          error={hasError}
          subtitle="Active Contract Lines"
        />
        <MetricCard
          title="Billing Clients"
          value={metrics.active_clients_count}
          icon={Building2}
          loading={loading}
          error={hasError}
          subtitle="Total Clients"
        />
        <MetricCard
          title="Monthly Revenue"
          value={metrics.monthly_revenue}
          icon={DollarSign}
          loading={loading}
          error={hasError}
          subtitle="Current Month"
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Services"
          value={metrics.active_services_count}
          icon={FileText}
          loading={loading}
          error={hasError}
          subtitle="In Catalog"
        />
        <MetricCard
          title="Outstanding Amount"
          value={metrics.outstanding_amount}
          icon={TrendingUp}
          loading={loading}
          error={hasError}
          subtitle="Unpaid Invoices"
        />
        <MetricCard
          title="Credit Balance"
          value={metrics.total_credit_balance}
          icon={CreditCard}
          loading={loading}
          error={hasError}
          subtitle="Total Credits"
        />
        <MetricCard
          title="Pending Approvals"
          value={metrics.pending_time_entries}
          icon={Clock}
          loading={loading}
          error={hasError}
          subtitle="Time Entries"
        />
      </div>

      {/* Billable Hours Section */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Monthly Activity</h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
              <Users className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {loading ? '...' : hasError ? 'Error' : (
                  metrics.monthly_billable_hours?.formatted || '0 hours'
                )}
              </p>
              <p className="text-sm text-gray-500">Billable hours this month</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <FeatureCard
          icon={CreditCard}
          title="Payment Processing"
          description="Track and manage client payments, process refunds, and handle payment disputes"
        />
        <FeatureCard
          icon={Clock}
          title="Billing Cycles"
          description="Manage recurring billing cycles, proration, and billing frequency settings"
        />
        <FeatureCard
          icon={Calendar}
          title="Service Periods"
          description="Track service delivery periods and align them with billing cycles"
        />
        <FeatureCard
          icon={FileText}
          title="Invoice Management"
          description="Generate, customize, and send professional invoices to clients"
        />
        <FeatureCard
          icon={AlertCircle}
          title="Overdue Payments"
          description="Monitor and follow up on overdue payments and payment reminders"
        />
        <FeatureCard
          icon={FileSpreadsheet}
          title="Service Catalog"
          description="Manage your service offerings, pricing, and contracts"
        />
      </div>

      {/* Service Catalog Quick Access */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Service Catalog Management</h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-2">Manage your service offerings, pricing, and billing configurations</p>
              <p>
                <span className="font-semibold">
                  {loading ? '...' : hasError ? 'Error' : (
                    metrics.active_services_count?.formatted || 
                    metrics.active_services_count || 
                    '0'
                  )}
                </span> Active Services
              </p>
            </div>
            <Button
              id='manage-service-catalog-button'
              onClick={() => document.querySelector<HTMLButtonElement>('button[data-state="inactive"][value="service-catalog"]')?.click()}
              className="ml-4"
            >
              Manage Service Catalog
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Debug info in development */}
      {reportData && process.env.NODE_ENV === 'development' && (
        <div className="text-xs text-gray-400 p-4 bg-gray-50 rounded">
          <p>Report executed: {reportData.executedAt}</p>
          <p>Execution time: {reportData.metadata.executionTime}ms</p>
          <p>Report version: {reportData.metadata.version}</p>
        </div>
      )}
    </div>
  );
};

export default Overview;
