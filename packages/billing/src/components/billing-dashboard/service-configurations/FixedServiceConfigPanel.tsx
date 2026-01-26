'use client'

import React, { useState, useEffect } from 'react';
import { Card } from '@alga-psa/ui/components/Card';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { IContractLineServiceFixedConfig } from '@alga-psa/types';
import { IContractLineFixedConfig } from '@alga-psa/types';

interface FixedServiceConfigPanelProps {
  configuration: Partial<IContractLineServiceFixedConfig>;
  planFixedConfig: Partial<IContractLineFixedConfig>;
  onConfigurationChange: (updates: Partial<IContractLineServiceFixedConfig>) => void;
  onPlanFixedConfigChange: (updates: Partial<IContractLineFixedConfig>) => void;
  className?: string;
  disabled?: boolean;
}

export function FixedServiceConfigPanel({
  configuration,
  planFixedConfig,
  onConfigurationChange,
  onPlanFixedConfigChange,
  className = '',
  disabled = false
}: FixedServiceConfigPanelProps) {
  const [enableProration, setEnableProration] = useState(planFixedConfig.enable_proration || false);
  const [billingCycleAlignment, setBillingCycleAlignment] = useState<string>(
    planFixedConfig.billing_cycle_alignment || 'start'
  );

  // Update local state when props change
  useEffect(() => {
    setEnableProration(planFixedConfig.enable_proration || false);
    setBillingCycleAlignment(planFixedConfig.billing_cycle_alignment || 'start');
  }, [planFixedConfig]);

  const handleEnableProrateChange = (checked: boolean) => {
    setEnableProration(checked);
    onPlanFixedConfigChange({ enable_proration: checked });
  };

  const handleBillingCycleAlignmentChange = (value: string) => {
    setBillingCycleAlignment(value);
    onPlanFixedConfigChange({ billing_cycle_alignment: value as 'start' | 'end' | 'prorated' });
  };

  const alignmentOptions = [
    { value: 'start', label: 'Start of Billing Cycle' },
    { value: 'end', label: 'End of Billing Cycle' },
    { value: 'prorated', label: 'Prorated' }
  ];

  return (
    <Card className={`p-4 ${className}`}>
      <div className="space-y-4">
        <h3 className="text-md font-medium">Fixed Price Configuration</h3>
        
        <div className="flex items-center space-x-2 pt-2">
          <Switch
            id="fixed-service-enable-proration"
            checked={enableProration}
            onCheckedChange={handleEnableProrateChange}
            disabled={disabled}
          />
          <Label htmlFor="fixed-service-enable-proration" className="cursor-pointer">
            Enable Proration
          </Label>
        </div>
        
        {enableProration && (
          <div className="pl-6 border-l-2 border-gray-200">
            <Label htmlFor="fixed-service-billing-cycle-alignment">Billing Cycle Alignment</Label>
            <CustomSelect
              id="fixed-service-billing-cycle-alignment"
              options={alignmentOptions}
              onValueChange={handleBillingCycleAlignmentChange}
              value={billingCycleAlignment}
              placeholder="Select alignment"
              className="w-full"
              disabled={disabled}
            />
            <p className="text-sm text-gray-500 mt-1">
              Determines how partial periods are calculated
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
