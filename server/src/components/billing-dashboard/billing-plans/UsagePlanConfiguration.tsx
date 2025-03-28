// server/src/components/billing-dashboard/UsagePlanConfiguration.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import { UnitOfMeasureInput } from '../UnitOfMeasureInput'; // Assuming this path is correct relative to the new file
import { Button } from 'server/src/components/ui/Button';
import { Trash2, Plus, Loader2, AlertCircle, Info } from 'lucide-react'; // Added Info
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getBillingPlanById, updateBillingPlan } from 'server/src/lib/actions/billingPlanAction'; // Corrected path
import GenericPlanServicesList from './GenericPlanServicesList'; // Import the generic list
import { IBillingPlan } from 'server/src/interfaces/billing.interfaces';
import { Tooltip } from 'server/src/components/ui/Tooltip'; // Added Tooltip import

// Define ValidationErrors locally
type ValidationErrors = {
  [key: string]: string | undefined;
};

// Define TierConfig locally or import if available globally
interface TierConfig {
  id: string; // Use a unique ID for React keys, could be generated or from DB
  fromAmount: number;
  toAmount: number | null; // null represents infinity
  rate: number;
}

// Define the expected shape of the plan object returned by getBillingPlanById for Usage
// And the shape expected by updateBillingPlan (without client-side tier IDs)
type UsagePlanConfigFields = {
    base_rate?: number;
    unit_of_measure?: string;
    enable_tiered_pricing?: boolean;
    minimum_usage?: number;
    tiers?: Omit<TierConfig, 'id'>[]; // Backend expects tiers without the client-side 'id'
};
type UsagePlanData = IBillingPlan & UsagePlanConfigFields;


interface UsagePlanConfigurationProps {
  planId: string;
  className?: string;
  // Removed validationErrors prop
  // Removed onConfigChange prop
}

