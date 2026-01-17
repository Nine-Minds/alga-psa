// server/src/components/billing-dashboard/contract-lines/ContractLinePresetTypeRouter.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getContractLinePresetById } from '@alga-psa/billing/actions/contractLinePresetActions';
import { IContractLinePreset } from 'server/src/interfaces/billing.interfaces';

// Import the specialized components
import { FixedPresetConfiguration } from './FixedContractLinePresetConfiguration';
import { HourlyPresetConfiguration } from './HourlyContractLinePresetConfiguration';
import { UsagePresetConfiguration } from './UsageContractLinePresetConfiguration';

interface PresetTypeRouterProps {
  presetId: string;
}

export function PresetTypeRouter({ presetId }: PresetTypeRouterProps) {
  const [presetType, setPresetType] = useState<IContractLinePreset['contract_line_type'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPresetType = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const preset = await getContractLinePresetById(presetId);
      if (preset) {
        setPresetType(preset.contract_line_type);
      } else {
        setError(`Contract line preset with ID ${presetId} not found.`);
      }
    } catch (err) {
      console.error(`Error fetching contract line preset type for ID ${presetId}:`, err);
      setError('Failed to load contract line preset details.');
    } finally {
      setLoading(false);
    }
  }, [presetId]);

  useEffect(() => {
    fetchPresetType();
  }, [fetchPresetType]);

  if (loading) {
    return <div className="flex justify-center items-center p-8"><LoadingIndicator spinnerProps={{ size: "sm" }} text="Loading Contract Line Preset..." /></div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-4">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  switch (presetType) {
    case 'Fixed':
      return <FixedPresetConfiguration presetId={presetId} />;
    case 'Hourly':
      return <HourlyPresetConfiguration presetId={presetId} />;
    case 'Usage':
      return <UsagePresetConfiguration presetId={presetId} />;
    default:
      return (
        <Alert variant="destructive" className="m-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Unknown or unsupported contract line preset type: {presetType}</AlertDescription>
        </Alert>
      );
  }
}

export const ContractLinePresetTypeRouter = PresetTypeRouter;

export default PresetTypeRouter;
