'use client'

import React, { useState } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { PLAN_TYPE_OPTIONS } from 'server/src/constants/billing';
// Removed Card import as we'll use divs for custom styling
import { Clock, Package, Shapes } from 'lucide-react'; // Import original icons

export type PlanType = 'Fixed' | 'Hourly' | 'Usage';

interface PlanTypeSelectorProps {
  value: PlanType;
  onChange: (value: PlanType) => void;
  className?: string;
  disabled?: boolean;
  showDescriptions?: boolean;
  showCards?: boolean;
}

const PLAN_TYPE_DESCRIPTIONS: Record<PlanType, string> = {
  'Fixed': 'A fixed-price contract line with consistent billing regardless of usage. Ideal for predictable services.',
  'Hourly': 'Time-based billing with configurable rates. Best for variable workloads billed by time spent.',
  'Usage': 'Usage-based billing with tiered pricing options. Perfect for services measured by consumption.'
};

// Define icons as components for easier styling control, using the original set
const PLAN_TYPE_ICONS: Record<PlanType, React.ElementType> = {
  'Fixed': Package, // Originally proposed Package for Fixed
  'Hourly': Clock,  // Kept Clock for Hourly
  'Usage': Shapes  // Originally proposed Shapes for Per Unit/Usage concept
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
    return ['Fixed', 'Hourly', 'Usage'].includes(value);
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
        <label className="block mb-2 text-sm font-medium text-gray-700">Contract Line Type</label>
        <div className="grid grid-cols-2 gap-4 mt-2"> {/* Use gap-4 like the original proposal */}
          {(Object.keys(PLAN_TYPE_DESCRIPTIONS) as PlanType[]).map((planType) => {
            const IconComponent = PLAN_TYPE_ICONS[planType];
            const isSelected = value === planType;
            const planLabel = PLAN_TYPE_OPTIONS.find(opt => opt.value === planType)?.label || planType;

            const isCardDisabled = disabled || planType !== 'Fixed'; // Check if this specific card should be disabled

            return (
              <div
                key={planType}
                id={`plan-type-card-${planType.toLowerCase()}`} // Add ID for consistency
                className={`
                  border rounded-lg p-4 transition-all duration-150 ease-in-out
                  flex flex-col items-center text-center space-y-2  /* Centered layout */
                  ${isSelected
                    ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200' // Preferred selected style
                    : 'border-border-300'
                  }
                  ${isCardDisabled
                    ? 'opacity-50 cursor-not-allowed bg-gray-100' // Disabled style
                    : 'cursor-pointer hover:border-primary-300 hover:bg-gray-50' // Enabled style
                  }
                `}
                onClick={() => !isCardDisabled && onChange(planType)} // Use isCardDisabled
                role="radio"
                aria-checked={isSelected}
                aria-disabled={isCardDisabled} // Set aria-disabled based on the card's state
                tabIndex={isCardDisabled ? -1 : 0} // Make focusable only if not disabled
                onKeyDown={(e) => { if (!isCardDisabled && (e.key === 'Enter' || e.key === ' ')) onChange(planType); }} // Use isCardDisabled
              >
                <IconComponent className={`h-8 w-8 mb-1 ${isSelected ? 'text-primary-600' : 'text-gray-500'}`} /> {/* Larger icon, dynamic color */}
                <span className={`font-medium ${isSelected ? 'text-primary-700' : 'text-gray-800'}`}>
                  {planLabel}
                </span>
                {/* Keep description if showDescriptions is true */}
                {showDescriptions && (
                   <p className="text-xs text-gray-500">{PLAN_TYPE_DESCRIPTIONS[planType]}</p>
                )}
                {/* Removed CheckCircle as selection is indicated by border/bg */}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Otherwise, render the dropdown selector
  return (
    <div className={className}>
      <label className="block mb-2 text-sm font-medium text-gray-700">Contract Line Type</label>
      <CustomSelect
        id="plan-type-selector"
        options={PLAN_TYPE_OPTIONS.map(option => ({
          ...option,
          description: showDescriptions ? PLAN_TYPE_DESCRIPTIONS[option.value as PlanType] : undefined,
          icon: PLAN_TYPE_ICONS[option.value as PlanType],
          disabled: option.value !== 'Fixed' // Add disabled property for non-Fixed options
        }))}
        onValueChange={handlePlanTypeChange}
        value={value}
        placeholder="Select contract line type"
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
