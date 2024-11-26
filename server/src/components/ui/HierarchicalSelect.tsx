import React from 'react';
import * as Select from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';

interface Option {
  value: string;
  label: React.ReactNode;
  isHeader?: boolean;
}

interface HierarchicalSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  className?: string;
  renderSelectedValue?: (value: string, options: Option[]) => string;
}

const HierarchicalSelect = ({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  className = '',
  renderSelectedValue
}: HierarchicalSelectProps) => {
  const handleSelect = (newValue: string) => {
    // Only call onValueChange for non-header items
    if (!newValue.startsWith('project_header_') && !newValue.startsWith('phase_header_')) {
      onValueChange(newValue);
    }
  };

  return (
    <Select.Root value={value} onValueChange={handleSelect}>
      <Select.Trigger className={`flex items-center justify-between w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${className}`}>
        <Select.Value>
          {renderSelectedValue ? renderSelectedValue(value, options) : (
            options.find(opt => opt.value === value)?.label || placeholder
          )}
        </Select.Value>
        <Select.Icon>
          <ChevronDown className="h-4 w-4" />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content 
          className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden min-w-[200px] z-50"
          position="popper"
          sideOffset={5}
        >
          <Select.Viewport className="p-1">
            {options.map((option, index) => (
              <Select.Item
                key={index}
                value={option.value}
                disabled={option.isHeader}
                className={`relative flex items-center px-2 py-2 text-sm rounded-sm cursor-pointer focus:outline-none ${
                  option.isHeader ? 'cursor-default' : 'hover:bg-gray-100 focus:bg-gray-100'
                }`}
              >
                <Select.ItemText>
                  {option.label}
                </Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

export default HierarchicalSelect;
