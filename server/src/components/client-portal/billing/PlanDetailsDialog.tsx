'use client';

import React, { useMemo } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import type { ICompanyBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import { X, Package } from 'lucide-react';

interface PlanDetailsDialogProps {
  plan: ICompanyBillingPlan | null;
  isOpen: boolean;
  onClose: () => void;
  formatCurrency?: (amount: number) => string;
  formatDate: (date: string | { toString(): string } | undefined | null) => string;
};

const PlanDetailsDialog: React.FC<PlanDetailsDialogProps> = React.memo(({
  plan,
  isOpen,
  onClose,
  formatCurrency = (amount: number) => `$${amount.toFixed(2)}`,
  formatDate
}) => {
  // Loading state when plan is null but dialog is open
  const isLoading = isOpen && !plan;

  // Memoize the plan details content to prevent unnecessary re-renders
  const planContent = useMemo(() => {
    if (!plan) return null;
    
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-gray-500">Plan Name</p>
            <p className="mt-1">{plan.plan_name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Billing Frequency</p>
            <p className="mt-1">{plan.billing_frequency}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Start Date</p>
            <p className="mt-1">{formatDate(plan.start_date)}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">End Date</p>
            <p className="mt-1">{plan.end_date ? formatDate(plan.end_date) : 'No end date'}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Status</p>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
              plan.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {plan.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
          {plan.custom_rate !== undefined && (
            <div>
              <p className="text-sm font-medium text-gray-500">Custom Rate</p>
              <p className="mt-1">{formatCurrency(plan.custom_rate)}</p>
            </div>
          )}
          {(plan.service_category_name || plan.service_category) && (
            <div>
              <p className="text-sm font-medium text-gray-500">Service Category</p>
              <p className="mt-1">{plan.service_category_name || plan.service_category}</p>
            </div>
          )}
        </div>

        <div className="mt-4">
          <p className="text-sm text-gray-500">
            This plan is currently {plan.is_active ? 'active' : 'inactive'} and will 
            {plan.end_date ? ` expire on ${formatDate(plan.end_date)}` : ' not expire'}.
          </p>
        </div>
      </div>
    );
  }, [plan, formatCurrency, formatDate]);

  // Loading skeleton for when plan is being fetched
  const loadingSkeleton = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i}>
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      
      <div>
        <Skeleton className="h-4 w-full mt-4" />
      </div>
    </div>
  );
  
  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose} 
      title="Plan Details" 
      data-automation-id="
      plan-details-dialog"
    >
      <DialogContent>
        <div data-automation-id="plan-details-content">
          {isLoading ? loadingSkeleton : planContent}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="close-plan-dialog-button" variant="outline" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
});

// Add display name for debugging
PlanDetailsDialog.displayName = 'PlanDetailsDialog';

export default PlanDetailsDialog;
