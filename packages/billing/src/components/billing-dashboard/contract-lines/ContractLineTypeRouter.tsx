// server/src/components/billing-dashboard/PlanTypeRouter.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getContractLineById } from '@alga-psa/billing/actions/contractLineAction';
import { IContractLine } from '@alga-psa/types';

// Import the specialized components
import { FixedPlanConfiguration } from './FixedContractLineConfiguration';
import { HourlyPlanConfiguration } from './HourlyContractLineConfiguration';
import { UsagePlanConfiguration } from './UsageContractLineConfiguration';

interface PlanTypeRouterProps {
  contractLineId: string;
}

export function PlanTypeRouter({ contractLineId }: PlanTypeRouterProps) {
  const { t } = useTranslation('msp/contract-lines');
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
        setError(t('router.contractLine.notFound', {
          defaultValue: 'Contract line with ID {{id}} not found.',
          id: contractLineId,
        }));
      }
    } catch (err) {
      console.error(`Error fetching contract line type for ID ${contractLineId}:`, err);
      setError(t('router.contractLine.loadFailed', {
        defaultValue: 'Failed to load contract line details.',
      }));
    } finally {
      setLoading(false);
    }
  }, [contractLineId, t]);

  useEffect(() => {
    fetchPlanType();
  }, [fetchPlanType]);

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <LoadingIndicator
          spinnerProps={{ size: 'sm' }}
          text={t('router.contractLine.loading', { defaultValue: 'Loading Contract Line...' })}
        />
      </div>
    );
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
          <AlertDescription>
            {t('router.contractLine.unsupportedType', {
              defaultValue: 'Unknown or unsupported contract line type: {{type}}',
              type: planType ?? '',
            })}
          </AlertDescription>
        </Alert>
      );
  }
}

export const ContractLineTypeRouter = PlanTypeRouter;

export default PlanTypeRouter;
