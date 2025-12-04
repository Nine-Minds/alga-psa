'use client';

import React, { useMemo, useState } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Card } from 'server/src/components/ui/Card';
import { Package, FileText, AlertCircle } from 'lucide-react';
import BucketUsageChart from './BucketUsageChart';
import type {
  IClientContractLine
} from 'server/src/interfaces/billing.interfaces';
import type { InvoiceViewModel } from 'server/src/interfaces/invoice.interfaces';
import type { ClientBucketUsageResult } from 'server/src/lib/actions/client-portal-actions/client-billing-metrics';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import PlanDetailsDialog from './PlanDetailsDialog';
import { useTranslation } from 'server/src/lib/i18n/client';

// Flag to control visibility of bucket usage metrics
const SHOW_USAGE_FEATURES = true;

interface BillingOverviewTabProps {
  contractLine: IClientContractLine | null;
  invoices: InvoiceViewModel[];
  bucketUsage: ClientBucketUsageResult[];
  isBucketUsageLoading: boolean;
  isLoading: boolean;
  formatCurrency: (amount: number) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
  onViewAllInvoices?: () => void;
}

const BillingOverviewTab: React.FC<BillingOverviewTabProps> = React.memo(({
  contractLine,
  invoices,
  bucketUsage,
  isBucketUsageLoading,
  isLoading,
  formatCurrency,
  formatDate,
  onViewAllInvoices
}) => {
  const { t } = useTranslation('clientPortal');
  // State for plan details dialog
  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false);
  
  // Memoize the plan card to prevent unnecessary re-renders
  const planCard = useMemo(() => (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{t('billing.currentContractLine')}</p>
          {contractLine ? (
            <>
              <p className="mt-2 text-3xl font-semibold">{contractLine.contract_line_name}</p>
              <p className="mt-1 text-sm text-gray-500">{t(`billing.frequency.${contractLine.billing_frequency?.toLowerCase() || 'monthly'}`)}</p>
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
        {t('billing.viewContractLineDetails')}
      </Button>
    </Card>
  ), [contractLine]);

  // Find the most recent unpaid invoice for the "Next Invoice" card
  const nextInvoice = useMemo(() => {
    // Filter to unpaid invoices and sort by due_date ascending to get the nearest due
    const unpaidInvoices = invoices.filter(inv =>
      inv.status !== 'paid' && inv.status !== 'cancelled'
    );
    if (unpaidInvoices.length === 0) return null;
    // Sort by due_date ascending (nearest due first)
    return unpaidInvoices.sort((a, b) => {
      const dateA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const dateB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return dateA - dateB;
    })[0];
  }, [invoices]);

  // Memoize the invoice card to prevent unnecessary re-renders
  const invoiceCard = useMemo(() => (
    <Card className="p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500">{t('billing.nextInvoice')}</p>
          {nextInvoice ? (
            <>
              <p className="mt-2 text-3xl font-semibold">
                {nextInvoice.total_amount ? formatCurrency(nextInvoice.total_amount) : '$0.00'}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {nextInvoice.due_date ? t('billing.invoice.dueDateText', { date: formatDate(nextInvoice.due_date) }) : t('billing.invoice.noDueDate')}
              </p>
            </>
          ) : invoices.length > 0 ? (
            // All invoices are paid/cancelled
            <p className="mt-2 text-lg text-gray-500">{t('billing.invoice.allPaid')}</p>
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
        {t('billing.viewAllInvoices')}
      </Button>
    </Card>
  ), [nextInvoice, invoices.length, formatCurrency, formatDate, onViewAllInvoices, t]);

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
          <h3 className="text-lg font-semibold mb-4">{t('billing.bucket.usage')}</h3>
          {isBucketUsageLoading || isLoading ? (
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
                <h3 className="mt-2 text-lg font-medium text-gray-900">{t('billing.bucket.noContractLineTitle')}</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {t('billing.bucket.noContractLineDescription')}
                </p>
              </div>
            </div>
          ) : (
            // Bucket usage charts - only rendered client-side
            <div className="grid gap-6 md:grid-cols-2">
              {bucketUsage.map((bucket, index) => (
                <BucketUsageChart key={`${bucket.contract_line_id}-${bucket.service_id}-${index}`} bucketData={bucket} />
              ))}
            </div>
          )}
        </Card>
        )}
      </div>

      {/* Plan Details Dialog */}
      <PlanDetailsDialog
        contractLine={contractLine}
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
