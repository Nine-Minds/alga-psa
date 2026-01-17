'use client'

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Card } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { IContractLineServiceBucketConfig } from 'server/src/interfaces/contractLineServiceConfiguration.interfaces';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';

interface BucketServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceBucketConfig>;
  onConfigurationChange: (updates: Partial<IContractLineServiceBucketConfig>) => void;
  className?: string;
  disabled?: boolean;
  contractLineBillingFrequency?: string;
}

export function BucketServiceConfigPanel({
  configuration,
  onConfigurationChange,
  className = '',
  disabled = false,
  contractLineBillingFrequency
}: BucketServiceConfigPanelProps) {
  const [totalMinutes, setTotalMinutes] = useState<number>(configuration.total_minutes || 0);
  const [billingPeriod, setBillingPeriod] = useState<string>(configuration.billing_period || 'monthly');
  const [overageRate, setOverageRate] = useState<number>(configuration.overage_rate || 0);
  const [allowRollover, setAllowRollover] = useState<boolean>(configuration.allow_rollover || false);
  const [validationErrors, setValidationErrors] = useState<{
    totalMinutes?: string;
    overageRate?: string;
  }>({});

  // Update local state when props change
  useEffect(() => {
    setTotalMinutes(configuration.total_minutes || 0);
    setBillingPeriod(configuration.billing_period || 'monthly');
    setOverageRate(configuration.overage_rate || 0);
    setAllowRollover(configuration.allow_rollover || false);
  }, [configuration]);

  // Validate inputs when they change
  useEffect(() => {
    const errors: {
      totalMinutes?: string;
      overageRate?: string;
    } = {};

    if (totalMinutes <= 0) {
      errors.totalMinutes = 'Total minutes must be greater than zero';
    }

    if (overageRate < 0) {
      errors.overageRate = 'Overage rate cannot be negative';
    }

    setValidationErrors(errors);
  }, [totalMinutes, overageRate]);

  const handleTotalMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setTotalMinutes(value);
    onConfigurationChange({ total_minutes: value });
  };

  const handleBillingPeriodChange = (value: string) => {
    setBillingPeriod(value);
    onConfigurationChange({ billing_period: value });
  };

  const handleOverageRateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.round(Number(e.target.value) * 100); // Store in cents
    setOverageRate(value);
    onConfigurationChange({ overage_rate: value });
  };

  const handleAllowRolloverChange = (checked: boolean) => {
    setAllowRollover(checked);
    onConfigurationChange({ allow_rollover: checked });
  };

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">Bucket Hours Configuration</h3>
        
        <div className="grid gap-4">
          <div>
            <Label htmlFor="bucket-total-minutes">Total Minutes</Label>
            <Input
              id="bucket-total-minutes"
              type="number"
              value={totalMinutes.toString()}
              onChange={handleTotalMinutesChange}
              placeholder="Enter total hours"
              disabled={disabled}
              min={1}
              step={1}
              className={validationErrors.totalMinutes ? 'border-red-500' : ''}
            />
            {validationErrors.totalMinutes ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.totalMinutes}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The total number of minutes included in this bucket contract line
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="bucket-billing-period">Billing Period</Label>
            <CustomSelect
              id="bucket-billing-period"
              options={BILLING_FREQUENCY_OPTIONS}
              onValueChange={handleBillingPeriodChange}
              value={billingPeriod}
              placeholder="Select billing period"
              className="w-full"
              disabled={disabled}
            />
            {contractLineBillingFrequency && billingPeriod !== contractLineBillingFrequency ? (
              <p className="text-sm text-amber-600 mt-1 flex items-center gap-1">
                <span className="font-semibold">⚠️ Mismatch:</span> Bucket billing period ({billingPeriod}) should match contract line billing frequency ({contractLineBillingFrequency})
              </p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The period over which the bucket hours are allocated
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="bucket-overage-rate">Overage Rate</Label>
            <Input
              id="bucket-overage-rate"
              type="number"
              value={(overageRate / 100).toString()} // Display in dollars
              onChange={handleOverageRateChange}
              placeholder="Enter overage rate"
              disabled={disabled}
              min={0}
              step={0.01}
              className={validationErrors.overageRate ? 'border-red-500' : ''}
            />
            {validationErrors.overageRate ? (
              <p className="text-sm text-red-500 mt-1">{validationErrors.overageRate}</p>
            ) : (
              <p className="text-sm text-gray-500 mt-1">
                The hourly rate charged for hours used beyond the bucket limit
              </p>
            )}
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id="bucket-allow-rollover"
              checked={allowRollover}
              onCheckedChange={handleAllowRolloverChange}
              disabled={disabled}
            />
            <Label htmlFor="bucket-allow-rollover" className="cursor-pointer">
              Allow unused hours to roll over to next period
            </Label>
          </div>
        </div>
      </div>
    </Card>
  );
}