export function UsagePlanConfiguration({
  planId,
  className = '',
  // Removed validationErrors prop usage
  // Removed onConfigChange prop usage
}: UsagePlanConfigurationProps) {
  const [plan, setPlan] = useState<UsagePlanData | null>(null);
  const [baseRate, setBaseRate] = useState<number | undefined>(undefined);
  const [unitOfMeasure, setUnitOfMeasure] = useState<string>('');
  const [enableTieredPricing, setEnableTieredPricing] = useState<boolean>(false);
  const [minimumUsage, setMinimumUsage] = useState<number | undefined>(0);
  const [tiers, setTiers] = useState<TierConfig[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); // Keep for disabling fields during load/internal ops?
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null); // Keep for internal errors?
  // Re-add local validation state
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [saveAttempted, setSaveAttempted] = useState<boolean>(false); // State to track save attempt


  const fetchPlanData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedPlan = await getBillingPlanById(planId) as UsagePlanData; // Cast to expected type
      if (fetchedPlan && fetchedPlan.plan_type === 'Usage') { // Match enum case
        setPlan(fetchedPlan);
        // Assume config fields are returned directly on the plan object
        setBaseRate(fetchedPlan.base_rate);
        setUnitOfMeasure(fetchedPlan.unit_of_measure || '');
        setEnableTieredPricing(fetchedPlan.enable_tiered_pricing ?? false);
        setMinimumUsage(fetchedPlan.minimum_usage ?? 0);
        // Ensure tiers have unique IDs for React state management if not provided by backend
        setTiers((fetchedPlan.tiers || []).map((tier: any, index: number) => ({ ...tier, id: tier.id || `tier-${index}-${Date.now()}` })));
      } else {
        setError('Invalid plan type or plan not found.');
      }
    } catch (err) {
      console.error('Error fetching plan data:', err);
      setError('Failed to load plan configuration. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    fetchPlanData();
  }, [fetchPlanData]);

  // Re-add local validation useEffect
  useEffect(() => {
    const errors: ValidationErrors = {};
    // Use backend field names for keys if they differ
    if (baseRate !== undefined && baseRate < 0) errors.base_rate = 'Base rate cannot be negative';
    if (minimumUsage !== undefined && minimumUsage < 0) errors.minimum_usage = 'Minimum usage cannot be negative';
    if (!unitOfMeasure) errors.unit_of_measure = 'Unit of measure is required';

    if (enableTieredPricing && tiers.length > 0) {
      const sortedTiers = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);
      let tierErrorFound = false;
      for (let i = 0; i < sortedTiers.length; i++) {
        const currentTier = sortedTiers[i];
        if (currentTier.rate < 0) {
            errors.tiers = 'Tier rates cannot be negative.';
            tierErrorFound = true; break;
        }
        if (currentTier.toAmount !== null && currentTier.toAmount < currentTier.fromAmount) {
            errors.tiers = `Tier ${i + 1}: Upper bound must be greater than or equal to lower bound.`;
            tierErrorFound = true; break;
        }
        if (i < sortedTiers.length - 1) {
            const nextTier = sortedTiers[i + 1];
            if (currentTier.toAmount === null) {
                errors.tiers = 'Only the last tier can have an unlimited upper bound (leave "To" blank).';
                tierErrorFound = true; break;
            }
            // Allow adjacent tiers: upper bound can equal next lower bound
            if (currentTier.toAmount > nextTier.fromAmount) {
                errors.tiers = `Tier ${i + 1} overlaps with Tier ${i + 2}. Upper bound must be less than or equal to the next tier's lower bound.`;
                tierErrorFound = true; break;
            }
             // Check for gaps between tiers
            if (currentTier.toAmount + 1 < nextTier.fromAmount) {
                 errors.tiers = `Gap detected between Tier ${i + 1} and Tier ${i + 2}. Tiers must be contiguous.`;
                 tierErrorFound = true; break;
            }
        }
      }
       if (!tierErrorFound && sortedTiers[0]?.fromAmount !== 0) {
           errors.tiers = 'The first tier must start from 0.';
       }
    } else if (enableTieredPricing && tiers.length === 0) {
        errors.tiers = 'At least one tier is required when tiered pricing is enabled.';
    }

    setValidationErrors(errors);
  }, [baseRate, minimumUsage, unitOfMeasure, tiers, enableTieredPricing]);

  // Re-add handleSave function
  const handleSave = async () => {
    // Validation logic moved inside handleSave or called from here
    // Set saveAttempted = true here
    if (!plan) {
        setSaveError("Plan data not loaded.");
        return;
    }

    // Trigger validation check on save attempt
    const errors = validateUsagePlan(); // Assuming a validation function
    setValidationErrors(errors);
    setSaveAttempted(true); // Mark that save was attempted

    if (Object.keys(errors).length > 0) {
        setSaveError("Cannot save, validation errors exist.");
        return; // Stop if validation fails
    }


    setSaving(true);
    setSaveError(null);
    try {
        const tiersToSave = tiers
            .sort((a, b) => a.fromAmount - b.fromAmount)
            .map(({ id, ...rest }) => rest);

        const updatePayload: Partial<UsagePlanConfigFields> = {
            base_rate: enableTieredPricing ? undefined : baseRate,
            unit_of_measure: unitOfMeasure,
            enable_tiered_pricing: enableTieredPricing,
            minimum_usage: minimumUsage,
            tiers: enableTieredPricing ? tiersToSave : [],
        };
        // TODO: Implement correct saving logic for Usage Plan Configuration.
        // This likely involves calling actions that update service-level configuration tables
        // (e.g., plan_service_usage_config, plan_service_rate_tiers) via planServiceConfigurationActions.ts,
        // NOT the generic updateBillingPlan action.
        // await updateBillingPlan(planId, updatePayload as Partial<IBillingPlan>); // Incorrect: updateBillingPlan targets billing_plans table
        console.log("TODO: Implement save for Usage Plan Config:", updatePayload); // Placeholder
        // Simulate success for UI feedback for now
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate async operation

        fetchPlanData(); // Re-fetch data after simulated save
    } catch (err) {
        console.error('Error saving usage plan configuration:', err);
        setSaveError('Failed to save configuration. Please try again.');
    } finally {
        setSaving(false);
    }
  };

  // Define the validation function used in handleSave
  const validateUsagePlan = (): ValidationErrors => {
      const errors: ValidationErrors = {};
      if (baseRate !== undefined && baseRate < 0) errors.base_rate = 'Base rate cannot be negative';
      if (!enableTieredPricing && baseRate === undefined) errors.base_rate = 'Base rate is required when tiered pricing is off.'; // Added required check
      if (minimumUsage !== undefined && minimumUsage < 0) errors.minimum_usage = 'Minimum usage cannot be negative';
      if (!unitOfMeasure) errors.unit_of_measure = 'Unit of measure is required';

      if (enableTieredPricing && tiers.length > 0) {
        const sortedTiers = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);
        let tierErrorFound = false;
        for (let i = 0; i < sortedTiers.length; i++) {
          const currentTier = sortedTiers[i];
          if (currentTier.rate < 0) {
              errors.tiers = 'Tier rates cannot be negative.';
              tierErrorFound = true; break;
          }
          if (currentTier.toAmount !== null && currentTier.toAmount < currentTier.fromAmount) {
              errors.tiers = `Tier ${i + 1}: Upper bound must be greater than or equal to lower bound.`;
              tierErrorFound = true; break;
          }
          if (i < sortedTiers.length - 1) {
              const nextTier = sortedTiers[i + 1];
              if (currentTier.toAmount === null) {
                  errors.tiers = 'Only the last tier can have an unlimited upper bound (leave "To" blank).';
                  tierErrorFound = true; break;
              }
              if (currentTier.toAmount > nextTier.fromAmount) {
                  errors.tiers = `Tier ${i + 1} overlaps with Tier ${i + 2}. Upper bound must be less than or equal to the next tier's lower bound.`;
                  tierErrorFound = true; break;
              }
              if (currentTier.toAmount + 1 < nextTier.fromAmount) {
                   errors.tiers = `Gap detected between Tier ${i + 1} and Tier ${i + 2}. Tiers must be contiguous.`;
                   tierErrorFound = true; break;
              }
          }
        }
         if (!tierErrorFound && sortedTiers[0]?.fromAmount !== 0) {
             errors.tiers = 'The first tier must start from 0.';
         }
      } else if (enableTieredPricing && tiers.length === 0) {
          errors.tiers = 'At least one tier is required when tiered pricing is enabled.';
      }
      return errors;
  };


 const handleAddTier = () => {
    setTiers(prevTiers => {
        const sortedTiers = [...prevTiers].sort((a, b) => a.fromAmount - b.fromAmount);
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

        return [...updatedPreviousTiers, newTier];
    });
};


  const handleRemoveTier = (id: string) => {
    setTiers(prevTiers => {
        const filteredTiers = prevTiers.filter(tier => tier.id !== id);
        // Ensure the new last tier has toAmount = null if it exists
        if (filteredTiers.length > 0) {
            const lastIndex = filteredTiers.length - 1;
            // Make sure tiers remain sorted before adjusting the last one
            const sortedFilteredTiers = filteredTiers.sort((a, b) => a.fromAmount - b.fromAmount);
            sortedFilteredTiers[lastIndex] = { ...sortedFilteredTiers[lastIndex], toAmount: null };
            return sortedFilteredTiers;
        }
        return filteredTiers; // Return empty array if all tiers were removed
    });
  };


 const handleTierChange = (id: string, field: keyof TierConfig, value: string) => {
     setTiers(prevTiers => prevTiers.map(tier => {
        if (tier.id === id) {
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
            const isFirstTier = prevTiers.sort((a,b) => a.fromAmount - b.fromAmount)[0]?.id === id;
            if (field === 'fromAmount' && isFirstTier) {
                 processedValue = 0;
            }

            return { ...tier, [field]: processedValue };
        }
        return tier;
    }));
  };


  // Simplified number input handler
  const handleNumberInputChange = (setter: React.Dispatch<React.SetStateAction<number | undefined>>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value === '' ? undefined : Number(e.target.value);
       if (!isNaN(value as number) && (value as number) >= 0) {
           setter(value);
       } else if (e.target.value === '') {
            setter(undefined); // Allow clearing the input
       }
  };


  if (loading && !plan) {
    return <div className="flex justify-center items-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className={`m-4 ${className}`}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

   if (!plan) {
      return <div className="p-4">Plan not found or invalid type.</div>;
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <Card>
        <CardHeader>
          <CardTitle>Usage-Based Plan Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {saveError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          {/* Basic Usage Settings */}
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="usage-plan-base-rate" className="inline-flex items-center">Default Rate per Unit <span className="text-destructive">*</span>
                <Tooltip content="Rate per unit (used if tiered pricing is off).">
                  <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
                </Tooltip>
              </Label>
              <Input
                id="usage-plan-base-rate" type="number"
                value={baseRate?.toString() || ''}
                onChange={handleNumberInputChange(setBaseRate)}
                placeholder="Enter base rate" disabled={saving || enableTieredPricing} // Keep saving disable
                min={0} step={0.01}
                className={saveAttempted && validationErrors.base_rate ? 'border-red-500' : ''} // Conditional error class
              />
              {saveAttempted && validationErrors.base_rate && <p className="text-sm text-red-500 mt-1">{validationErrors.base_rate}</p>}
              {/* Removed description paragraph */}
            </div>
            <div>
              <Label htmlFor="usage-plan-unit-of-measure" className="inline-flex items-center">Unit of Measure <span className="text-destructive">*</span>
                <Tooltip content="e.g., GB, User, Device.">
                  <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
                </Tooltip>
              </Label>
              <UnitOfMeasureInput
                value={unitOfMeasure}
                onChange={setUnitOfMeasure}
                placeholder="Select unit" /*required removed*/ disabled={saving} // Keep saving disable
                serviceType="Usage" // Or dynamically set based on service if needed
                className={saveAttempted && validationErrors.unit_of_measure ? 'border-red-500' : ''} // Conditional error class
              />
               {saveAttempted && validationErrors.unit_of_measure && <p className="text-sm text-red-500 mt-1">{validationErrors.unit_of_measure}</p>}
               {/* Removed description paragraph */}
            </div>
             <div>
              <Label htmlFor="minimum-usage" className="inline-flex items-center">Minimum Usage
                <Tooltip content="Minimum billable units per period.">
                  <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
                </Tooltip>
              </Label>
              <Input
                id="minimum-usage" type="number"
                value={minimumUsage?.toString() || ''}
                onChange={handleNumberInputChange(setMinimumUsage)}
                placeholder="0" disabled={saving} min={0} step={1} // Keep saving disable
                className={saveAttempted && validationErrors.minimum_usage ? 'border-red-500' : ''} // Conditional error class
              />
              {saveAttempted && validationErrors.minimum_usage && <p className="text-sm text-red-500 mt-1">{validationErrors.minimum_usage}</p>}
              {/* Removed description paragraph */}
            </div>
             <p className="text-xs text-muted-foreground pt-2"><span className="text-destructive">*</span> Indicates a required field.</p>
          </div>


          {/* Tiered Pricing */}
          <div className="space-y-3 pt-3">
            <div className="flex items-center space-x-2">
              <Switch id="enable-tiered-pricing" checked={enableTieredPricing} onCheckedChange={setEnableTieredPricing} disabled={saving} />
              <Label htmlFor="enable-tiered-pricing" className="cursor-pointer">Enable Tiered Pricing</Label>
            </div>

            {enableTieredPricing && (
              <Card className="bg-muted/40">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-base">Pricing Tiers</CardTitle>
                    <Button id="add-tier-button" type="button" size="sm" variant="outline" onClick={handleAddTier} disabled={saving}>
                      <Plus className="h-4 w-4 mr-1" /> Add Tier
                    </Button>
                </CardHeader>
                <CardContent className="space-y-3">
                   {saveAttempted && validationErrors.tiers && ( // Conditional error display
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{validationErrors.tiers}</AlertDescription>
                    </Alert>
                  )}
                  {tiers.length === 0 && !(saveAttempted && validationErrors.tiers) ? ( // Hide if showing tier error
                    <p className="text-sm text-muted-foreground">No tiers defined. Click "Add Tier".</p>
                  ) : null}
                  {tiers.length > 0 && ( // Only show tier inputs if tiers exist
                    <div className="space-y-2">
                      {/* Header Row */}
                       <div className="grid grid-cols-11 gap-2 items-center font-medium text-xs text-muted-foreground px-2">
                           <div className="col-span-3">From ({unitOfMeasure || 'Units'})</div>
                           <div className="col-span-3">To ({unitOfMeasure || 'Units'})</div>
                           <div className="col-span-4">Rate per {unitOfMeasure || 'Unit'}</div>
                           <div className="col-span-1"></div> {/* Spacer for delete button */}
                       </div>
                      {/* Tier Rows */}
                      {tiers.sort((a, b) => a.fromAmount - b.fromAmount).map((tier, index, sortedTiers) => (
                        <div key={tier.id} className="grid grid-cols-11 gap-2 items-center border p-2 rounded bg-background">
                          <div className="col-span-3">
                            <Input
                              id={`tier-${tier.id}-from`} type="number"
                              value={tier.fromAmount.toString()}
                              onChange={(e) => handleTierChange(tier.id, 'fromAmount', e.target.value)}
                              disabled={saving || index === 0} // First tier 'from' is always 0
                              min={0} step={1} aria-label={`Tier ${index + 1} From Amount`}
                            />
                          </div>
                          <div className="col-span-3">
                            <Input
                              id={`tier-${tier.id}-to`} type="number"
                              value={tier.toAmount === null ? '' : tier.toAmount.toString()}
                              onChange={(e) => handleTierChange(tier.id, 'toAmount', e.target.value)}
                              placeholder={index === sortedTiers.length - 1 ? "Unlimited" : ""}
                              disabled={saving || index !== sortedTiers.length - 1}
                              min={tier.fromAmount} step={1} aria-label={`Tier ${index + 1} To Amount`}
                            />
                          </div>
                          <div className="col-span-4">
                            <Input
                              id={`tier-${tier.id}-rate`} type="number"
                              value={tier.rate.toString()}
                              onChange={(e) => handleTierChange(tier.id, 'rate', e.target.value)}
                              disabled={saving} min={0} step={0.01} aria-label={`Tier ${index + 1} Rate`}
                            />
                          </div>
                          <div className="col-span-1 flex justify-end">
                            <Button
                              id={`remove-tier-${tier.id}-button`} type="button" variant="ghost" size="sm"
                              onClick={() => handleRemoveTier(tier.id)}
                              disabled={saving || tiers.length <= 1} // Cannot remove if only one tier exists
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
            )}
          </div>

          {/* Restore Save Button */}
          <div className="flex justify-end pt-4">
            <Button id="save-usage-config-button" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Configuration
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Placeholder for Services List */}
      <Card>
          <CardHeader>
              <CardTitle>Applicable Services</CardTitle>
          </CardHeader>
          <CardContent>
              <GenericPlanServicesList planId={planId} />
          </CardContent>
      </Card>
    </div>
  );
}