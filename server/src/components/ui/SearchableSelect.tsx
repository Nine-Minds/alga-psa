'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from 'server/src/lib/utils';
import { Button } from 'server/src/components/ui/Button';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the select is required */
  required?: boolean;
  /** Empty message to display when no options match the search */
  emptyMessage?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className = '',
  disabled = false,
  label,
  id,
  required = false,
  emptyMessage = 'No results found',
}: SearchableSelectProps & AutomationProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Memoize the mapped options to prevent recreating on every render
  const mappedOptions = useMemo(() => options.map((opt: SelectOption): { value: string; label: string } => ({
    value: opt.value,
    label: typeof opt.label === 'string' ? opt.label : 'Complex Label'
  })), [options]);

  const { automationIdProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id: id,
    label,
    value: value || '',
    disabled,
    required,
    options: mappedOptions
  });

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: value || '',
        label,
        disabled,
        required,
        options: mappedOptions
      });
    }
  }, [value, disabled, label, required, mappedOptions, updateMetadata]);

  // Filter options based on search
  const filteredOptions = useMemo(() => {
    if (!search) return options;
    
    const searchLower = search.toLowerCase();
    return options.filter((option: SelectOption) => 
      option.label.toString().toLowerCase().includes(searchLower)
    );
  }, [options, search]);

  // Find the selected option label
  const selectedOption = options.find((option: SelectOption) => option.value === value);

  return (
    <div className={label ? 'mb-4' : ''} id={id} data-automation-type="searchable-select">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      
      <div className="relative">
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
          onClick={() => !disabled && setOpen(!open)}
          disabled={disabled}
          {...automationIdProps}
        >
          <span className="truncate">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
        
        {open && !disabled && (
          <div className="absolute z-50 w-full mt-1">
            <Command
              className="rounded-md border border-gray-200 bg-white shadow-md overflow-hidden"
              shouldFilter={false}
            >
              <div className="flex items-center border-b px-3 py-2">
                <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  className="flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-gray-500"
                  placeholder={`Search ${placeholder.toLowerCase()}...`}
                />
              </div>
              <Command.List className="max-h-60 overflow-y-auto p-1">
                {filteredOptions.length > 0 ? (
                  filteredOptions.map((option: SelectOption) => (
                    <Command.Item
                      key={option.value}
                      value={option.value}
                      onSelect={() => {
                        onChange(option.value);
                        setOpen(false);
                        setSearch('');
                      }}
                      className={cn(
                        "flex items-center px-2 py-1.5 text-sm rounded-sm cursor-pointer",
                        "hover:bg-gray-100",
                        "aria-selected:bg-gray-100",
                        value === option.value && "bg-gray-100"
                      )}
                    >
                      <span className="flex-1">{option.label}</span>
                      {value === option.value && (
                        <Check className="w-4 h-4 text-primary-600" />
                      )}
                    </Command.Item>
                  ))
                ) : (
                  <div className="py-6 text-center text-sm text-gray-500">
                    {emptyMessage}
                  </div>
                )}
              </Command.List>
            </Command>
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchableSelect;