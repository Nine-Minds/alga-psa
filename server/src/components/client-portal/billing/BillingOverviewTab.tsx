'use client';

import React, { useMemo, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { Package, FileText, AlertCircle } from 'lucide-react';
import BucketUsageChart from './BucketUsageChart';
import type {
  ICompanyBillingPlan
} from 'server/src/interfaces/billing.interfaces';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import type { ClientBucketUsageResult } from 'server/src/lib/actions/client-portal-actions/client-billing-metrics';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import PlanDetailsDialog from './PlanDetailsDialog';

// Flag to control visibility of bucket usage metrics
const SHOW_USAGE_FEATURES = false;

interface BillingOverviewTabProps {
  billingPlan: ICompanyBillingPlan | null;
  invoices: InvoiceViewModel[];
  bucketUsage: ClientBucketUsageResult[];
  isBucketUsageLoading: boolean;
  isClient: boolean;
  formatCurrency: (amount: number) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
  onViewAllInvoices?: () => void;
}

const BillingOverviewTab: React.FC<BillingOverviewTabProps> = React.memo(({
  billingPlan,
  invoices,
  bucketUsage,
  isBucketUsageLoading,
  isClient,
  formatCurrency,
  formatDate,
  onViewAllInvoices
}) => {
  // State for plan details dialog
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false);
  
  // Memoize the plan card to prevent unnecessary re-renders
  const planCard = useMemo(() => (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">Current Plan</p>
          {billingPlan ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{billingPlan.plan_name}</p>
              <p className="mt-1 text-sm text-gray-500">{billingPlan.billing_frequency}</p>
            </>
          ) : (
            <>
              <Skeleton className="mt-2 h-8 w-3/4" />
              <Skeleton className="mt-1 h-4 w-1/2" />
            </>
          )}
        </div>
        <Package className="h-5 w-5 text-gray-400" />
      </div>
      <Button
        id="view-plan-details-button"
        className="mt-4 w-full"
        variant="outline"
        onClick={() => setIsPlanDialogOpen(true)}
      >
        View Plan Details
      </Button>
    </Card>
  ), [billingPlan]);

  // Memoize the invoice card to prevent unnecessary re-renders
  const invoiceCard = useMemo(() => (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">Next Invoice</p>
          {invoices.length > 0 ? (
            <>
              <p className="mt-2 text-3xl font-semibold">
                {invoices[0]?.total_amount ? formatCurrency(invoices[0].total_amount) : '$0.00'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {invoices[0]?.invoice_date ? `Due ${formatDate(invoices[0].invoice_date)}` : 'No due date'}
              </p>
            </>
          ) : (
            <>
              <Skeleton className="mt-2 h-8 w-3/4" />
              <Skeleton className="mt-1 h-4 w-1/2" />
            </>
          )}
        </div>
        <FileText className="h-5 w-5 text-gray-400" />
      </div>
      <Button
        id="view-all-invoices-button"
        className="mt-4 w-full"
        variant="outline"
        onClick={() => {
          if (onViewAllInvoices) {
            onViewAllInvoices();
          }
        }}
      >
        View All Invoices
      </Button>
    </Card>
  ), [invoices, formatCurrency, formatDate, onViewAllInvoices]);

  return (
    <>
      <div id="billing-overview-content" className="space-y-6 py-4">
        <div className="grid gap-6 md:grid-cols-2">
          {planCard}
          {invoiceCard}
        </div>

        {/* Enhanced Bucket Usage Visualization - optionally hidden */}
        {SHOW_USAGE_FEATURES && (
        <Card id="bucket-usage-card" className="p-6">
          <h3 className="text-lg font-semibold mb-4">Bucket Usage</h3>
          {!isClient ? (
            // Server-side placeholder
            <div className="grid gap-6 md:grid-cols-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <Skeleton className="h-6 w-1/2 mb-2" />
                  <Skeleton className="h-4 w-1/3 mb-4" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-2 w-full mb-1" />
                  <div className="flex justify-between">
                    <Skeleton className="h-3 w-1/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : isBucketUsageLoading ? (
            // Client-side loading state with skeleton
            <div className="grid gap-6 md:grid-cols-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <Skeleton className="h-6 w-1/2 mb-2" />
                  <Skeleton className="h-4 w-1/3 mb-4" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-2 w-full mb-1" />
                  <div className="flex justify-between">
                    <Skeleton className="h-3 w-1/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : bucketUsage.length === 0 ? (
            // Empty state
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <AlertCircle className="mx-auto h-12 w-12 text-gray-400" />
                <h3 className="mt-2 text-lg font-medium text-gray-900">No bucket plans available</h3>
                <p className="mt-1 text-sm text-gray-500">
                  There are no active bucket plans for your account.
                </p>
              </div>
            </div>
          ) : (
            // Bucket usage charts - only rendered client-side
            <div className="grid gap-6 md:grid-cols-2">
              {bucketUsage.map((bucket, index) => (
                <BucketUsageChart key={`${bucket.plan_id}-${bucket.service_id}-${index}`} bucketData={bucket} />
              ))}
            </div>
          )}
        </Card>
        )}
      </div>

      {/* Plan Details Dialog */}
      <PlanDetailsDialog
        plan={billingPlan}
        isOpen={isPlanDialogOpen}
        onClose={() => setIsPlanDialogOpen(false)}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
      />
    </>
  );
});

// Add display name for debugging
BillingOverviewTab.displayName = 'BillingOverviewTab';

export default BillingOverviewTab;
