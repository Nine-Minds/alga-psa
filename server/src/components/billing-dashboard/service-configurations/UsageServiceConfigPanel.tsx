'use client'

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Card } from 'server/src/components/ui/Card';
import { Switch } from 'server/src/components/ui/Switch';
import { Button } from 'server/src/components/ui/Button';
import { Trash2, Plus } from 'lucide-react';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { IContractLineServiceUsageConfig, IContractLineServiceRateTier } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';

interface UsageServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceUsageConfig>;
  rateTiers?: IContractLineServiceRateTier[];
  onConfigurationChange: (updates: Partial<IContractLineServiceUsageConfig>) => void;
  onRateTiersChange?: (tiers: IContractLineServiceRateTier[]) => void;
  className?: string;
  disabled?: boolean;
}

interface TierData {
  id: string;
  min_quantity: number;
  max_quantity: number | null;
  rate: number;
}

export function UsageServiceConfigPanel({
  configuration,
  rateTiers = [],
  onConfigurationChange,
  onRateTiersChange,
  className = '',
  disabled = false
}: UsageServiceConfigPanelProps) {
  const [unitOfMeasure, setUnitOfMeasure] = useState(configuration.unit_of_measure || 'Unit');
  const [enableTieredPricing, setEnableTieredPricing] = useState(configuration.enable_tiered_pricing || false);
  const [minimumUsage, setMinimumUsage] = useState<number>(configuration.minimum_usage || 0);
  const [tiers, setTiers] = useState<TierData[]>(
    rateTiers.map(tier => ({
      id: tier.tier_id || Date.now().toString(),
      min_quantity: tier.min_quantity,
      max_quantity: tier.max_quantity || null,
      rate: tier.rate
    }))
  );
  const [validationErrors, setValidationErrors] = useState<{
    unitOfMeasure?: string;
    minimumUsage?: string;
    tiers?: string;
  }>({});

  // Update local state when props change
  useEffect(() => {
    setUnitOfMeasure(configuration.unit_of_measure || 'Unit');
    setEnableTieredPricing(configuration.enable_tiered_pricing || false);
    setMinimumUsage(configuration.minimum_usage || 0);
    
    if (rateTiers) {
      setTiers(
        rateTiers.map(tier => ({
          id: tier.tier_id || Date.now().toString(),
          min_quantity: tier.min_quantity,
          max_quantity: tier.max_quantity || null,
          rate: tier.rate
        }))
      );
    }
  }, [configuration, rateTiers]);

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      unitOfMeasure?: string;
      minimumUsage?: string;
      tiers?: string;
    } = {};

    if (!unitOfMeasure) {
      errors.unitOfMeasure = 'Unit of measure is required';
    }

    if (minimumUsage < 0) {
      errors.minimumUsage = 'Minimum usage cannot be negative';
    }

    // Validate tiers if enabled
    if (enableTieredPricing && tiers.length > 0) {
      // Check for overlapping tiers
      const sortedTiers = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity);
      for (let i = 0; i < sortedTiers.length - 1; i++) {
        const currentTier = sortedTiers[i];
        const nextTier = sortedTiers[i + 1];
        
        if (currentTier.max_quantity === null) {
          errors.tiers = 'Only the last tier can have an unlimited upper bound';
          break;
        }
        
        if (currentTier.max_quantity >= nextTier.min_quantity) {
          errors.tiers = 'Tiers cannot overlap';
          break;
        }
        
        if (currentTier.max_quantity < currentTier.min_quantity) {
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
  }, [unitOfMeasure, minimumUsage, tiers, enableTieredPricing]);

  const handleUnitOfMeasureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUnitOfMeasure(value);
    onConfigurationChange({ unit_of_measure: value });
  };

  const handleEnableTieredPricingChange = (checked: boolean) => {
    setEnableTieredPricing(checked);
    onConfigurationChange({ enable_tiered_pricing: checked });
  };

  const handleMinimumUsageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setMinimumUsage(value);
    onConfigurationChange({ minimum_usage: value });
  };

  const handleAddTier = () => {
    if (!onRateTiersChange) return;
    
    // Ensure tiered pricing is enabled when adding tiers
    if (!enableTieredPricing) {
      setEnableTieredPricing(true);
      onConfigurationChange({ enable_tiered_pricing: true });
    }
    
    const newTier: TierData = {
      id: Date.now().toString(),
      min_quantity: tiers.length > 0 ? (tiers[tiers.length - 1].max_quantity || 0) + 1 : 1,
      max_quantity: tiers.length > 0 ? (tiers[tiers.length - 1].max_quantity || 0) + 100 : 100,
      rate: 0 // Rate is stored in cents
    };
    
    // If this is the first tier, set min_quantity to 0
    if (tiers.length === 0) {
      newTier.min_quantity = 0;
    }
    
    const updatedTiers = [...tiers, newTier];
    setTiers(updatedTiers);
    
    // Convert to IContractLineServiceRateTier format for the parent component
    const formattedTiers = updatedTiers.map(tier => ({
      tier_id: tier.id,
      config_id: '', // This will be set by the backend
      min_quantity: tier.min_quantity,
      max_quantity: tier.max_quantity === null ? undefined : tier.max_quantity,
      rate: tier.rate, // Already in cents
      tenant: '', // This will be set by the backend
      created_at: new Date(),
      updated_at: new Date()
    }));
    
    onRateTiersChange(formattedTiers);
  };

  const handleRemoveTier = (id: string) => {
    if (!onRateTiersChange) return;
    
    const updatedTiers = tiers.filter(tier => tier.id !== id);
    setTiers(updatedTiers);
    
    // Convert to IContractLineServiceRateTier format for the parent component
    const formattedTiers = updatedTiers.map(tier => ({
      tier_id: tier.id,
      config_id: '', // This will be set by the backend
      min_quantity: tier.min_quantity,
      max_quantity: tier.max_quantity === null ? undefined : tier.max_quantity,
      rate: tier.rate, // Already in cents
      tenant: '', // This will be set by the backend
      created_at: new Date(),
      updated_at: new Date()
    }));
    
    onRateTiersChange(formattedTiers);
  };

  const handleTierChange = (id: string, field: keyof TierData, value: number | null) => {
    if (!onRateTiersChange) return;
    
    const updatedTiers = tiers.map(tier => {
      if (tier.id === id) {
        // Store rate in cents if the field is 'rate'
        return { ...tier, [field]: field === 'rate' && typeof value === 'number' ? Math.round(value * 100) : value };
      }
      return tier;
    });
    
    setTiers(updatedTiers);
    
    // Convert to IContractLineServiceRateTier format for the parent component
    const formattedTiers = updatedTiers.map(tier => ({
      tier_id: tier.id,
      config_id: '', // This will be set by the backend
      min_quantity: tier.min_quantity,
      max_quantity: tier.max_quantity === null ? undefined : tier.max_quantity,
      rate: tier.rate, // Already in cents
      tenant: '', // This will be set by the backend
      created_at: new Date(),
      updated_at: new Date()
    }));
    
    onRateTiersChange(formattedTiers);
  };

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">Usage-Based Configuration</h3>
        <div className="grid gap-4">
          <div>
            <Label htmlFor="usage-unit-of-measure">Unit of Measure</Label>
            <Input
              id="usage-unit-of-measure"
              type="text"
              value={unitOfMeasure}
              onChange={handleUnitOfMeasureChange}
              placeholder="Enter unit of measure"
              disabled={disabled}
              className={validationErrors.unitOfMeasure ? 'border-red-500' : ''}
            />
            {validationErrors.unitOfMeasure ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.unitOfMeasure}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The unit used to measure usage (e.g., GB, User, Device)
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="minimum-usage">Minimum Usage Threshold</Label>
            <Input
              id="minimum-usage"
              type="number"
              value={minimumUsage.toString()}
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

          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id="enable-tiered-pricing"
              checked={enableTieredPricing}
              onCheckedChange={handleEnableTieredPricingChange}
              disabled={disabled}
            />
            <Label htmlFor="enable-tiered-pricing" className="cursor-pointer">
              Enable Tiered Pricing
            </Label>
          </div>

          {enableTieredPricing && onRateTiersChange && (
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
                          value={tier.min_quantity}
                          onChange={(e) => handleTierChange(tier.id, 'min_quantity', Number(e.target.value))}
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
                          value={tier.max_quantity === null ? '' : tier.max_quantity}
                          onChange={(e) => handleTierChange(
                            tier.id,
                            'max_quantity',
                            e.target.value === '' ? null : Number(e.target.value)
                          )}
                          placeholder={index === tiers.length - 1 ? "Unlimited" : ""}
                          disabled={disabled}
                          min={tier.min_quantity + 1}
                          step={1}
                        />
                      </div>
                      <div className="col-span-4">
                        <Label htmlFor={`tier-${tier.id}-rate`} className="text-xs">Rate per {unitOfMeasure}</Label>
                        <Input
                          id={`tier-${tier.id}-rate`}
                          type="number"
                          value={(tier.rate / 100).toString()} // Display in dollars
                          onChange={(e) => handleTierChange(tier.id, 'rate', Number(e.target.value))} // handleTierChange will convert to cents
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
