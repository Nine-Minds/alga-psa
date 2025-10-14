// server/src/components/billing-dashboard/PlanTypeRouter.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getContractLineById } from 'server/src/lib/actions/contractLineAction';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';

// Import the specialized components
import { FixedPlanConfiguration } from './FixedContractLineConfiguration';
import { HourlyPlanConfiguration } from './HourlyContractLineConfiguration';
import { UsagePlanConfiguration } from './UsageContractLineConfiguration';

interface PlanTypeRouterProps {
  contractLineId: string;
}

export function PlanTypeRouter({ contractLineId }: PlanTypeRouterProps) {
  const [planType, setPlanType] = useState<IContractLine['contract_line_type'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlanType = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const plan = await getContractLineById(contractLineId);
      if (plan) {
        setPlanType(plan.contract_line_type);
      } else {
        setError(`Contract line with ID ${contractLineId} not found.`);
      }
    } catch (err) {
      console.error(`Error fetching contract line type for ID ${contractLineId}:`, err);
      setError('Failed to load contract line details.');
    } finally {
      setLoading(false);
    }
  }, [contractLineId]);

  useEffect(() => {
    fetchPlanType();
  }, [fetchPlanType]);

  if (loading) {
    return <div className="flex justify-center items-center p-8"><LoadingIndicator spinnerProps={{ size: "sm" }} text="Loading Contract Line..." /></div>;
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
      return <FixedPlanConfiguration contractLineId={contractLineId} />;
    case 'Hourly':
      return <HourlyPlanConfiguration contractLineId={contractLineId} />;
    case 'Usage':
      return <UsagePlanConfiguration contractLineId={contractLineId} />;
    default:
      return (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Unknown or unsupported contract line type: {planType}</AlertDescription>
        </Alert>
      );
  }
}

export const ContractLineTypeRouter = PlanTypeRouter;

export default PlanTypeRouter;
