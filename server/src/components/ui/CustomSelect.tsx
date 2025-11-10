import React, { useEffect, useState, useMemo, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import * as RadixSelect from '@radix-ui/react-select';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';

export interface SelectOption {
  value: string;
  label: string | JSX.Element;
  className?: string;
  is_inactive?: boolean;
}

export interface StyleProps {
  trigger?: string;
  content?: string;
  item?: string;
  itemIndicator?: string;
}

interface CustomSelectProps {
  options: SelectOption[];
  value?: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  customStyles?: StyleProps;
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the select is required */
  required?: boolean;
  /** Whether to allow clearing the selection */
  allowClear?: boolean;
}

const CustomSelect: React.FC<CustomSelectProps & AutomationProps> = ({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  className = '',
  disabled = false,
  customStyles,
  label,
  id,
  "data-automation-type": dataAutomationType = 'select',
  "data-automation-id": dataAutomationId,
  required = false,
  allowClear = false, // Added default value
  ...props
}): JSX.Element => {
  // Generate a stable ID for this select instance
  const generatedId = useId();
  const selectId = id || generatedId;
  
  // Ensure option values are unique to avoid duplicate keys in Radix lists
  const uniqueOptions = useMemo(() => {
    const seen = new Set<string>();
    return options.filter((option) => {
      if (seen.has(option.value)) {
        return false;
      }
      seen.add(option.value);
      return true;
    });
  }, [options]);

  // Register with UI reflection system if id is provided
  // Memoize the mapped options to prevent recreating on every render
  const mappedOptions = useMemo(() => uniqueOptions.map((opt): { value: string; label: string } => ({
    value: opt.value,
    label: typeof opt.label === 'string' ? opt.label : 'Complex Label'
  })), [uniqueOptions]);
  
  
  // Use provided data-automation-id or register normally
  const { automationIdProps: selectProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id,
    label,
    value: value || '',
    disabled,
    required,
    options: mappedOptions
  }, true, dataAutomationId);
  
  // Always use the generated automation props (which include our override ID if provided)
  const finalAutomationProps = { ...selectProps, ...props };

  // Update metadata when field props change - intentionally omitting updateMetadata from deps
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
  }, [value, disabled, label, required, mappedOptions]); // updateMetadata intentionally omitted

  // Ensure value is never undefined/null/empty string for Radix
  const safeValue = value || 'placeholder';
  const selectedOption = uniqueOptions.find(option => option.value === value);

  return (
    <div className={label ? 'mb-4' : ''} id={`${id}`} data-automation-type={dataAutomationType}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <RadixSelect.Root 
        value={safeValue}
        // Use internal handler to intercept clear action
        onValueChange={(newValue) => {
          if (allowClear && newValue === '__CLEAR__') {
            onValueChange(''); // Call external handler with empty string
          } else if (newValue !== 'placeholder') { // Prevent placeholder from being selected
            onValueChange(newValue);
          }
        }}
        disabled={disabled}
        required={required}
      >
        <RadixSelect.Trigger
          {...finalAutomationProps}
          data-automation-type={dataAutomationType}
          className={`
            inline-flex items-center justify-between
            rounded-lg p-2 h-10
            text-sm font-medium transition-colors w-full
            bg-white cursor-pointer
            border border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-700))]
            hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
            disabled:pointer-events-none
            ${className}
            ${customStyles?.trigger || ''}
          `}
          aria-label={placeholder}
        >
          <RadixSelect.Value 
            placeholder={placeholder}
            className="flex-1 text-left"
          >
            <span className={!selectedOption ? 'text-gray-400' : ''}>
              {selectedOption?.label || placeholder}
            </span>
          </RadixSelect.Value>
          <RadixSelect.Icon>
            <ChevronDown className="w-4 h-4 text-gray-500" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className={`
              overflow-hidden bg-white rounded-md shadow-lg
              border border-gray-200 mt-1 z-[9999] min-w-[var(--radix-select-trigger-width)] max-w-full
              [&[data-side=top]]:mb-2 [&[data-side=bottom]]:mt-2
              ${customStyles?.content || ''}
            `}
            position="popper"
            sideOffset={4}
            align="start"
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.stopPropagation()}
          >
            <RadixSelect.ScrollUpButton className="flex items-center justify-center h-6 bg-white text-gray-700 cursor-default">
              <ChevronDown className="w-4 h-4 rotate-180" />
            </RadixSelect.ScrollUpButton>
            
            <RadixSelect.Viewport className="p-1">
              {/* Add a placeholder option if needed */}
              {!uniqueOptions.some(opt => opt.value === 'placeholder') && (
                <RadixSelect.Item
                  value="placeholder"
                  className={`
                    relative flex items-center px-3 py-2 text-sm rounded text-gray-500
                    cursor-pointer bg-white hover:bg-gray-100 focus:bg-gray-100
                    focus:outline-none select-none whitespace-nowrap
                    data-[highlighted]:bg-gray-100
                    ${customStyles?.item || ''}
                  `}
                >
                  <RadixSelect.ItemText>{placeholder}</RadixSelect.ItemText>
                </RadixSelect.Item>
              )}
              {/* Add Clear Selection option if allowClear is true */}
              {allowClear && value && ( // Only show clear if a value is selected
                <RadixSelect.Item
                  key="__CLEAR__"
                  value="__CLEAR__"
                  className={`
                    relative flex items-center px-3 py-2 text-sm rounded text-red-600 italic
                    cursor-pointer hover:bg-red-50 focus:bg-red-50
                    focus:outline-none select-none whitespace-nowrap
                    data-[highlighted]:bg-red-50
                    ${customStyles?.item || ''}
                  `}
                >
                  <RadixSelect.ItemText>Clear Selection</RadixSelect.ItemText>
                </RadixSelect.Item>
              )}
              {uniqueOptions.map((option): JSX.Element => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  className={`
                    relative flex items-center px-3 py-2 text-sm rounded text-gray-900
                    cursor-pointer hover:bg-gray-100 focus:bg-gray-100
                    focus:outline-none select-none whitespace-nowrap
                    data-[highlighted]:bg-gray-100
                    ${option.className || 'bg-white'}
                    ${customStyles?.item || ''}
                  `}
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {customStyles?.itemIndicator && (
                    <RadixSelect.ItemIndicator className={customStyles.itemIndicator}>
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    </RadixSelect.ItemIndicator>
                  )}
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>

            <RadixSelect.ScrollDownButton className="flex items-center justify-center h-6 bg-white text-gray-700 cursor-default">
              <ChevronDown className="w-4 h-4" />
            </RadixSelect.ScrollDownButton>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
};

export default CustomSelect;
