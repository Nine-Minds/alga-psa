'use client';

import React, { useMemo } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Repeat } from 'lucide-react';
import { BILLING_FREQUENCY_OPTIONS, BILLING_FREQUENCY_DISPLAY } from '@alga-psa/billing/constants/billing';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';

interface BillingFrequencyOverrideSelectProps {
  contractBillingFrequency: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  label: string;
  description?: string;
}

export function BillingFrequencyOverrideSelect({
  contractBillingFrequency,
  value,
  onChange,
  label,
  description,
}: BillingFrequencyOverrideSelectProps) {
  const contractFrequencyLabel = BILLING_FREQUENCY_DISPLAY[contractBillingFrequency] || contractBillingFrequency;

  const options: SelectOption[] = useMemo(() => {
    return BILLING_FREQUENCY_OPTIONS.map((option) => {
      const isContractFrequency = option.value === contractBillingFrequency;
      return {
        value: option.value,
        label: isContractFrequency
          ? `${option.label} (already set for contract)`
          : option.label,
        className: isContractFrequency
          ? 'opacity-50 cursor-not-allowed'
          : '',
      };
    });
  }, [contractBillingFrequency]);

  const handleValueChange = (newValue: string) => {
    // Prevent selecting the contract's billing frequency
    if (newValue === contractBillingFrequency) {
      return;
    }
    // Empty string means clear the override
    onChange(newValue || undefined);
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="billing-frequency-override" className="flex items-center gap-2 text-sm">
        <Repeat className="h-4 w-4" />
        {label}
      </Label>
      <p className="text-xs text-gray-500">
        {description || `Optional: Override the contract's billing frequency (${contractFrequencyLabel}) for this specific contract line.`}
      </p>

      <div className="space-y-2">
        <CustomSelect
          id="billing-frequency-override"
          options={options}
          value={value || ''}
          onValueChange={handleValueChange}
          placeholder={`Use contract billing frequency (${contractFrequencyLabel})`}
          allowClear
        />

        {value && value !== contractBillingFrequency && (
          <p className="text-xs text-gray-600">
            This contract line will be billed {BILLING_FREQUENCY_DISPLAY[value]?.toLowerCase()} instead of {contractFrequencyLabel.toLowerCase()}.
          </p>
        )}
      </div>
    </div>
  );
}
