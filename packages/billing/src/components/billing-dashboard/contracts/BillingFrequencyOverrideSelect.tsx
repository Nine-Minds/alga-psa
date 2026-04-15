'use client';

import React, { useMemo } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Repeat } from 'lucide-react';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useBillingFrequencyOptions, useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface BillingFrequencyOverrideSelectProps {
  contractBillingFrequency: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  label?: string;
  description?: string;
}

export function BillingFrequencyOverrideSelect({
  contractBillingFrequency,
  value,
  onChange,
  label,
  description,
}: BillingFrequencyOverrideSelectProps) {
  const { t } = useTranslation('msp/contracts');
  const billingFrequencyOptions = useBillingFrequencyOptions();
  const formatBillingFrequency = useFormatBillingFrequency();
  const contractFrequencyLabel = formatBillingFrequency(contractBillingFrequency);
  const resolvedLabel = label || t('frequencyOverride.label', { defaultValue: 'Billing Frequency Override' });

  const options: SelectOption[] = useMemo(() => {
    return billingFrequencyOptions.map((option) => {
      const isContractFrequency = option.value === contractBillingFrequency;
      return {
        value: option.value,
        label: isContractFrequency
          ? t('frequencyOverride.optionAlreadySetForContract', {
            defaultValue: '{{label}} (already set for contract)',
            label: option.label,
          })
          : option.label,
        className: isContractFrequency
          ? 'opacity-50 cursor-not-allowed'
          : '',
      };
    });
  }, [billingFrequencyOptions, contractBillingFrequency, t]);

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
        {resolvedLabel}
      </Label>
      <p className="text-xs text-muted-foreground">
        {description || t('frequencyOverride.description', {
          defaultValue: 'Optional: Override the contract\'s billing frequency ({{frequency}}) for this specific contract line.',
          frequency: contractFrequencyLabel,
        })}
      </p>

      <div className="space-y-2">
        <CustomSelect
          id="billing-frequency-override"
          options={options}
          value={value || ''}
          onValueChange={handleValueChange}
          placeholder={t('frequencyOverride.placeholder', {
            defaultValue: 'Use contract billing frequency ({{frequency}})',
            frequency: contractFrequencyLabel,
          })}
          allowClear
        />

        {value && value !== contractBillingFrequency && (
          <p className="text-xs text-muted-foreground">
            {t('frequencyOverride.confirmation', {
              defaultValue: 'This contract line will be billed {{lineFrequency}} instead of {{contractFrequency}}.',
              lineFrequency: formatBillingFrequency(value),
              contractFrequency: contractFrequencyLabel,
            })}
          </p>
        )}
      </div>
    </div>
  );
}
