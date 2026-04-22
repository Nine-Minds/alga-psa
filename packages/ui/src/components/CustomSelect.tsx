'use client';

import React, { useEffect, useMemo, useId, useRef } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import * as RadixSelect from '@radix-ui/react-select';
import { Button } from './Button';
import { useModality } from './ModalityContext';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { useAutomationIdAndRegister } from '../ui-reflection/useAutomationIdAndRegister';
import { useTranslation } from '../lib/i18n/client';

export interface SelectOption {
  value: string;
  label: string | React.JSX.Element;
  /** Plain-text value used by Radix for the trigger display when label is JSX */
  textValue?: string;
  /** Additional content shown only in the dropdown, not in the trigger */
  dropdownHint?: string | React.JSX.Element;
  className?: string;
  is_inactive?: boolean;
  disabled?: boolean;
}

export interface StyleProps {
  trigger?: string;
  content?: string;
  item?: string;
  itemIndicator?: string;
}

type SelectSize = 'sm' | 'md' | 'lg';

const sizeClasses: Record<SelectSize, string> = {
  sm: 'h-8 text-xs px-2',
  md: 'h-10 text-sm p-2',
  lg: 'h-12 text-base px-4',
};

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
  /** Size variant for the select trigger */
  size?: SelectSize;
  /** Callback to add a new item - renders a sticky button at the bottom of the dropdown */
  onAddNew?: () => void;
  /** Label for the add new button (default: "Add new") */
  addNewLabel?: string;
}

const PLACEHOLDER_VALUE = '__SELECT_PLACEHOLDER__';
const EMPTY_SELECTION_VALUE = '__SELECT_EMPTY__';

function areMappedOptionsEqual(
  current: Array<{ value: string; label: string }>,
  next: Array<{ value: string; label: string }>
) {
  if (current.length !== next.length) {
    return false;
  }
  for (let i = 0; i < current.length; i++) {
    if (
      current[i].value !== next[i].value ||
      current[i].label !== next[i].label
    ) {
      return false;
    }
  }
  return true;
}

