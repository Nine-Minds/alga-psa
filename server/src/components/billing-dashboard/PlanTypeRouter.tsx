// server/src/components/billing-dashboard/PlanTypeRouter.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getBillingPlanById } from 'server/src/lib/actions/billingPlanAction';
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';

// Import the specialized components
import { FixedPlanConfiguration } from './FixedPlanConfiguration';
import { HourlyPlanConfiguration } from './HourlyPlanConfiguration';
import { UsagePlanConfiguration } from './UsagePlanConfiguration';
import { BucketPlanConfiguration } from './BucketPlanConfiguration';

interface PlanTypeRouterProps {
  planId: string;
}

export function PlanTypeRouter({ planId }: PlanTypeRouterProps) {
  const [planType, setPlanType] = useState<IBillingPlan['plan_type'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlanType = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const plan = await getBillingPlanById(planId);
      if (plan) {
        setPlanType(plan.plan_type);
      } else {
        setError(`Plan with ID ${planId} not found.`);
      }
    } catch (err) {
      console.error(`Error fetching plan type for ID ${planId}:`, err);
      setError('Failed to load plan details.');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchPlanType();
  }, [fetchPlanType]);

  if (loading) {
    return <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin" /> Loading Plan...</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  switch (planType) {
    case 'Fixed':
      return <FixedPlanConfiguration planId={planId} />;
    case 'Hourly':
      return <HourlyPlanConfiguration planId={planId} />;
    case 'Usage':
      return <UsagePlanConfiguration planId={planId} />;
    case 'Bucket':
      return <BucketPlanConfiguration planId={planId} />;
    default:
      return (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Unknown or unsupported plan type: {planType}</AlertDescription>
        </Alert>
      );
  }
}