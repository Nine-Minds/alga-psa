// server/src/components/billing-dashboard/contract-lines/ServiceUsageConfigForm.tsx
'use client';

import React from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Switch } from 'server/src/components/ui/Switch';
import { UnitOfMeasureInput } from 'server/src/components/ui/UnitOfMeasureInput';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Info } from 'lucide-react';
import { ServiceTierEditor, TierConfig } from './ServiceTierEditor'; // Import the tier editor and its config type

// Define the shape of the configuration for a single service
export interface ServiceUsageConfig {
    base_rate?: number;
    unit_of_measure?: string;
    enable_tiered_pricing?: boolean;
    minimum_usage?: number;
    tiers?: TierConfig[]; // Use the imported TierConfig
}

// Define validation errors specific to one service's config
export type ServiceValidationErrors = {
    base_rate?: string;
    unit_of_measure?: string;
    minimum_usage?: string;
    tiers?: string; // Single string for tier-related errors for this service
};

interface ServiceUsageConfigFormProps {
    serviceId: string;
    serviceName: string;
    config: ServiceUsageConfig;
    validationErrors?: ServiceValidationErrors;
    saveAttempted: boolean;
    disabled?: boolean;
    onConfigChange: (serviceId: string, field: keyof ServiceUsageConfig, value: any) => void;
    onTiersChange: (serviceId: string, tiers: TierConfig[]) => void; // Specific handler for tiers array
}

export function ServiceUsageConfigForm({
    serviceId,
    serviceName, // Use serviceName for labels/IDs if needed
    config,
    validationErrors = {},
    saveAttempted,
    disabled = false,
    onConfigChange,
    onTiersChange,
}: ServiceUsageConfigFormProps) {
    // Local state for formatted rate input
    const [baseRateInput, setBaseRateInput] = React.useState<string>('');

    // Sync local input state with config prop
    React.useEffect(() => {
        const rateInDollars = config?.base_rate !== null && config?.base_rate !== undefined
            ? (config.base_rate / 100).toFixed(2)
            : '';
        setBaseRateInput(rateInDollars);
    }, [config?.base_rate]);

    const handleInputChange = (field: keyof ServiceUsageConfig) =>
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value;
            onConfigChange(serviceId, field, value);
        };

    const handleNumberInputChange = (field: keyof ServiceUsageConfig) =>
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value === '' ? undefined : Number(e.target.value);
             if (!isNaN(value as number) && (value as number) >= 0) {
                 onConfigChange(serviceId, field, value);
             } else if (e.target.value === '') {
                  onConfigChange(serviceId, field, undefined); // Allow clearing
             }
        };

    const handleSwitchChange = (field: keyof ServiceUsageConfig) =>
        (checked: boolean) => {
            onConfigChange(serviceId, field, checked);
        };

    const handleUnitOfMeasureChange = (value: string) => {
        onConfigChange(serviceId, 'unit_of_measure', value);
    };

    const isTiered = config.enable_tiered_pricing ?? false;
    const unit = config.unit_of_measure || '';

    return (
        <div className="space-y-4">
            {/* Basic Usage Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <Label htmlFor={`usage-contract-line-base-rate-${serviceId}`} className="inline-flex items-center">
                        Default Rate per Unit { !isTiered && <span className="text-destructive">*</span>}
                        <Tooltip content="Rate per unit (used if tiered pricing is off).">
                            <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
                        </Tooltip>
                    </Label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <Input
                            id={`usage-contract-line-base-rate-${serviceId}`}
                            type="text"
                            inputMode="decimal"
                            value={baseRateInput}
                            onChange={(e) => {
                                const value = e.target.value.replace(/[^0-9.]/g, '');
                                const decimalCount = (value.match(/\./g) || []).length;
                                if (decimalCount <= 1) {
                                    setBaseRateInput(value);
                                }
                            }}
                            onBlur={() => {
                                if (baseRateInput.trim() === '' || baseRateInput === '.') {
                                    setBaseRateInput('');
                                    onConfigChange(serviceId, 'base_rate', undefined);
                                } else {
                                    const dollars = parseFloat(baseRateInput) || 0;
                                    const cents = Math.round(dollars * 100);
                                    onConfigChange(serviceId, 'base_rate', cents);
                                    setBaseRateInput((cents / 100).toFixed(2));
                                }
                            }}
                            placeholder="0.00"
                            disabled={disabled || isTiered}
                            className={`pl-7 ${saveAttempted && validationErrors.base_rate ? 'border-red-500' : ''}`}
                        />
                    </div>
                    {saveAttempted && validationErrors.base_rate && <p className="text-sm text-red-500 mt-1">{validationErrors.base_rate}</p>}
                </div>
                <div>
                    <Label htmlFor={`usage-contract-line-unit-of-measure-${serviceId}`} className="inline-flex items-center">
                        Unit of Measure <span className="text-destructive">*</span>
                        <Tooltip content="e.g., GB, User, Device.">
                            <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
                        </Tooltip>
                    </Label>
                    <UnitOfMeasureInput
                        value={unit}
                        onChange={handleUnitOfMeasureChange}
                        placeholder="Select unit"
                        disabled={disabled}
                        serviceType="Usage" // Assuming Usage type for now
                        className={saveAttempted && validationErrors.unit_of_measure ? 'border-red-500' : ''}
                    />
                    {saveAttempted && validationErrors.unit_of_measure && <p className="text-sm text-red-500 mt-1">{validationErrors.unit_of_measure}</p>}
                </div>
                <div>
                    <Label htmlFor={`minimum-usage-${serviceId}`} className="inline-flex items-center">
                        Minimum Usage
                        <Tooltip content="Minimum billable units per period.">
                            <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
                        </Tooltip>
                    </Label>
                    <Input
                        id={`minimum-usage-${serviceId}`}
                        type="number"
                        value={config.minimum_usage?.toString() || ''}
                        onChange={handleNumberInputChange('minimum_usage')}
                        placeholder="0"
                        disabled={disabled}
                        min={0} step={1}
                        className={saveAttempted && validationErrors.minimum_usage ? 'border-red-500' : ''}
                    />
                    {saveAttempted && validationErrors.minimum_usage && <p className="text-sm text-red-500 mt-1">{validationErrors.minimum_usage}</p>}
                </div>
            </div>
             <p className="text-xs text-muted-foreground pt-2"><span className="text-destructive">*</span> Indicates a required field.</p>

            {/* Tiered Pricing Section */}
            <div className="space-y-3 pt-3">
                <div className="flex items-center space-x-2">
                    <Switch
                        id={`enable-tiered-pricing-${serviceId}`}
                        checked={isTiered}
                        onCheckedChange={handleSwitchChange('enable_tiered_pricing')}
                        disabled={disabled}
                    />
                    <Label htmlFor={`enable-tiered-pricing-${serviceId}`} className="cursor-pointer">Enable Tiered Pricing for {serviceName}</Label>
                </div>

                {isTiered && (
                    <ServiceTierEditor
                        serviceId={serviceId}
                        tiers={config.tiers || []}
                        unitOfMeasure={unit}
                        baseRate={config.base_rate} // Pass base rate for default new tier rate
                        validationError={saveAttempted ? validationErrors.tiers : undefined} // Only show tier error after save attempt
                        disabled={disabled}
                        onTiersChange={onTiersChange} // Pass the specific tier change handler
                    />
                )}
            </div>
        </div>
    );
}