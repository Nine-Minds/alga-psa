// server/src/components/billing-dashboard/ContractLineTypeRouter.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getContractLineById } from 'server/src/lib/actions/contractLineAction';
import { IContractLine } from 'server/src/interfaces/billing.interfaces';

// Import the specialized components
import { FixedContractLineConfiguration } from './FixedContractLineConfiguration';
import { HourlyContractLineConfiguration } from './HourlyContractLineConfiguration';
import { UsageContractLineConfiguration } from './UsageContractLineConfiguration';
import { BucketContractLineConfiguration } from './BucketContractLineConfiguration';

interface ContractLineTypeRouterProps {
  contractLineId: string;
}

export function ContractLineTypeRouter({ contractLineId }: ContractLineTypeRouterProps) {
  const [contractLineType, setContractLineType] = useState<IContractLine['contract_line_type'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchContractLineType = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const contractLine = await getContractLineById(contractLineId);
      if (contractLine) {
        setContractLineType(contractLine.contract_line_type);
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
    fetchContractLineType();
  }, [fetchContractLineType]);

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

  switch (contractLineType) {
    case 'Fixed':
      return <FixedContractLineConfiguration contractLineId={contractLineId} />;
    case 'Hourly':
      return <HourlyContractLineConfiguration contractLineId={contractLineId} />;
    case 'Usage':
      return <UsageContractLineConfiguration contractLineId={contractLineId} />;
    case 'Bucket':
      return <BucketContractLineConfiguration contractLineId={contractLineId} />;
    default:
      return (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Unknown or unsupported contract line type: {contractLineType}</AlertDescription>
        </Alert>
      );
  }
}
