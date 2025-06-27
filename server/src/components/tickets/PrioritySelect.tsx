'use client';

import React from 'react';
import CustomSelect, { SelectOption } from '@/components/ui/CustomSelect';

interface PriorityOption extends SelectOption {
  color?: string;
}

interface PrioritySelectProps {
  value: string | null;
  options: PriorityOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  customStyles?: any;
  id?: string;
}

export const PrioritySelect: React.FC<PrioritySelectProps> = ({
  value,
  options,
  onValueChange,
  placeholder = 'Select Priority',
  className,
  customStyles,
  id
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
    />
  );
};