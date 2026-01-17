'use client'

import React, { useState, useEffect, useCallback } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button'; // Import Button
import * as RadixTooltip from '@radix-ui/react-tooltip'; // Use Radix Tooltip directly
import { Info, Trash2 } from 'lucide-react'; // Import Trash2
import { getCurrencySymbol } from 'server/src/constants/currency';
import { IContractLineServiceHourlyConfig, IUserTypeRate } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import CustomSelect from '@alga-psa/ui/components/CustomSelect'; // Import CustomSelect

// Define the structure for the configuration object (using imported interface)
// export interface IServiceHourlyConfig { ... } // Removed local definition

// Define the structure for validation errors (using imported interface fields)
export interface IServiceHourlyConfigValidationErrors {
  hourly_rate?: string;
  minimum_billable_time?: string;
  round_up_to_nearest?: string;
  // Add validation for user type rates if needed at this level
}

// Define the structure for validation errors
export interface IServiceHourlyConfigValidationErrors {
  hourly_rate?: string;
  minimum_billable_time?: string;
  round_up_to_nearest?: string;
}

interface ServiceHourlyConfigFormProps {
  configId: string; // Make configId required
  config: Partial<IContractLineServiceHourlyConfig>; // Use imported interface
  userTypeRates: IUserTypeRate[]; // Add user type rates prop
  validationErrors?: Partial<IServiceHourlyConfigValidationErrors>;
  disabled?: boolean;
  onHourlyFieldChange: (field: keyof IContractLineServiceHourlyConfig, value: number | null) => void; // Renamed prop
  onUserTypeRatesChange: (newUserTypeRates: IUserTypeRate[]) => void; // Add handler for rates array
  className?: string;
}

