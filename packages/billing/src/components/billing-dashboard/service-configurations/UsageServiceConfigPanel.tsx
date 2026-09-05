'use client'

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Button } from '@alga-psa/ui/components/Button';
import { RadioGroup } from '@alga-psa/ui/components/RadioGroup';
import { Trash2, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import { IContractLineServiceUsageConfig, IContractLineServiceRateTier } from '@alga-psa/types';
import type { UsageMeasurementMode } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface UsageServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceUsageConfig>;
  rateTiers?: IContractLineServiceRateTier[];
  onConfigurationChange: (updates: Partial<IContractLineServiceUsageConfig>) => void;
  onRateTiersChange?: (tiers: IContractLineServiceRateTier[]) => void;
  idPrefix?: string;
  className?: string;
  disabled?: boolean;
}

interface TierData {
  id: string;
  min_quantity: number;
  max_quantity: number | null;
  rate: number;
}

const EMPTY_RATE_TIERS: IContractLineServiceRateTier[] = [];

export function UsageServiceConfigPanel({
  configuration,
  rateTiers = EMPTY_RATE_TIERS,
  onConfigurationChange,
  onRateTiersChange,
  idPrefix = '',
  className = '',
  disabled = false
}: UsageServiceConfigPanelProps) {
  const { t } = useTranslation('msp/service-catalog');
  const defaultUnitOfMeasure = t('usageConfig.defaults.unitOfMeasure', {
    defaultValue: 'Unit',
  });
  const [unitOfMeasure, setUnitOfMeasure] = useState(configuration.unit_of_measure || defaultUnitOfMeasure);
  const [enableTieredPricing, setEnableTieredPricing] = useState(configuration.enable_tiered_pricing || false);
  const [minimumUsage, setMinimumUsage] = useState<number>(configuration.minimum_usage || 0);
  // Legacy configurations carry no explicit mode; they measure additive
  // consumption entries, so an absent value resolves to 'additive'.
  const [measurementMode, setMeasurementMode] = useState<UsageMeasurementMode>(
    configuration.measurement_mode === 'period_total' ? 'period_total' : 'additive'
  );
  const [tiers, setTiers] = useState<TierData[]>(
    rateTiers.map(tier => ({
      id: tier.tier_id || Date.now().toString(),
      min_quantity: tier.min_quantity,
      max_quantity: tier.max_quantity ?? null,
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
    setUnitOfMeasure(configuration.unit_of_measure || defaultUnitOfMeasure);
    setEnableTieredPricing(configuration.enable_tiered_pricing || false);
    setMinimumUsage(configuration.minimum_usage || 0);
    setMeasurementMode(configuration.measurement_mode === 'period_total' ? 'period_total' : 'additive');
  }, [configuration.unit_of_measure, configuration.enable_tiered_pricing, configuration.minimum_usage, configuration.measurement_mode, defaultUnitOfMeasure]);

  useEffect(() => {
    // A later effective boundary can have no tiers; clear the previous display.
    setTiers(rateTiers.map(tier => ({
      id: tier.tier_id || `${tier.min_quantity}`,
      min_quantity: tier.min_quantity,
      max_quantity: tier.max_quantity ?? null,
      rate: tier.rate,
    })));
  }, [rateTiers]);

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      unitOfMeasure?: string;
      minimumUsage?: string;
      tiers?: string;
    } = {};

    if (!unitOfMeasure) {
      errors.unitOfMeasure = t('usageConfig.fields.unitOfMeasure.errorRequired', {
        defaultValue: 'Unit of measure is required',
      });
    }

    if (minimumUsage < 0) {
      errors.minimumUsage = t('usageConfig.fields.minimumUsage.errorNegative', {
        defaultValue: 'Minimum usage cannot be negative',
      });
    }

    // Validate tiers if enabled
    if (enableTieredPricing && tiers.length > 0) {
      // Check for overlapping tiers
      const sortedTiers = [...tiers].sort((a, b) => a.min_quantity - b.min_quantity);
      for (let i = 0; i < sortedTiers.length - 1; i++) {
        const currentTier = sortedTiers[i];
        const nextTier = sortedTiers[i + 1];
        
        if (currentTier.max_quantity === null) {
          errors.tiers = t('usageConfig.tiers.errors.onlyLastUnlimited', {
            defaultValue: 'Only the last tier can have an unlimited upper bound',
          });
          break;
        }
        
        if (currentTier.max_quantity >= nextTier.min_quantity) {
          errors.tiers = t('usageConfig.tiers.errors.overlap', {
            defaultValue: 'Tiers cannot overlap',
          });
          break;
        }
        
        if (currentTier.max_quantity < currentTier.min_quantity) {
          errors.tiers = t('usageConfig.tiers.errors.upperGreaterThanLower', {
            defaultValue: 'Tier upper bound must be greater than lower bound',
          });
          break;
        }
      }
      
      // Check if any tier has negative rate
      if (tiers.some(tier => tier.rate < 0)) {
        errors.tiers = errors.tiers || t('usageConfig.tiers.errors.rateNegative', {
          defaultValue: 'Tier rates cannot be negative',
        });
      }
    }

    setValidationErrors(errors);
  }, [unitOfMeasure, minimumUsage, tiers, enableTieredPricing, t]);

  const handleUnitOfMeasureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUnitOfMeasure(value);
    onConfigurationChange({ unit_of_measure: value });
  };

  const handleEnableTieredPricingChange = (checked: boolean) => {
    setEnableTieredPricing(checked);
    onConfigurationChange({ enable_tiered_pricing: checked });
  };

  const handleMeasurementModeChange = (value: string) => {
    const mode: UsageMeasurementMode = value === 'period_total' ? 'period_total' : 'additive';
    setMeasurementMode(mode);
    onConfigurationChange({ measurement_mode: mode });
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
        <h3 className="text-md font-medium">
          {t('usageConfig.title', { defaultValue: 'Usage-Based Configuration' })}
        </h3>
        <p
          className="text-sm text-muted-foreground"
          data-testid="usage-config-record-driven-note"
        >
          {t('usageConfig.recordDrivenNote', {
            defaultValue:
              'Usage services bill from usage recorded in Usage Tracking for each service period. A period with no usage record produces no charge — record usage (or an explicit zero) each period to bill this service.',
          })}
        </p>
        <div className="grid gap-4">
          {/* Measurement mode is the operator's billing intent for this
              service on this contract line: additive consumption entries that
              sum, or one replaceable count reported for each period. The
              choice changes what the next period requires, so the options
              spell that out rather than naming the stored value. */}
          <div data-testid="usage-measurement-mode">
            <Label>
              {t('usageConfig.measurementMode.label', {
                defaultValue: 'How is usage measured?',
              })}
            </Label>
            <RadioGroup
              id={`${idPrefix}usage-measurement-mode`}
              name={`${idPrefix}usage-measurement-mode`}
              value={measurementMode}
              onChange={handleMeasurementModeChange}
              disabled={disabled}
              options={[
                {
                  value: 'additive',
                  label: t('usageConfig.measurementMode.additive.label', {
                    defaultValue: 'Record consumption as it occurs',
                  }),
                  description: t('usageConfig.measurementMode.additive.description', {
                    defaultValue:
                      'Dated entries add together: entries of 10 and 12 bill 22. The minimum and any tiers apply to each entry. The next period starts with no entries.',
                  }),
                },
                {
                  value: 'period_total',
                  label: t('usageConfig.measurementMode.periodTotal.label', {
                    defaultValue: 'Report a count for each period',
                  }),
                  description: t('usageConfig.measurementMode.periodTotal.description', {
                    defaultValue:
                      'One count per service period replaces the previous one: correcting 10 to 12 bills 12, never 22. The minimum and any tiers apply once to that count. The next period starts unreported — no count carries forward.',
                  }),
                },
              ]}
            />
            <p className="text-sm text-muted-foreground mt-2">
              {t('usageConfig.measurementMode.transitionNote', {
                defaultValue:
                  'Changing the mode takes effect from the next unbilled service period. Recorded entries or counts already in an open period must be billed or removed first.',
              })}
            </p>
          </div>

          <div>
            <Label htmlFor={`${idPrefix}usage-unit-of-measure`}>
              {t('usageConfig.fields.unitOfMeasure.label', { defaultValue: 'Unit of Measure' })}
            </Label>
            <Input
              id={`${idPrefix}usage-unit-of-measure`}
              type="text"
              value={unitOfMeasure}
              onChange={handleUnitOfMeasureChange}
              placeholder={t('usageConfig.fields.unitOfMeasure.placeholder', {
                defaultValue: 'Enter unit of measure',
              })}
              disabled={disabled}
              className={validationErrors.unitOfMeasure ? 'border-red-500' : ''}
            />
              {validationErrors.unitOfMeasure ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.unitOfMeasure}</p>
            ) : (
              <p className="text-sm text-muted-foreground mt-1">
                {t('usageConfig.fields.unitOfMeasure.help', {
                  defaultValue: 'The unit used to measure usage (e.g., GB, User, Device)',
                })}
              </p>
            )}
          </div>

          <div>
            <Label htmlFor={`${idPrefix}minimum-usage`}>
              {measurementMode === 'period_total'
                ? t('usageConfig.fields.minimumUsage.labelPeriodTotal', {
                    defaultValue: 'Minimum per period report',
                  })
                : t('usageConfig.fields.minimumUsage.labelAdditive', {
                    defaultValue: 'Minimum per entry',
                  })}
            </Label>
            <Input
              id={`${idPrefix}minimum-usage`}
              type="number"
              value={minimumUsage.toString()}
              onChange={handleMinimumUsageChange}
              placeholder={t('usageConfig.fields.minimumUsage.placeholder', {
                defaultValue: '0',
              })}
              disabled={disabled}
              min={0}
              step={1}
              className={validationErrors.minimumUsage ? 'border-red-500' : ''}
            />
              {validationErrors.minimumUsage ? (
                <p className="text-sm text-red-500 mt-1">{validationErrors.minimumUsage}</p>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  {measurementMode === 'period_total'
                    ? t('usageConfig.fields.minimumUsage.helpPeriodTotal', {
                        defaultValue:
                          'Floor applied once to the reported period count (0 for no minimum). It only applies when a count is reported — even an explicit zero — and never creates a charge on its own.',
                      })
                    : t('usageConfig.fields.minimumUsage.helpAdditive', {
                        defaultValue:
                          'Floor applied to each recorded entry (0 for no minimum). It only applies when the period has a usage record — even an explicit zero — and never creates a charge on its own.',
                      })}
                </p>
              )}
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id={`${idPrefix}enable-tiered-pricing`}
              checked={enableTieredPricing}
              onCheckedChange={handleEnableTieredPricingChange}
              disabled={disabled}
            />
            <Label htmlFor={`${idPrefix}enable-tiered-pricing`} className="cursor-pointer">
              {t('usageConfig.fields.enableTieredPricing', {
                defaultValue: 'Enable Tiered Pricing',
              })}
            </Label>
          </div>

          {enableTieredPricing && (
            <div className="pl-6 border-l-2 border-[rgb(var(--color-border-200))]">
              <div className="mb-2 flex justify-between items-center">
                <h4 className="font-medium">
                  {t('usageConfig.tiers.title', { defaultValue: 'Pricing Tiers' })}
                </h4>
                <Button
                  id={`${idPrefix}add-tier-button`}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddTier}
                  disabled={disabled || !onRateTiersChange}
                  className="flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" /> {t('usageConfig.tiers.addTier', { defaultValue: 'Add Tier' })}
                </Button>
              </div>
              
              {validationErrors.tiers && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{validationErrors.tiers}</AlertDescription>
                </Alert>
              )}
              
              {tiers.length === 0 ? (
                <p className="text-sm text-muted-foreground mb-2">
                  {t('usageConfig.tiers.empty', {
                    defaultValue: 'No tiers configured. Add a tier to define volume-based pricing.',
                  })}
                </p>
              ) : (
                <div className="space-y-3">
                  {tiers.map((tier, index) => (
                    <div key={tier.id} className="grid grid-cols-12 gap-2 items-end border p-2 rounded-md bg-muted">
                      <div className="col-span-3">
                        <Label htmlFor={`${idPrefix}tier-${tier.id}-from`} className="text-xs">
                          {t('usageConfig.tiers.from', {
                            unit: unitOfMeasure,
                            defaultValue: 'From ({{unit}})',
                          })}
                        </Label>
                        <Input
                          id={`${idPrefix}tier-${tier.id}-from`}
                          type="number"
                          value={tier.min_quantity}
                          onChange={(e) => handleTierChange(tier.id, 'min_quantity', Number(e.target.value))}
                          disabled={disabled || !onRateTiersChange || index === 0} // First tier always starts at 0
                          min={0}
                          step={1}
                        />
                      </div>
                      <div className="col-span-3">
                        <Label htmlFor={`${idPrefix}tier-${tier.id}-to`} className="text-xs">
                          {t('usageConfig.tiers.to', {
                            unit: unitOfMeasure,
                            defaultValue: 'To ({{unit}})',
                          })}
                        </Label>
                        <Input
                          id={`${idPrefix}tier-${tier.id}-to`}
                          type="number"
                          value={tier.max_quantity === null ? '' : tier.max_quantity}
                          onChange={(e) => handleTierChange(
                            tier.id,
                            'max_quantity',
                            e.target.value === '' ? null : Number(e.target.value)
                          )}
                          placeholder={index === tiers.length - 1
                            ? t('usageConfig.tiers.unlimited', { defaultValue: 'Unlimited' })
                            : ''}
                          disabled={disabled || !onRateTiersChange}
                          min={tier.min_quantity + 1}
                          step={1}
                        />
                      </div>
                      <div className="col-span-4">
                        <Label htmlFor={`${idPrefix}tier-${tier.id}-rate`} className="text-xs">
                          {t('usageConfig.tiers.ratePer', {
                            unit: unitOfMeasure,
                            defaultValue: 'Rate per {{unit}}',
                          })}
                        </Label>
                        <Input
                          id={`${idPrefix}tier-${tier.id}-rate`}
                          type="number"
                          value={(tier.rate / 100).toString()} // Display in dollars
                          onChange={(e) => handleTierChange(tier.id, 'rate', Number(e.target.value))} // handleTierChange will convert to cents
                          disabled={disabled || !onRateTiersChange}
                          min={0}
                          step={0.01}
                        />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <Button
                          id={`${idPrefix}remove-tier-${tier.id}-button`}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveTier(tier.id)}
                          disabled={disabled || !onRateTiersChange}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              <p className="text-sm text-muted-foreground mt-3">
                {t('usageConfig.tiers.help', {
                  defaultValue:
                    'Configure volume-based pricing tiers. Each tier applies its rate to usage that falls within its range.',
                })}
              </p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
