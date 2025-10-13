'use client'

import React, { useState } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { CONTRACT_LINE_TYPE_OPTIONS } from 'server/src/constants/billing';
// Removed Card import as we'll use divs for custom styling
import { Clock, Package, Shapes, Layers } from 'lucide-react'; // Import original icons: Shapes, Layers. Remove DollarSign, BarChart3, CheckCircle if unused.

export type ContractLineType = 'Fixed' | 'Bucket' | 'Hourly' | 'Usage';

interface ContractLineTypeSelectorProps {
  value: ContractLineType;
  onChange: (value: ContractLineType) => void;
  className?: string;
  disabled?: boolean;
  showDescriptions?: boolean;
  showCards?: boolean;
}

const CONTRACT_LINE_TYPE_DESCRIPTIONS: Record<ContractLineType, string> = {
  'Fixed': 'A fixed-price contract line with consistent billing regardless of usage. Ideal for predictable services.',
  'Bucket': 'Pre-purchased hours that can be used over time. Good for clients who need flexibility with a budget cap.',
  'Hourly': 'Time-based billing with configurable rates. Best for variable workloads billed by time spent.',
  'Usage': 'Usage-based billing with tiered pricing options. Perfect for services measured by consumption.'
};

// Define icons as components for easier styling control, using the original set
const CONTRACT_LINE_TYPE_ICONS: Record<ContractLineType, React.ElementType> = {
  'Fixed': Package, // Originally proposed Package for Fixed
  'Bucket': Layers, // Originally proposed Layers for Tiered/Bucket concept
  'Hourly': Clock,  // Kept Clock for Hourly
  'Usage': Shapes  // Originally proposed Shapes for Per Unit/Usage concept
};

export function ContractLineTypeSelector({
  value,
  onChange,
  className = '',
  disabled = false,
  showDescriptions = false,
  showCards = false
}: ContractLineTypeSelectorProps) {
  const isContractLineType = (value: string): value is ContractLineType => {
    return ['Fixed', 'Bucket', 'Hourly', 'Usage'].includes(value);
  };

  const handleContractLineTypeChange = (value: string) => {
    if (isContractLineType(value)) {
      onChange(value);
    }
  };

  // If using cards, render the card-based selector
  if (showCards) {
    return (
      <div className={className}>
        <label className="block mb-2 text-sm font-medium text-gray-700">Contract Line Type</label>
        <div className="grid grid-cols-2 gap-4 mt-2"> {/* Use gap-4 like the original proposal */}
          {(Object.keys(CONTRACT_LINE_TYPE_DESCRIPTIONS) as ContractLineType[]).map((contractLineType) => {
            const IconComponent = CONTRACT_LINE_TYPE_ICONS[contractLineType];
            const isSelected = value === contractLineType;
            const contractLineLabel = CONTRACT_LINE_TYPE_OPTIONS.find(opt => opt.value === contractLineType)?.label || contractLineType;

            const isCardDisabled = disabled || contractLineType !== 'Fixed'; // Check if this specific card should be disabled

            return (
              <div
                key={contractLineType}
                id={`contract-line-type-card-${contractLineType.toLowerCase()}`} // Add ID for consistency
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
                onClick={() => !isCardDisabled && onChange(contractLineType)} // Use isCardDisabled
                role="radio"
                aria-checked={isSelected}
                aria-disabled={isCardDisabled} // Set aria-disabled based on the card's state
                tabIndex={isCardDisabled ? -1 : 0} // Make focusable only if not disabled
                onKeyDown={(e) => { if (!isCardDisabled && (e.key === 'Enter' || e.key === ' ')) onChange(contractLineType); }} // Use isCardDisabled
              >
                <IconComponent className={`h-8 w-8 mb-1 ${isSelected ? 'text-primary-600' : 'text-gray-500'}`} /> {/* Larger icon, dynamic color */}
                <span className={`font-medium ${isSelected ? 'text-primary-700' : 'text-gray-800'}`}>
                  {contractLineLabel}
                </span>
                {/* Keep description if showDescriptions is true */}
                {showDescriptions && (
                   <p className="text-xs text-gray-500">{CONTRACT_LINE_TYPE_DESCRIPTIONS[contractLineType]}</p>
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
        id="contract-line-type-selector"
        options={CONTRACT_LINE_TYPE_OPTIONS.map(option => ({
          ...option,
          description: showDescriptions ? CONTRACT_LINE_TYPE_DESCRIPTIONS[option.value as ContractLineType] : undefined,
          icon: CONTRACT_LINE_TYPE_ICONS[option.value as ContractLineType],
          disabled: option.value !== 'Fixed' // Add disabled property for non-Fixed options
        }))}
        onValueChange={handleContractLineTypeChange}
        value={value}
        placeholder="Select contract line type"
        className="w-full"
        disabled={disabled}
      />
      {showDescriptions && value && (
        <p className="text-sm text-gray-500 mt-2">
          {CONTRACT_LINE_TYPE_DESCRIPTIONS[value]}
        </p>
      )}
    </div>
  );
}