export function ServiceHourlyConfigForm({
  configId, // Destructure configId
  config,
  userTypeRates, // Destructure new prop
  validationErrors = {},
  disabled = false,
  onHourlyFieldChange, // Use renamed prop
  onUserTypeRatesChange, // Destructure new prop
  className = '',
}: ServiceHourlyConfigFormProps) {
  // Local state for input values (hourly_rate is handled specially for display)
  // Local state for input values (hourly_rate is handled specially for display)
  const [displayHourlyRate, setDisplayHourlyRate] = useState<string>('');
  // Removed local state for other fields, use props directly
  // const [minimumBillableTime, setMinimumBillableTime] = useState<string>('');
  // const [roundUpToNearest, setRoundUpToNearest] = useState<string>('');

  // State for adding a new user type rate within this form
  const [newUserType, setNewUserType] = useState('');
  const [newUserTypeRateValue, setNewUserTypeRateValue] = useState<number | undefined>(undefined);
  const [newUserTypeRateInput, setNewUserTypeRateInput] = useState<string>('');
  const [userTypeError, setUserTypeError] = useState<string | null>(null);

  // Sync local display state with props
  useEffect(() => {
    // Convert cents to dollars for display
    const rateInDollars = config?.hourly_rate !== null && config?.hourly_rate !== undefined
      ? (config.hourly_rate / 100).toFixed(2)
      : '';
    setDisplayHourlyRate(rateInDollars);
    // Other fields are directly bound to config prop below
  }, [config?.hourly_rate]); // Depend only on the relevant prop field

  // --- Input Handlers ---

  // --- Input Handlers ---

  // Update local display state on every change
  const handleHourlyRateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const displayValue = e.target.value;
    // Allow typing numbers, decimal point, and potentially empty string
    if (/^\d*\.?\d*$/.test(displayValue)) {
        setDisplayHourlyRate(displayValue);
    }
  }, []);

  // Process and update parent state on blur
  const handleHourlyRateBlur = useCallback(() => {
    const numericValue = parseFloat(displayHourlyRate);
    let valueInCents: number | null = null;
    let formattedDisplayValue = '';

    if (!isNaN(numericValue)) {
        valueInCents = Math.round(numericValue * 100);
        formattedDisplayValue = (valueInCents / 100).toFixed(2); // Format to 2 decimal places
    } else {
        // Handle cases like empty string or invalid input -> treat as null
        valueInCents = null;
        formattedDisplayValue = '';
    }

    // Update local display state with formatted value
    setDisplayHourlyRate(formattedDisplayValue);
    // Update parent state with value in cents
    onHourlyFieldChange('hourly_rate', valueInCents);
  }, [displayHourlyRate, onHourlyFieldChange]);

  // Generic handler for simple numeric fields (minutes)
  const handleMinutesInputChange = useCallback((field: keyof IContractLineServiceHourlyConfig) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const numericValue = value === '' ? null : parseInt(value, 10);
    // Allow only non-negative integers or null
    if (numericValue === null || (!isNaN(numericValue) && numericValue >= 0 && Number.isInteger(numericValue))) {
        onHourlyFieldChange(field, numericValue); // Use new handler
    }
  }, [onHourlyFieldChange]);

  // Removed handleRoundUpToNearestChange, covered by handleMinutesInputChange

  // --- Helper for Tooltips (using the project's custom Tooltip) ---
  // --- User Type Rate Handlers ---
  const handleAddUserTypeRate = () => {
    if (!newUserType || newUserTypeRateValue === undefined || newUserTypeRateValue < 0) {
        setUserTypeError('Please select a user type and enter a valid non-negative rate.');
        return;
    }
    if (userTypeRates.some(rate => rate.user_type === newUserType)) {
        setUserTypeError('This user type already has a specific rate.');
        return;
    }

    // Create new rate object (rate_id will be assigned by backend)
    const newRate: IUserTypeRate = {
        rate_id: `new-${Date.now()}`, // Temporary client-side ID for key prop
        config_id: configId, // Use configId from props
        user_type: newUserType,
        rate: newUserTypeRateValue,
        tenant: config?.tenant || '', // Get tenant from config prop if available
        created_at: new Date(), // Placeholder
        updated_at: new Date(), // Placeholder
    };

    onUserTypeRatesChange([...userTypeRates, newRate]); // Update parent state

    // Reset form
    setNewUserType('');
    setNewUserTypeRateValue(undefined);
    setNewUserTypeRateInput('');
    setUserTypeError(null);
  };

  const handleRemoveUserTypeRate = (index: number) => {
    const updatedRates = [...userTypeRates];
    updatedRates.splice(index, 1);
    onUserTypeRatesChange(updatedRates); // Update parent state
  };

   const handleNewRateInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value.replace(/[^0-9.]/g, '');
      const decimalCount = (value.match(/\./g) || []).length;
      if (decimalCount <= 1) {
        setNewUserTypeRateInput(value);
        if (userTypeError) setUserTypeError(null); // Clear error on input change
      }
    };

    const handleNewRateInputBlur = () => {
      if (newUserTypeRateInput.trim() === '' || newUserTypeRateInput === '.') {
        setNewUserTypeRateInput('');
        setNewUserTypeRateValue(undefined);
      } else {
        const dollars = parseFloat(newUserTypeRateInput) || 0;
        const cents = Math.round(dollars * 100);
        setNewUserTypeRateValue(cents);
        setNewUserTypeRateInput((cents / 100).toFixed(2));
      }
    };

   const userTypeOptions = [
     { value: 'technician', label: 'Technician' },
     { value: 'engineer', label: 'Engineer' },
     { value: 'consultant', label: 'Consultant' },
     { value: 'project_manager', label: 'Project Manager' },
     { value: 'admin', label: 'Administrator' }
     // Add other relevant user types here
   ];

  // --- Helper for Tooltips (using Radix UI Tooltip) ---
  const renderTooltip = (tooltipContent: string, triggerIdSuffix?: string) => {
    // Generate a guaranteed string ID for the button
    const buttonId = triggerIdSuffix ? `tooltip-trigger-${configId}-${triggerIdSuffix}` : `tooltip-trigger-${configId}-default`;
    return (
      <RadixTooltip.Root delayDuration={100}>
        <RadixTooltip.Trigger asChild>
           <Button id={buttonId} variant="ghost" size="sm" className="ml-1 h-5 w-5 p-0 align-middle">
            <Info className="h-4 w-4 text-muted-foreground" />
         </Button>
      </RadixTooltip.Trigger>
      <RadixTooltip.Content side="top" className="max-w-xs bg-gray-800 text-white p-2 rounded shadow-lg text-sm z-50">
          <p>{tooltipContent}</p>
      </RadixTooltip.Content>
    </RadixTooltip.Root>
  );
}; // Added missing closing brace for renderTooltip function

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Hourly Rate */}
      <div>
        <div className="flex items-center">
          <Label htmlFor="hourly-rate">Hourly Rate ($)</Label>
          {renderTooltip('The standard rate charged per hour for this service.', `hourly-rate-tooltip-${configId}`)}
        </div>

        {/* This section was incorrectly placed here by the previous diff, removing it */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
          <Input
            id="hourly-rate"
            type="text"
            inputMode="decimal"
            value={displayHourlyRate} // Use local state for display formatting
            onChange={handleHourlyRateChange} // Update display state on change
            onBlur={handleHourlyRateBlur} // Process value and update parent on blur
            placeholder="0.00"
            disabled={disabled}
            className={`pl-10 ${validationErrors.hourly_rate ? 'border-red-500' : ''}`}
          />
        </div>
        {validationErrors.hourly_rate && (
          <p className="text-sm text-red-500 mt-1">{validationErrors.hourly_rate}</p>
        )}
      </div>

      {/* Minimum Billable Time */}
      <div>
        <div className="flex items-center">
          <Label htmlFor="minimum-billable-time">Minimum Billable Time (minutes)</Label>
          {renderTooltip('The minimum duration (in minutes) that will be billed for any time entry, regardless of actual duration.', `min-time-tooltip-${configId}`)}
        </div>
        <Input
          id="minimum-billable-time"
          type="number"
          value={config.minimum_billable_time?.toString() ?? ''} // Bind directly to prop
          onChange={handleMinutesInputChange('minimum_billable_time')} // Use generic handler
          placeholder="e.g., 15"
          disabled={disabled}
          min={0}
          step={1}
          className={validationErrors.minimum_billable_time ? 'border-red-500' : ''}
        />
        {validationErrors.minimum_billable_time && (
          <p className="text-sm text-red-500 mt-1">{validationErrors.minimum_billable_time}</p>
        )}
      </div>

      {/* Round Up To Nearest */}
      <div>
        <div className="flex items-center">
          <Label htmlFor="round-up-to-nearest">Round Up To Nearest (minutes)</Label>
          {renderTooltip('Time entries will be rounded up to the nearest specified minute interval (e.g., 15 minutes). Set to 1 or 0 to disable rounding.', `round-up-tooltip-${configId}`)}
        </div>
        <Input
          id="round-up-to-nearest"
          type="number"
          value={config.round_up_to_nearest?.toString() ?? ''} // Bind directly to prop
          onChange={handleMinutesInputChange('round_up_to_nearest')} // Use generic handler
          placeholder="e.g., 15"
          disabled={disabled}
          min={0} // Allow 0 or 1 for no rounding
          step={1}
          className={validationErrors.round_up_to_nearest ? 'border-red-500' : ''}
        />
        {validationErrors.round_up_to_nearest && (
          <p className="text-sm text-red-500 mt-1">{validationErrors.round_up_to_nearest}</p>
        )}
      </div>

      {/* User Type Specific Rates Section (Moved Here) */}
      <div className="space-y-4 pt-4 border-t">
           <Label className="font-medium text-base flex items-center">
               User Type Specific Rates
               {renderTooltip('Define different hourly rates for specific user types working on this service. These override the service\'s default hourly rate.', `user-type-rate-tooltip-${configId}`)}
           </Label>

           {/* List existing rates */}
           {userTypeRates.length > 0 && (
               <div className="space-y-2">
               {userTypeRates.map((item, index) => (
                   <div key={item.rate_id || `new-${index}`} className="flex items-center justify-between gap-2 p-2 border rounded bg-background">
                       <span className="font-medium">
                           {userTypeOptions.find(opt => opt.value === item.user_type)?.label || item.user_type}: {getCurrencySymbol('USD')}{Number(item.rate / 100).toFixed(2)}/hr
                       </span>
                       <Button id={`remove-user-type-rate-${configId}-${index}`} variant="ghost" size="sm" onClick={() => handleRemoveUserTypeRate(index)} disabled={disabled}>
                           <Trash2 className="h-4 w-4 text-destructive" />
                       </Button>
                   </div>
               ))}
               </div>
           )}

           {/* Add new rate form */}
           <div className="space-y-2 pt-2">
               <Label className="text-sm font-medium">Add New Rate</Label>
               <div className="space-y-2"> {/* Removed flex classes, added space-y */}
                   <div> {/* Removed flex-1 and min-w */}
                       <Label htmlFor={`new-user-type-${configId}`} className="sr-only">User Type</Label>
                       <CustomSelect
                           id={`new-user-type-${configId}`}
                           options={userTypeOptions}
                           onValueChange={setNewUserType}
                           value={newUserType}
                           placeholder="Select type"
                           disabled={disabled}
                           className="mt-1"
                       />
                   </div>
                   <div className="mt-2"> {/* Removed flex-1 and min-w, added margin */}
                       <Label htmlFor={`new-user-type-rate-${configId}`} className="sr-only">Rate ($/hr)</Label>
                       <div className="relative">
                         <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                         <Input
                             id={`new-user-type-rate-${configId}`}
                             type="text"
                             inputMode="decimal"
                             value={newUserTypeRateInput}
                             onChange={handleNewRateInputChange}
                             onBlur={handleNewRateInputBlur}
                             placeholder="0.00"
                             disabled={disabled}
                             className={`pl-10 mt-1 ${userTypeError ? 'border-red-500' : ''}`}
                         />
                       </div>
                   </div>
                   <Button
                       id={`add-user-type-rate-button-${configId}`}
                       type="button"
                       onClick={handleAddUserTypeRate}
                       disabled={disabled || !newUserType || newUserTypeRateValue === undefined || (newUserTypeRateValue < 0) || !!userTypeError} // Check < 0 only if defined
                       className="mt-2 w-full" // Added margin and full width
                   >
                       Add
                   </Button>
               </div>
                {userTypeError && <p className="text-sm text-red-500 mt-1">{userTypeError}</p>}
           </div>
      </div>

    </div>
  );
}