const CustomSelect = ({
  options,
  value,
  onValueChange,
  placeholder,
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
  size = 'md',
  onAddNew,
  addNewLabel = 'Add new',
  ...props
}: CustomSelectProps & AutomationProps) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('form.selectPlaceholder', { defaultValue: 'Select...' });
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
  const metadataSnapshotRef = useRef<{
    value: string;
    label?: string;
    disabled: boolean;
    required: boolean;
    options: { value: string; label: string }[];
  } | null>(null);

  // Update metadata when field props change - intentionally omitting updateMetadata from deps
  useEffect(() => {
    if (!updateMetadata) {
      metadataSnapshotRef.current = null;
      return;
    }

    const normalizedValue = value || '';
    const nextMetadata = {
      value: normalizedValue,
      label,
      disabled,
      required,
      options: mappedOptions
    };
    const previousMetadata = metadataSnapshotRef.current;

    const primitivesChanged =
      !previousMetadata ||
      previousMetadata.value !== nextMetadata.value ||
      previousMetadata.label !== nextMetadata.label ||
      previousMetadata.disabled !== nextMetadata.disabled ||
      previousMetadata.required !== nextMetadata.required;

    const optionsChanged =
      !previousMetadata ||
      !areMappedOptionsEqual(previousMetadata.options, nextMetadata.options);

    if (!primitivesChanged && !optionsChanged) {
      return;
    }

    metadataSnapshotRef.current = nextMetadata;
    updateMetadata(nextMetadata);
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

  const selectTriggerRef = useRef<HTMLButtonElement>(null);

  const containerId = finalAutomationProps.id ? `${finalAutomationProps.id}-container` : undefined;

  return (
    <div className={label ? 'mb-4' : ''} id={containerId} data-automation-type={dataAutomationType} suppressHydrationWarning>
      {label && (
        <label className="block text-sm font-medium text-foreground mb-1">
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
          ref={selectTriggerRef}
          {...finalAutomationProps}
          data-automation-type={dataAutomationType}
          className={`
            inline-flex items-center justify-between
            rounded-lg ${sizeClasses[size]}
            font-medium transition-colors w-full
            bg-background cursor-pointer
            border border-[rgb(var(--color-border-400))] text-[rgb(var(--color-text-700))]
            hover:bg-[rgb(var(--color-primary-50))] hover:text-[rgb(var(--color-primary-700))]
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
            disabled:pointer-events-none disabled:cursor-not-allowed
            disabled:bg-muted disabled:text-muted-foreground disabled:border-border
            disabled:hover:bg-muted disabled:hover:text-muted-foreground
            overflow-hidden
            ${className}
            ${customStyles?.trigger || ''}
          `}
          aria-label={resolvedPlaceholder}
          suppressHydrationWarning
          onPointerDown={(e) => {
            // Prevent click events from bubbling up to parent dialogs
            // This prevents dialogs from closing when clicking the select trigger
            // to toggle the dropdown open/closed state
            e.stopPropagation();
          }}
        >
          <RadixSelect.Value
            placeholder={resolvedPlaceholder}
            className="flex-1 text-left min-w-0 overflow-hidden"
          >
            <span className={`block truncate ${!selectedOption || disabled ? 'text-muted-foreground' : ''}`}>
              {selectedOption?.label || resolvedPlaceholder}
            </span>
          </RadixSelect.Value>
          <RadixSelect.Icon>
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            className={`
              overflow-hidden bg-background dark:bg-[rgb(var(--color-card))] rounded-md shadow-lg pointer-events-auto
              border border-border dark:border-[rgb(var(--color-border-200))] mt-1 z-[10001] min-w-[var(--radix-select-trigger-width)] max-w-full
              [&[data-side=top]]:mb-2 [&[data-side=bottom]]:mt-2
              ${customStyles?.content || ''}
            `}
            position="popper"
            sideOffset={4}
            align="start"
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.stopPropagation()}
          >
            <RadixSelect.ScrollUpButton className="flex items-center justify-center h-6 bg-background dark:bg-[rgb(var(--color-card))] text-foreground cursor-default">
              <ChevronDown className="w-4 h-4 rotate-180" />
            </RadixSelect.ScrollUpButton>
            
            <RadixSelect.Viewport className="p-1 max-h-[300px] overflow-y-auto">
              {/* Add a placeholder option if needed */}
              {showPlaceholderInDropdown && (
                <RadixSelect.Item
                  value={PLACEHOLDER_VALUE}
                  className={`
                    relative flex items-center px-3 py-2 text-sm rounded text-muted-foreground
                    cursor-default bg-background select-none
                    ${customStyles?.item || ''}
                  `}
                  disabled
                >
                  <RadixSelect.ItemText>{resolvedPlaceholder}</RadixSelect.ItemText>
                </RadixSelect.Item>
              )}

              {allowClear && value !== undefined && value !== null && value !== '' && (
                <RadixSelect.Item
                  key="__CLEAR__"
                  value="__CLEAR__"
                  className={`
                    relative flex items-center px-3 py-2 text-sm rounded text-destructive italic
                    cursor-pointer hover:bg-[rgb(var(--color-destructive)/0.1)] focus:bg-[rgb(var(--color-destructive)/0.1)]
                    focus:outline-none select-none whitespace-nowrap
                    data-[highlighted]:bg-[rgb(var(--color-destructive)/0.1)]
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
                  disabled={Boolean(option.disabled)}
                  className={`
                    relative flex px-3 py-2 text-sm rounded text-foreground
                    cursor-pointer hover:bg-muted focus:bg-muted
                    focus:outline-none select-none
                    data-[highlighted]:bg-muted
                    data-[disabled]:pointer-events-none data-[disabled]:cursor-not-allowed
                    data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent data-[disabled]:focus:bg-transparent
                    ${option.dropdownHint ? 'flex-col items-start' : 'items-center whitespace-nowrap'}
                    ${option.className || 'bg-background'}
                    ${customStyles?.item || ''}
                  `}
                >
                  <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                  {option.dropdownHint && (
                    <div className="text-[11px] text-gray-500 mt-0.5 whitespace-normal">{option.dropdownHint}</div>
                  )}
                  {customStyles?.itemIndicator && (
                    <RadixSelect.ItemIndicator className={customStyles.itemIndicator}>
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    </RadixSelect.ItemIndicator>
                  )}
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>

            <RadixSelect.ScrollDownButton className="flex items-center justify-center h-6 bg-background dark:bg-[rgb(var(--color-card))] text-foreground cursor-default">
              <ChevronDown className="w-4 h-4" />
            </RadixSelect.ScrollDownButton>
            {onAddNew && (
              <>
                <div className="border-t border-border" />
                <Button
                  id="custom-select-add-new-btn"
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 rounded-none text-primary"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    // Close dropdown by dispatching Escape on the trigger, then open the add-new UI
                    selectTriggerRef.current?.dispatchEvent(
                      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
                    );
                    // Small delay to let Radix unmount the dropdown before opening the dialog
                    requestAnimationFrame(() => {
                      onAddNew?.();
                    });
                  }}
                >
                  <Plus className="h-4 w-4" />
                  {addNewLabel}
                </Button>
              </>
            )}
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
};

export default CustomSelect;
