'use client';

import React, { useEffect, useState, useMemo, useId } from 'react';
import { ChevronDown } from 'lucide-react';
import * as RadixSelect from '@radix-ui/react-select';
import { useModality } from './ModalityContext';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';

export interface SelectOption {
  value: string;
  label: string | React.JSX.Element;
  /** Plain-text value used by Radix for the trigger display when label is JSX */
  textValue?: string;
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
  /** Whether the select should be modal (prevents interaction with outside elements) */
  modal?: boolean;
  /** Whether to show the placeholder as a disabled option in the dropdown (default: true) */
  showPlaceholderInDropdown?: boolean;
}

const PLACEHOLDER_VALUE = '__SELECT_PLACEHOLDER__';
const EMPTY_SELECTION_VALUE = '__SELECT_EMPTY__';

const CustomSelect = ({
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
  allowClear = false,
  modal,
  showPlaceholderInDropdown = true,
  ...props
}: CustomSelectProps & AutomationProps) => {
  const { modal: parentModal } = useModality();
  
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

  const normalizedOptions = useMemo(
    () =>
      uniqueOptions.map((option) => ({
        ...option,
        radixValue: option.value === '' ? EMPTY_SELECTION_VALUE : option.value,
      })),
    [uniqueOptions]
  );

  // Memoize the mapped options to prevent recreating on every render
  const mappedOptions = useMemo(
    () =>
      uniqueOptions.map((opt): { value: string; label: string } => ({
        value: opt.value,
        label: typeof opt.label === 'string' ? opt.label : 'Complex Label',
      })),
    [uniqueOptions]
  );
  
  
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
	  const { id: _selectPropsId, ...selectPropsWithoutId } = selectProps as any;
	  const { id: _propsId, ...propsWithoutId } = props as any;
	  const finalAutomationProps = { ...selectPropsWithoutId, ...propsWithoutId, id: selectId };

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

  const radixValue =
    value === undefined || value === null
      ? PLACEHOLDER_VALUE
      : value === ''
        ? EMPTY_SELECTION_VALUE
        : value;
  const selectedOption = uniqueOptions.find((option) => option.value === value);

  // Explicit prop overrides parent modality context
  const isModal = modal !== undefined ? modal : parentModal;

  const containerId = finalAutomationProps.id ? `${finalAutomationProps.id}-container` : undefined;

  return (
    <div className={label ? 'mb-4' : ''} id={containerId} data-automation-type={dataAutomationType} suppressHydrationWarning>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <RadixSelect.Root
        value={radixValue}
        {...({ modal: isModal } as any)}
        // Use internal handler to intercept clear action
        onValueChange={(newValue) => {
          if (allowClear && newValue === '__CLEAR__') {
            onValueChange('');
            return;
          }
          if (newValue === PLACEHOLDER_VALUE) {
            return;
          }
          const externalValue = newValue === EMPTY_SELECTION_VALUE ? '' : newValue;
          onValueChange(externalValue);
        }}
        disabled={disabled}
        required={required}
        onOpenChange={(open) => {
          // When select closes, mark it on the document to prevent dialog from closing
          // This helps with the portal timing issue
          if (!open) {
            document.body.setAttribute('data-radix-select-just-closed', 'true');
            setTimeout(() => {
              document.body.removeAttribute('data-radix-select-just-closed');
            }, 100);
          }
        }}
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
            disabled:pointer-events-none disabled:cursor-not-allowed
            disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200
            disabled:hover:bg-gray-100 disabled:hover:text-gray-400
            ${className}
            ${customStyles?.trigger || ''}
          `}
          aria-label={placeholder}
          suppressHydrationWarning
          onPointerDown={(e) => {
            // Prevent click events from bubbling up to parent dialogs
            // This prevents dialogs from closing when clicking the select trigger
            // to toggle the dropdown open/closed state
            e.stopPropagation();
          }}
        >
          <RadixSelect.Value
            placeholder={placeholder}
            className="flex-1 text-left"
          >
            <span className={!selectedOption || disabled ? 'text-gray-400' : ''}>
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
              overflow-hidden bg-white rounded-md shadow-lg pointer-events-auto
              border border-gray-200 mt-1 z-[10001] min-w-[var(--radix-select-trigger-width)] max-w-full
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
            
            <RadixSelect.Viewport className="p-1 max-h-[300px] overflow-y-auto">
              {/* Add a placeholder option if needed */}
              {showPlaceholderInDropdown && (
                <RadixSelect.Item
                  value={PLACEHOLDER_VALUE}
                  className={`
                    relative flex items-center px-3 py-2 text-sm rounded text-gray-500
                    cursor-default bg-white select-none
                    ${customStyles?.item || ''}
                  `}
                  disabled
                >
                  <RadixSelect.ItemText>{placeholder}</RadixSelect.ItemText>
                </RadixSelect.Item>
              )}

              {allowClear && value !== undefined && value !== null && value !== '' && (
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
              {normalizedOptions.map((option): React.JSX.Element => (
                <RadixSelect.Item
                  key={option.radixValue}
                  value={option.radixValue}
                  textValue={option.textValue ?? (typeof option.label === 'string' ? option.label : undefined)}
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
