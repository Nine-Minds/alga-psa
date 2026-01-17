import React, { useEffect, useRef } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import * as RadixSelect from '@radix-ui/react-select';
import { Input } from '@alga-psa/ui/components/Input';

export interface TicketOption {
  value: string;
  label: string;
  status?: string;
}

interface TicketSelectProps {
  options: TicketOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}

const TicketSelect: React.FC<TicketSelectProps> = ({
  options,
  value,
  onValueChange,
  placeholder = 'Select a ticket...',
  className = '',
  disabled = false,
  label,
  searchValue = '',
  onSearchChange,
}): React.JSX.Element => {
  const selectedOption = options.find(option => option.value === value);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus search input when dropdown opens
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={label ? 'mb-4' : ''}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <RadixSelect.Root 
        value={value} 
        onValueChange={onValueChange} 
        disabled={disabled}
      >
        <RadixSelect.Trigger
          className={`
            inline-flex items-center justify-between
            border border-gray-200 rounded-lg p-2
            bg-white cursor-pointer min-h-[38px]
            hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent
            text-sm w-full
            disabled:opacity-50 disabled:cursor-not-allowed
            ${className}
          `}
          aria-label={placeholder}
        >
          <RadixSelect.Value 
            placeholder={placeholder}
            className="flex-1 text-left"
          >
            {selectedOption?.label}
          </RadixSelect.Value>
          <RadixSelect.Icon>
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className="overflow-hidden bg-white rounded-lg shadow-lg border border-gray-200 mt-1 z-[9999] w-[var(--radix-select-trigger-width)]"
            position="popper"
            sideOffset={4}
            align="start"
          >
            {onSearchChange && (
              <div className="sticky top-0 bg-white border-b border-gray-200 p-2 z-10">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
                  <Input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search tickets..."
                    className="pl-9 w-full"
                    value={searchValue}
                    onChange={(e) => onSearchChange(e.target.value)}
                  />
                </div>
              </div>
            )}
            <RadixSelect.Viewport className="max-h-[300px] overflow-auto p-1">
              {options.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">
                  No tickets found
                </div>
              ) : (
                options.map((option): React.JSX.Element => (
                  <RadixSelect.Item
                    key={option.value}
                    value={option.value}
                    className={`
                      relative flex items-center px-3 py-2 text-sm rounded text-gray-900
                      cursor-pointer bg-white hover:bg-gray-50 focus:bg-gray-50
                      focus:outline-none select-none
                      data-[highlighted]:bg-gray-50
                    `}
                  >
                    <div className="flex flex-col">
                      <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                      {option.status && (
                        <span className="text-xs text-gray-500 mt-0.5">
                          {option.status}
                        </span>
                      )}
                    </div>
                  </RadixSelect.Item>
                ))
              )}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
};

export default TicketSelect;
