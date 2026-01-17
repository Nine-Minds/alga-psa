// server/src/components/billing-dashboard/contract-lines/ServiceTierEditor.tsx
'use client';

import React from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Trash2, Plus, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

// Define TierConfig locally or import if available globally
export interface TierConfig {
  id: string; // Use a unique ID for React keys, could be generated or from DB
  fromAmount: number;
  toAmount: number | null; // null represents infinity
  rate: number;
}

interface ServiceTierEditorProps {
  serviceId: string;
  tiers: TierConfig[];
  unitOfMeasure: string;
  baseRate?: number; // Used for defaulting new tier rate
  validationError?: string; // Specific error message for tiers of this service
  disabled?: boolean;
  onTiersChange: (serviceId: string, tiers: TierConfig[]) => void;
}

export function ServiceTierEditor({
  serviceId,
  tiers,
  unitOfMeasure,
  baseRate,
  validationError,
  disabled = false,
  onTiersChange,
}: ServiceTierEditorProps) {

  const handleAddTier = () => {
    const sortedTiers = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);
    const lastTier = sortedTiers.length > 0 ? sortedTiers[sortedTiers.length - 1] : null;
    const newFromAmount = lastTier ? (lastTier.toAmount !== null ? lastTier.toAmount + 1 : (lastTier.fromAmount + 1)) : 0;

    const newTier: TierConfig = {
      id: `new-${Date.now()}`,
      fromAmount: newFromAmount,
      toAmount: null, // New tier is always the last one initially
      rate: baseRate || 0, // Default to base rate or 0
    };

    // Update the previous last tier's toAmount if it was null
    const updatedPreviousTiers = sortedTiers.map((tier, index) => {
      if (index === sortedTiers.length - 1 && tier.toAmount === null) {
        // Set 'to' amount to one less than the new tier's 'from', ensuring it's not negative
        return { ...tier, toAmount: Math.max(0, newFromAmount - 1) };
      }
      return tier;
    });

    onTiersChange(serviceId, [...updatedPreviousTiers, newTier]);
  };

  const handleRemoveTier = (idToRemove: string) => {
    const filteredTiers = tiers.filter(tier => tier.id !== idToRemove);
    // Ensure the new last tier has toAmount = null if it exists
    if (filteredTiers.length > 0) {
      const lastIndex = filteredTiers.length - 1;
      // Make sure tiers remain sorted before adjusting the last one
      const sortedFilteredTiers = filteredTiers.sort((a, b) => a.fromAmount - b.fromAmount);
      sortedFilteredTiers[lastIndex] = { ...sortedFilteredTiers[lastIndex], toAmount: null };
      onTiersChange(serviceId, sortedFilteredTiers);
    } else {
      onTiersChange(serviceId, []); // Return empty array if all tiers were removed
    }
  };

  const handleTierFieldChange = (tierId: string, field: keyof TierConfig, value: string) => {
    const updatedTiers = tiers.map(tier => {
      if (tier.id === tierId) {
        let processedValue: number | null;
        if (field === 'toAmount') {
          processedValue = value === '' ? null : Number(value); // Allow empty string for null 'toAmount'
        } else {
          processedValue = Number(value); // For fromAmount and rate
        }

        // Basic validation within the change handler
        if (isNaN(processedValue as number) && processedValue !== null) {
          console.warn(`Invalid number input ignored: ${value}`);
          return tier; // Ignore invalid number input
        }

        // Ensure 'fromAmount' of the first tier remains 0
        const isFirstTier = tiers.sort((a, b) => a.fromAmount - b.fromAmount)[0]?.id === tierId;
        if (field === 'fromAmount' && isFirstTier) {
          processedValue = 0;
        }

        return { ...tier, [field]: processedValue };
      }
      return tier;
    });
    onTiersChange(serviceId, updatedTiers);
  };

  const sortedTiers = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);

  return (
    <Card className="bg-muted/40">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base">Pricing Tiers</CardTitle>
        <Button
          id={`add-tier-button-${serviceId}`}
          type="button"
          size="sm"
          variant="outline"
          onClick={handleAddTier}
          disabled={disabled}
        >
          <Plus className="h-4 w-4 mr-1" /> Add Tier
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {validationError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{validationError}</AlertDescription>
          </Alert>
        )}
        {tiers.length === 0 && !validationError ? (
          <p className="text-sm text-muted-foreground">No tiers defined. Click "Add Tier".</p>
        ) : null}
        {tiers.length > 0 && (
          <div className="space-y-2">
            {/* Header Row */}
            <div className="grid grid-cols-11 gap-2 items-center font-medium text-xs text-muted-foreground px-2">
              <div className="col-span-3">From ({unitOfMeasure || 'Units'})</div>
              <div className="col-span-3">To ({unitOfMeasure || 'Units'})</div>
              <div className="col-span-4">Rate per {unitOfMeasure || 'Unit'}</div>
              <div className="col-span-1"></div> {/* Spacer for delete button */}
            </div>
            {/* Tier Rows */}
            {sortedTiers.map((tier, index) => (
              <div key={tier.id} className="grid grid-cols-11 gap-2 items-center border p-2 rounded bg-background">
                <div className="col-span-3">
                  <Input
                    id={`tier-${serviceId}-${tier.id}-from`}
                    type="number"
                    value={tier.fromAmount.toString()}
                    onChange={(e) => handleTierFieldChange(tier.id, 'fromAmount', e.target.value)}
                    disabled={disabled || index === 0} // First tier 'from' is always 0
                    min={0}
                    step={1}
                    aria-label={`Tier ${index + 1} From Amount`}
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    id={`tier-${serviceId}-${tier.id}-to`}
                    type="number"
                    value={tier.toAmount === null ? '' : tier.toAmount.toString()}
                    onChange={(e) => handleTierFieldChange(tier.id, 'toAmount', e.target.value)}
                    placeholder={index === sortedTiers.length - 1 ? "Unlimited" : ""}
                    // Allow editing 'To' amount for intermediate tiers to fix gaps/overlaps
                    disabled={disabled}
                    min={tier.fromAmount}
                    step={1}
                    aria-label={`Tier ${index + 1} To Amount`}
                  />
                </div>
                <div className="col-span-4">
                  <Input
                    id={`tier-${serviceId}-${tier.id}-rate`}
                    type="number"
                    value={tier.rate.toString()}
                    onChange={(e) => handleTierFieldChange(tier.id, 'rate', e.target.value)}
                    disabled={disabled}
                    min={0}
                    step={0.01}
                    aria-label={`Tier ${index + 1} Rate`}
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    id={`remove-tier-${serviceId}-${tier.id}-button`}
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveTier(tier.id)}
                    disabled={disabled || tiers.length <= 1} // Cannot remove if only one tier exists
                    className="text-destructive hover:bg-destructive/10"
                    aria-label={`Remove Tier ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground pt-2">
          Define usage ranges and their corresponding rates. Leave 'To' blank for the last tier to represent unlimited usage. The first tier must start from 0. Tiers must be contiguous.
        </p>
      </CardContent>
    </Card>
  );
}