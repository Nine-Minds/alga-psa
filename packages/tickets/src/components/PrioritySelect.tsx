'use client';

import React from 'react';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';

interface PriorityOption extends SelectOption {
  color?: string;
  is_from_itil_standard?: boolean;
  itil_priority_level?: number;
}

interface PrioritySelectProps {
  value: string | null;
  options: PriorityOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  customStyles?: any;
  id?: string;
  isItilBoard?: boolean;
  disabled?: boolean;
}

export const PrioritySelect: React.FC<PrioritySelectProps> = ({
  value,
  options,
  onValueChange,
  placeholder = 'Select Priority',
  className,
  customStyles,
  id,
  isItilBoard = false,
  disabled = false
}) => {
  // Transform options to include color in the label
  const transformedOptions: SelectOption[] = options.map((option) => ({
    value: option.value,
    label: typeof option.label === 'string' ? (
      <div className="flex items-center gap-2">
        <div
          className="w-3 h-3 rounded-full border border-gray-300"
          style={{ backgroundColor: option.color || '#6B7280' }}
        />
        <span>{option.label}</span>
        {/* Show ITIL badge if this is an ITIL priority */}
        {option.is_from_itil_standard && (
          <span className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
            ITIL
          </span>
        )}
      </div>
    ) : option.label,
    className: option.className,
    is_inactive: option.is_inactive
  }));

  return (
    <CustomSelect
      id={id}
      value={value || ''}
      options={transformedOptions}
      onValueChange={onValueChange}
      placeholder={placeholder}
      className={className}
      customStyles={customStyles}
      disabled={disabled}
    />
  );
};
