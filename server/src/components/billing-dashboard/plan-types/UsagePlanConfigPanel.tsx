'use client'

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import { UnitOfMeasureInput } from '../UnitOfMeasureInput';
import { Button } from 'server/src/components/ui/Button';
import { Trash2, Plus } from 'lucide-react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';

interface TierConfig {
  id: string;
  fromAmount: number;
  toAmount: number | null;
  rate: number;
}

interface UsagePlanConfigPanelProps {
  baseRate?: number;
  onBaseRateChange: (value: number | undefined) => void;
  unitOfMeasure: string;
  onUnitOfMeasureChange: (value: string) => void;
  enableTieredPricing?: boolean;
  onEnableTieredPricingChange: (value: boolean) => void;
  minimumUsage?: number;
  onMinimumUsageChange?: (value: number | undefined) => void;
  tiers?: TierConfig[];
  onTiersChange?: (tiers: TierConfig[]) => void;
  className?: string;
  disabled?: boolean;
}

export function UsagePlanConfigPanel({
  baseRate,
  onBaseRateChange,
  unitOfMeasure,
  onUnitOfMeasureChange,
  enableTieredPricing = false,
  onEnableTieredPricingChange,
  minimumUsage = 0,
  onMinimumUsageChange,
  tiers = [],
  onTiersChange,
  className = '',
  disabled = false
}: UsagePlanConfigPanelProps) {
  const [validationErrors, setValidationErrors] = useState<{
    baseRate?: string;
    minimumUsage?: string;
    tiers?: string;
  }>({});

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      baseRate?: string;
      minimumUsage?: string;
      tiers?: string;
    } = {};

    if (baseRate !== undefined && baseRate < 0) {
      errors.baseRate = 'Base rate cannot be negative';
    }

    if (minimumUsage !== undefined && minimumUsage < 0) {
      errors.minimumUsage = 'Minimum usage cannot be negative';
    }

    // Validate tiers if enabled
    if (enableTieredPricing && tiers.length > 0) {
      // Check for overlapping tiers
      const sortedTiers = [...tiers].sort((a, b) => a.fromAmount - b.fromAmount);
      for (let i = 0; i < sortedTiers.length - 1; i++) {
        const currentTier = sortedTiers[i];
        const nextTier = sortedTiers[i + 1];
        
        if (currentTier.toAmount === null) {
          errors.tiers = 'Only the last tier can have an unlimited upper bound';
          break;
        }
        
        if (currentTier.toAmount >= nextTier.fromAmount) {
          errors.tiers = 'Tiers cannot overlap';
          break;
        }
        
        if (currentTier.toAmount < currentTier.fromAmount) {
          errors.tiers = 'Tier upper bound must be greater than lower bound';
          break;
        }
      }
      
      // Check if any tier has negative rate
      if (tiers.some(tier => tier.rate < 0)) {
        errors.tiers = errors.tiers || 'Tier rates cannot be negative';
      }
    }

    setValidationErrors(errors);
  }, [baseRate, minimumUsage, tiers, enableTieredPricing]);

  const handleBaseRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    onBaseRateChange(value);
  };

  const handleMinimumUsageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onMinimumUsageChange) return;
    const value = e.target.value === '' ? undefined : Number(e.target.value);
    onMinimumUsageChange(value);
  };

  const handleAddTier = () => {
    if (!onTiersChange) return;
    
    const newTier: TierConfig = {
      id: Date.now().toString(),
      fromAmount: tiers.length > 0 ? (tiers[tiers.length - 1].toAmount || 0) + 1 : 1,
      toAmount: tiers.length > 0 ? (tiers[tiers.length - 1].toAmount || 0) + 100 : 100,
      rate: baseRate || 0
    };
    
    // If this is the first tier, set fromAmount to 0
    if (tiers.length === 0) {
      newTier.fromAmount = 0;
    }
    
    onTiersChange([...tiers, newTier]);
  };

  const handleRemoveTier = (id: string) => {
    if (!onTiersChange) return;
    onTiersChange(tiers.filter(tier => tier.id !== id));
  };

  const handleTierChange = (id: string, field: keyof TierConfig, value: number | null) => {
    if (!onTiersChange) return;
    
    const updatedTiers = tiers.map(tier => {
      if (tier.id === id) {
        return { ...tier, [field]: value };
      }
      return tier;
    });
    
    onTiersChange(updatedTiers);
  };

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">Usage-Based Plan Configuration</h3>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="usage-plan-base-rate">Base Rate</Label>
            <Input
              id="usage-plan-base-rate"
              type="number"
              value={baseRate?.toString() || ''}
              onChange={handleBaseRateChange}
              placeholder="Enter base rate"
              disabled={disabled}
              min={0}
              step={0.01}
              className={validationErrors.baseRate ? 'border-red-500' : ''}
            />
            {validationErrors.baseRate ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.baseRate}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The standard rate per unit for this plan
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="usage-plan-unit-of-measure">Unit of Measure</Label>
            <UnitOfMeasureInput
              value={unitOfMeasure}
              onChange={onUnitOfMeasureChange}
              placeholder="Select unit of measure"
              required
              disabled={disabled}
              serviceType="Usage"
            />
            <p className="text-sm text-gray-500 mt-1">
              The unit used to measure usage (e.g., GB, User, Device)
            </p>
          </div>

          {onMinimumUsageChange && (
            <div>
              <Label htmlFor="minimum-usage">Minimum Usage Threshold</Label>
              <Input
                id="minimum-usage"
                type="number"
                value={minimumUsage?.toString() || ''}
                onChange={handleMinimumUsageChange}
                placeholder="0"
                disabled={disabled}
                min={0}
                step={1}
                className={validationErrors.minimumUsage ? 'border-red-500' : ''}
              />
              {validationErrors.minimumUsage ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.minimumUsage}</p>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  Minimum billable usage per period (0 for no minimum)
                </p>
              )}
            </div>
          )}

          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id="enable-tiered-pricing"
              checked={enableTieredPricing}
              onCheckedChange={onEnableTieredPricingChange}
              disabled={disabled}
            />
            <Label htmlFor="enable-tiered-pricing" className="cursor-pointer">
              Enable Tiered Pricing
            </Label>
          </div>

          {enableTieredPricing && onTiersChange && (
            <div className="pl-6 border-l-2 border-gray-200">
              <div className="mb-2 flex justify-between items-center">
                <h4 className="font-medium">Pricing Tiers</h4>
                <Button
                  id="add-tier-button"
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddTier}
                  disabled={disabled}
                  className="flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" /> Add Tier
                </Button>
              </div>
              
              {validationErrors.tiers && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{validationErrors.tiers}</AlertDescription>
                </Alert>
              )}
              
              {tiers.length === 0 ? (
                <p className="text-sm text-gray-500 mb-2">
                  No tiers configured. Add a tier to define volume-based pricing.
                </p>
              ) : (
                <div className="space-y-3">
                  {tiers.map((tier, index) => (
                    <div key={tier.id} className="grid grid-cols-12 gap-2 items-end border p-2 rounded-md bg-gray-50">
                      <div className="col-span-3">
                        <Label htmlFor={`tier-${tier.id}-from`} className="text-xs">From ({unitOfMeasure})</Label>
                        <Input
                          id={`tier-${tier.id}-from`}
                          type="number"
                          value={tier.fromAmount}
                          onChange={(e) => handleTierChange(tier.id, 'fromAmount', Number(e.target.value))}
                          disabled={disabled || index === 0} // First tier always starts at 0
                          min={0}
                          step={1}
                        />
                      </div>
                      <div className="col-span-3">
                        <Label htmlFor={`tier-${tier.id}-to`} className="text-xs">To ({unitOfMeasure})</Label>
                        <Input
                          id={`tier-${tier.id}-to`}
                          type="number"
                          value={tier.toAmount === null ? '' : tier.toAmount}
                          onChange={(e) => handleTierChange(
                            tier.id,
                            'toAmount',
                            e.target.value === '' ? null : Number(e.target.value)
                          )}
                          placeholder={index === tiers.length - 1 ? "Unlimited" : ""}
                          disabled={disabled}
                          min={tier.fromAmount + 1}
                          step={1}
                        />
                      </div>
                      <div className="col-span-4">
                        <Label htmlFor={`tier-${tier.id}-rate`} className="text-xs">Rate per {unitOfMeasure}</Label>
                        <Input
                          id={`tier-${tier.id}-rate`}
                          type="number"
                          value={tier.rate}
                          onChange={(e) => handleTierChange(tier.id, 'rate', Number(e.target.value))}
                          disabled={disabled}
                          min={0}
                          step={0.01}
                        />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <Button
                          id={`remove-tier-${tier.id}-button`}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveTier(tier.id)}
                          disabled={disabled}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <p className="text-sm text-gray-500 mt-3">
                Configure volume-based pricing tiers. Each tier applies its rate to usage that falls within its range.
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}