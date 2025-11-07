'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Label } from 'server/src/components/ui/Label';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Info, DollarSign } from 'lucide-react';
import { BucketOverlayInput } from './ContractWizard';

type BucketOverlayMode = 'hours' | 'usage';

interface BucketOverlayFieldsProps {
  mode: BucketOverlayMode;
  value: BucketOverlayInput;
  onChange: (next: BucketOverlayInput) => void;
  unitLabel?: string;
  disabled?: boolean;
  automationId?: string;
  billingFrequency?: string;
}

export function BucketOverlayFields({
  mode,
  value,
  onChange,
  unitLabel,
  disabled = false,
  automationId,
  billingFrequency = 'monthly'
}: BucketOverlayFieldsProps) {
  const [overageRateInput, setOverageRateInput] = useState<string>('');

  useEffect(() => {
    // Initialize overage rate input from value
    if (value.overage_rate !== undefined) {
      setOverageRateInput((value.overage_rate / 100).toFixed(2));
    } else {
      setOverageRateInput('');
    }
  }, [value.overage_rate]);
  const resolvedUnitLabel =
    mode === 'hours'
      ? 'hours'
      : unitLabel && unitLabel.trim().length > 0
        ? unitLabel
        : 'units';

  const includedDisplay =
    value.total_minutes == null
      ? ''
      : mode === 'hours'
        ? (value.total_minutes / 60).toString()
        : value.total_minutes.toString();

  const handleIncludedChange = (raw: string) => {
    if (!raw.trim()) {
      onChange({
        ...value,
        total_minutes: undefined
      });
      return;
    }

    const numeric = Number.parseFloat(raw);
    if (Number.isNaN(numeric) || numeric < 0) {
      return;
    }

    const totalMinutes =
      mode === 'hours'
        ? Math.round(numeric * 60)
        : Math.round(numeric);

    onChange({
      ...value,
      total_minutes: totalMinutes,
      billing_period: value.billing_period ?? (billingFrequency as 'monthly' | 'weekly')
    });
  };

  const handleOverageChange = (cents: number) => {
    onChange({
      ...value,
      overage_rate: cents,
      billing_period: value.billing_period ?? (billingFrequency as 'monthly' | 'weekly')
    });
  };

  const handleRolloverChange = (checked: boolean) => {
    onChange({
      ...value,
      allow_rollover: checked,
      billing_period: value.billing_period ?? (billingFrequency as 'monthly' | 'weekly')
    });
  };

  return (
    <div className="mt-4 space-y-4 rounded-md border border-blue-100 bg-blue-50 p-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="font-medium">
            Included {resolvedUnitLabel}
          </Label>
          <Tooltip content={`Amount of ${resolvedUnitLabel} included each billing period before overages apply.`}>
            <Info className="h-4 w-4 text-blue-500" />
          </Tooltip>
        </div>
        <Input
          id={automationId ? `${automationId}-included` : undefined}
          data-automation-id={automationId ? `${automationId}-included` : undefined}
          type="number"
          min={0}
          step={mode === 'hours' ? 0.25 : 1}
          value={includedDisplay}
          placeholder={mode === 'hours' ? 'e.g., 40' : 'e.g., 1000'}
          onChange={(event) => handleIncludedChange(event.target.value)}
          disabled={disabled}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="font-medium flex items-center gap-1">
            <DollarSign className="h-4 w-4 text-blue-500" />
            Overage Rate
            <span className="text-xs text-muted-foreground">
              / {mode === 'hours' ? 'hour' : resolvedUnitLabel}
            </span>
          </Label>
          <Tooltip content={`Charge applied for each ${mode === 'hours' ? 'hour' : resolvedUnitLabel} beyond the included amount.`}>
            <Info className="h-4 w-4 text-blue-500" />
          </Tooltip>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
          <Input
            id={automationId ? `${automationId}-overage` : undefined}
            data-automation-id={automationId ? `${automationId}-overage` : undefined}
            type="text"
            inputMode="decimal"
            value={overageRateInput}
            onChange={(e) => {
              const value = e.target.value.replace(/[^0-9.]/g, '');
              // Allow only one decimal point
              const decimalCount = (value.match(/\./g) || []).length;
              if (decimalCount <= 1) {
                setOverageRateInput(value);
              }
            }}
            onBlur={() => {
              if (overageRateInput.trim() === '' || overageRateInput === '.') {
                setOverageRateInput('');
                handleOverageChange(0);
              } else {
                const dollars = parseFloat(overageRateInput) || 0;
                const cents = Math.round(dollars * 100);
                handleOverageChange(cents);
                setOverageRateInput((cents / 100).toFixed(2));
              }
            }}
            placeholder="0.00"
            className="pl-7"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="flex items-start gap-2 pt-1">
        <Checkbox
          id={automationId ? `${automationId}-rollover` : 'allow-rollover'}
          checked={value.allow_rollover ?? false}
          onChange={(event) => handleRolloverChange(event.currentTarget.checked)}
          disabled={disabled}
        />
        <div className="flex flex-col">
          <Label htmlFor={automationId ? `${automationId}-rollover` : 'allow-rollover'} className="font-medium">
            Allow unused {resolvedUnitLabel} to roll over
          </Label>
          <p className="text-xs text-muted-foreground">
            If enabled, any unused balance carries into the next period.
          </p>
        </div>
      </div>
    </div>
  );
}
