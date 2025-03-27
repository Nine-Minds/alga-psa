'use client'

import React, { useState } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { PLAN_TYPE_OPTIONS } from 'server/src/constants/billing';
import { Card } from 'server/src/components/ui/Card';
import { CheckCircle, DollarSign, Clock, BarChart3, Package } from 'lucide-react';

export type PlanType = 'Fixed' | 'Bucket' | 'Hourly' | 'Usage';

interface PlanTypeSelectorProps {
  value: PlanType;
  onChange: (value: PlanType) => void;
  className?: string;
  disabled?: boolean;
  showDescriptions?: boolean;
  showCards?: boolean;
}

const PLAN_TYPE_DESCRIPTIONS: Record<PlanType, string> = {
  'Fixed': 'A fixed-price plan with consistent billing regardless of usage. Ideal for predictable services.',
  'Bucket': 'Pre-purchased hours that can be used over time. Good for clients who need flexibility with a budget cap.',
  'Hourly': 'Time-based billing with configurable rates. Best for variable workloads billed by time spent.',
  'Usage': 'Usage-based billing with tiered pricing options. Perfect for services measured by consumption.'
};

const PLAN_TYPE_ICONS: Record<PlanType, React.ReactNode> = {
  'Fixed': <DollarSign className="h-6 w-6 text-green-500" />,
  'Bucket': <Package className="h-6 w-6 text-blue-500" />,
  'Hourly': <Clock className="h-6 w-6 text-purple-500" />,
  'Usage': <BarChart3 className="h-6 w-6 text-orange-500" />
};

export function PlanTypeSelector({
  value,
  onChange,
  className = '',
  disabled = false,
  showDescriptions = false,
  showCards = false
}: PlanTypeSelectorProps) {
  const isPlanType = (value: string): value is PlanType => {
    return ['Fixed', 'Bucket', 'Hourly', 'Usage'].includes(value);
  };

  const handlePlanTypeChange = (value: string) => {
    if (isPlanType(value)) {
      onChange(value);
    }
  };

  // If using cards, render the card-based selector
  if (showCards) {
    return (
      <div className={className}>
        <label className="block mb-2 text-sm font-medium text-gray-700">Plan Type</label>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {(Object.keys(PLAN_TYPE_DESCRIPTIONS) as PlanType[]).map((planType) => (
            <Card
              key={planType}
              className={`p-4 cursor-pointer transition-all hover:shadow-md ${
                value === planType
                  ? 'border-2 border-blue-500 bg-blue-50'
                  : 'border border-gray-200'
              }`}
              onClick={() => !disabled && onChange(planType)}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  {PLAN_TYPE_ICONS[planType]}
                </div>
                <div className="flex-grow">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">
                      {PLAN_TYPE_OPTIONS.find(opt => opt.value === planType)?.label}
                    </h3>
                    {value === planType && (
                      <CheckCircle className="h-5 w-5 text-blue-500" />
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    {PLAN_TYPE_DESCRIPTIONS[planType]}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Otherwise, render the dropdown selector
  return (
    <div className={className}>
      <label className="block mb-2 text-sm font-medium text-gray-700">Plan Type</label>
      <CustomSelect
        id="plan-type-selector"
        options={PLAN_TYPE_OPTIONS.map(option => ({
          ...option,
          description: showDescriptions ? PLAN_TYPE_DESCRIPTIONS[option.value as PlanType] : undefined,
          icon: PLAN_TYPE_ICONS[option.value as PlanType]
        }))}
        onValueChange={handlePlanTypeChange}
        value={value}
        placeholder="Select plan type"
        className="w-full"
        disabled={disabled}
      />
      {showDescriptions && value && (
        <p className="text-sm text-gray-500 mt-2">
          {PLAN_TYPE_DESCRIPTIONS[value]}
        </p>
      )}
    </div>
  );
}