// Overview.tsx - Updated to use hierarchical report system
'use client'
import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent } from '@alga-psa/ui/components/Card';
import {
  FileSpreadsheet,
  Building2,
  CreditCard,
  Clock,
  Calendar,
  Coins,
  FileText,
  AlertCircle,
  TrendingUp,
  Users
} from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import Spinner from '@alga-psa/ui/components/Spinner';
import { Button } from '@alga-psa/ui/components/Button';
import { getBillingOverview } from '@alga-psa/reporting';
import type { ReportResult, FormattedMetricValue } from '@alga-psa/reporting';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('msp/billing');
  const getDisplayValue = () => {
    if (loading) return t('overview.states.ellipsis', { defaultValue: '...' });
    if (error) return t('overview.states.error', { defaultValue: 'Error' });
    
    // Handle formatted metric values
    if (value && typeof value === 'object' && 'formatted' in value) {
      return (value as FormattedMetricValue).formatted;
    }
    
    // Handle raw values
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    
    return value || t('overview.states.zero', { defaultValue: '0' });
  };

  return (
    <Card className={error ? 'border-destructive' : ''}>
      <CardHeader>
        <h3 className="text-lg font-semibold">{title}</h3>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-4">
          <div className="p-3 rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
            {loading ? (
              <Spinner size="md" className="text-[rgb(var(--color-primary-500))]" />
            ) : (
              <Icon className="h-6 w-6 text-[rgb(var(--color-primary-500))]" />
            )}
          </div>
          <div>
            <p className={`text-2xl font-bold ${error ? 'text-destructive' : ''}`}>
              {getDisplayValue()}
            </p>
            <p className="text-sm text-muted-foreground">{subtitle || title}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const FeatureCard = ({ icon: Icon, title, description }: { icon: any, title: string, description: string }) => (
  <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-card hover:shadow-lg transition-shadow p-4">
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
  const { t } = useTranslation('msp/billing');
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
        setError(err instanceof Error
          ? err.message
          : t('overview.errors.loadData', { defaultValue: 'Failed to load billing data' }));
      } finally {
        setLoading(false);
      }
    }

    fetchBillingOverview();
  }, [t]);

  const metrics = reportData?.metrics || {};
  const hasError = !!error;

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="font-medium">
              {t('overview.errors.loadTitle', { defaultValue: 'Unable to load billing data' })}
            </p>
            <p className="text-sm">{error}</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Primary Billing Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          title={t('overview.metrics.activeContractLines.title', { defaultValue: 'Active Contract Lines' })}
          value={metrics.active_plans_count}
          icon={FileSpreadsheet}
          loading={loading}
          error={hasError}
          subtitle={t('overview.metrics.activeContractLines.subtitle', { defaultValue: 'Active Contract Lines' })}
        />
        <MetricCard
          title={t('overview.metrics.billingClients.title', { defaultValue: 'Billing Clients' })}
          value={metrics.active_clients_count}
          icon={Building2}
          loading={loading}
          error={hasError}
          subtitle={t('overview.metrics.billingClients.subtitle', { defaultValue: 'Total Clients' })}
        />
        <MetricCard
          title={t('overview.metrics.monthlyRevenue.title', { defaultValue: 'Monthly Revenue' })}
          value={metrics.monthly_revenue}
          icon={Coins}
          loading={loading}
          error={hasError}
          subtitle={t('overview.metrics.monthlyRevenue.subtitle', { defaultValue: 'Current Month' })}
        />
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title={t('overview.metrics.activeServices.title', { defaultValue: 'Active Services' })}
          value={metrics.active_services_count}
          icon={FileText}
          loading={loading}
          error={hasError}
          subtitle={t('overview.metrics.activeServices.subtitle', { defaultValue: 'In Catalog' })}
        />
        <MetricCard
          title={t('overview.metrics.outstandingAmount.title', { defaultValue: 'Outstanding Amount' })}
          value={metrics.outstanding_amount}
          icon={TrendingUp}
          loading={loading}
          error={hasError}
          subtitle={t('overview.metrics.outstandingAmount.subtitle', { defaultValue: 'Unpaid Invoices' })}
        />
        <MetricCard
          title={t('overview.metrics.creditBalance.title', { defaultValue: 'Credit Balance' })}
          value={metrics.total_credit_balance}
          icon={CreditCard}
          loading={loading}
          error={hasError}
          subtitle={t('overview.metrics.creditBalance.subtitle', { defaultValue: 'Total Credits' })}
        />
        <MetricCard
          title={t('overview.metrics.pendingApprovals.title', { defaultValue: 'Pending Approvals' })}
          value={metrics.pending_time_entries}
          icon={Clock}
          loading={loading}
          error={hasError}
          subtitle={t('overview.metrics.pendingApprovals.subtitle', { defaultValue: 'Time Entries' })}
        />
      </div>

      {/* Billable Hours Section */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">
            {t('overview.sections.monthlyActivity.title', { defaultValue: 'Monthly Activity' })}
          </h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-full" style={{ background: 'rgb(var(--color-primary-50))' }}>
              <Users className="h-6 w-6" style={{ color: 'rgb(var(--color-primary-500))' }} />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {loading ? t('overview.states.ellipsis', { defaultValue: '...' }) : hasError ? t('overview.states.error', { defaultValue: 'Error' }) : (
                  metrics.monthly_billable_hours?.formatted || t('overview.states.zeroHours', { defaultValue: '0 hours' })
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {t('overview.sections.monthlyActivity.subtitle', { defaultValue: 'Billable hours this month' })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Features Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <FeatureCard
          icon={CreditCard}
          title={t('overview.features.paymentProcessing.title', { defaultValue: 'Payment Processing' })}
          description={t('overview.features.paymentProcessing.description', {
            defaultValue: 'Track and manage client payments, process refunds, and handle payment disputes',
          })}
        />
        <FeatureCard
          icon={Clock}
          title={t('overview.features.billingCycles.title', { defaultValue: 'Billing Cycles' })}
          description={t('overview.features.billingCycles.description', {
            defaultValue: 'Manage client billing schedules, cadence defaults, and invoice frequency settings',
          })}
        />
        <FeatureCard
          icon={Calendar}
          title={t('overview.features.servicePeriods.title', { defaultValue: 'Service Periods' })}
          description={t('overview.features.servicePeriods.description', {
            defaultValue: 'Review recurring service periods and understand how invoice windows group them',
          })}
        />
        <FeatureCard
          icon={FileText}
          title={t('overview.features.invoiceManagement.title', { defaultValue: 'Invoice Management' })}
          description={t('overview.features.invoiceManagement.description', {
            defaultValue: 'Generate invoice windows for recurring service periods and create manual or prepayment documents when financial handling differs from recurring coverage',
          })}
        />
        <FeatureCard
          icon={AlertCircle}
          title={t('overview.features.overduePayments.title', { defaultValue: 'Overdue Payments' })}
          description={t('overview.features.overduePayments.description', {
            defaultValue: 'Monitor and follow up on overdue payments and payment reminders',
          })}
        />
        <FeatureCard
          icon={FileSpreadsheet}
          title={t('overview.features.serviceCatalog.title', { defaultValue: 'Service Catalog' })}
          description={t('overview.features.serviceCatalog.description', {
            defaultValue: 'Manage your service offerings, pricing, and contracts',
          })}
        />
      </div>

      {/* Service Catalog Quick Access */}
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">
            {t('overview.sections.serviceCatalog.title', { defaultValue: 'Service Catalog Management' })}
          </h3>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2">
                {t('overview.sections.serviceCatalog.description', {
                  defaultValue: 'Manage your service offerings, pricing, and billing configurations',
                })}
              </p>
              <p>
                <span className="font-semibold">
                  {loading ? t('overview.states.ellipsis', { defaultValue: '...' }) : hasError ? t('overview.states.error', { defaultValue: 'Error' }) : (
                    metrics.active_services_count?.formatted || 
                    metrics.active_services_count || 
                    t('overview.states.zero', { defaultValue: '0' })
                  )}
                </span>{' '}
                {t('overview.sections.serviceCatalog.activeServicesLabel', { defaultValue: 'Active Services' })}
              </p>
            </div>
            <Button
              id='manage-service-catalog-button'
              onClick={() => document.querySelector<HTMLButtonElement>('button[data-state="inactive"][value="service-catalog"]')?.click()}
              className="ml-4"
            >
              {t('overview.sections.serviceCatalog.button', { defaultValue: 'Manage Service Catalog' })}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Debug info in development */}
      {reportData && process.env.NODE_ENV === 'development' && (
        <div className="text-xs text-muted-foreground p-4 bg-muted rounded">
          <p>
            {t('overview.debug.reportExecuted', { defaultValue: 'Report executed:' })} {reportData.executedAt}
          </p>
          <p>
            {t('overview.debug.executionTime', { defaultValue: 'Execution time:' })} {reportData.metadata.executionTime}ms
          </p>
          <p>
            {t('overview.debug.reportVersion', { defaultValue: 'Report version:' })} {reportData.metadata.version}
          </p>
        </div>
      )}
    </div>
  );
};

export default Overview;
