'use client';

import React from 'react';
import { IContractLineServiceBucketConfig } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Label } from '@alga-psa/ui/components/Label';
import { Info } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';

// Define type for validation errors passed from parent
type FormErrors = {
  total_minutes?: string;
  overage_rate?: string;
  // Add other fields if needed
};

interface ServiceBucketConfigFormProps {
  serviceId: string; // Keep serviceId for context if needed, or for the callback
  config: Partial<IContractLineServiceBucketConfig>; // Current config state from parent
  unit_of_measure: string; // Renamed from unitOfMeasure for consistency
  validationErrors: FormErrors; // Validation errors from parent
  saveAttempted: boolean; // Flag from parent indicating save attempt
  disabled: boolean; // Flag from parent to disable form during save
  onConfigChange: (serviceId: string, field: keyof IContractLineServiceBucketConfig, value: any) => void; // Callback to update parent state
}

export function ServiceBucketConfigForm({
  serviceId,
  config,
  unit_of_measure,
  validationErrors,
  saveAttempted,
  disabled,
  onConfigChange,
}: ServiceBucketConfigFormProps) {

  // --- Pluralization Helper ---
  const pluralizeUnit = (unit: string): string => {
    if (!unit) return 'Units'; // Fallback
    if (unit.toLowerCase().endsWith('s')) {
      return unit;
    }
    return `${unit}s`;
  };

  const unitNameSingular = unit_of_measure || 'Unit';
  const unitNamePlural = pluralizeUnit(unit_of_measure || 'Units');
  const unitNameSingularLower = unitNameSingular.toLowerCase();
  const unitNamePluralLower = unitNamePlural.toLowerCase();

  // --- Input Handlers ---
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    const field = name as keyof IContractLineServiceBucketConfig;
    const isNumberInput = type === 'number';
    const processedValue = isNumberInput ? (value === '' ? null : parseFloat(value)) : value;
    onConfigChange(serviceId, field, processedValue);
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    const field = name as keyof IContractLineServiceBucketConfig;
    onConfigChange(serviceId, field, checked);
  };

  // Determine if a field has an error
  const hasError = (field: keyof FormErrors): boolean => {
    return saveAttempted && !!validationErrors[field];
  };

  return (
    <div className="space-y-4">
      {/* Total Hours Input */}
      <div>
        <div className="flex items-center space-x-1">
          <Label htmlFor={`total-${unitNamePluralLower}-input-${serviceId}`}>
            Total {unitNamePlural} in Bucket
          </Label>
          <Tooltip content={`The total number of ${unitNamePluralLower} included in this bucket per billing period.`}>
             <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
          </Tooltip>
        </div>
        <Input
          id={`total-${unitNamePluralLower}-input-${serviceId}`}
          data-testid={`total-${unitNamePluralLower}-input-${serviceId}`}
          type="number"
          placeholder={`Enter total hours`}
          min={0}
          step={0.01}
          name="total_minutes"
          value={config.total_minutes != null ? (config.total_minutes / 60) : ''} // Display hours
          onChange={(e) => {
            const hours = parseFloat(e.target.value);
            const minutes = isNaN(hours) ? null : Math.round(hours * 60);
            onConfigChange(serviceId, 'total_minutes', minutes);
          }}
          disabled={disabled}
          className={`mt-1 ${hasError('total_minutes') ? 'border-red-500' : ''}`}
          aria-invalid={hasError('total_minutes')}
          aria-describedby={hasError('total_minutes') ? `total-minutes-error-${serviceId}` : undefined}
        />
        {hasError('total_minutes') && (
          <p id={`total-minutes-error-${serviceId}`} className="text-xs text-red-500 mt-1">
            {validationErrors.total_minutes}
          </p>
        )}
      </div>

      {/* Overage Rate Input */}
      <div>
        <div className="flex items-center space-x-1">
          <Label htmlFor={`overage-rate-${unitNameSingularLower}-input-${serviceId}`}>
            Overage Rate per {unitNameSingular}
          </Label>
           <Tooltip content={`The rate charged for each ${unitNameSingularLower} used beyond the included amount. (e.g., $)`}>
             <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
          </Tooltip>
        </div>
        <Input
          id={`overage-rate-${unitNameSingularLower}-input-${serviceId}`}
          data-testid={`overage-rate-${unitNameSingularLower}-input-${serviceId}`}
          type="number"
          placeholder="Enter overage rate"
          min={0}
          step={0.01}
          name="overage_rate"
          value={config.overage_rate ?? ''} // Use value from prop, handle null/undefined
          onChange={handleInputChange}
          disabled={disabled}
          className={`mt-1 ${hasError('overage_rate') ? 'border-red-500' : ''}`}
          aria-invalid={hasError('overage_rate')}
          aria-describedby={hasError('overage_rate') ? `overage-rate-error-${serviceId}` : undefined}
        />
        {hasError('overage_rate') && (
          <p id={`overage-rate-error-${serviceId}`} className="text-xs text-red-500 mt-1">
            {validationErrors.overage_rate}
          </p>
        )}
      </div>

      {/* Allow Rollover Checkbox */}
      <div className="flex items-center space-x-2 pt-2">
        <Checkbox
          id={`allow-rollover-${unitNamePluralLower}-checkbox-${serviceId}`}
          data-testid={`allow-rollover-${unitNamePluralLower}-checkbox-${serviceId}`}
          name="allow_rollover" // Add name attribute for handler
          checked={config.allow_rollover ?? false} // Use value from prop, handle null/undefined
          onChange={handleCheckboxChange} // Use standard onChange
          disabled={disabled}
        />
        <div className="flex items-center space-x-1">
          <Label htmlFor={`allow-rollover-${unitNamePluralLower}-checkbox-${serviceId}`} className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
            Allow unused {unitNamePluralLower} to roll over
          </Label>
           <Tooltip content={`If checked, unused ${unitNamePluralLower} from one period can be used in the next.`}>
             <Info className="h-4 w-4 text-muted-foreground ml-1 cursor-help" />
          </Tooltip>
        </div>
      </div>
      {/* No specific error message for boolean usually needed */}
    </div>
  );
}
