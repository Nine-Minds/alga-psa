import React, { useEffect } from 'react';
import { useRegisterUIComponent } from '../ui-reflection/useRegisterUIComponent';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';
import { cn } from '../lib/utils';

export interface RadioOption {
  /** Unique value for this option */
  value: string;
  /** Display label for this option */
  label: React.ReactNode;
  /** Optional description shown below the label */
  description?: React.ReactNode;
  /** Whether this option is disabled */
  disabled?: boolean;
  /** Optional icon to display before the label */
  icon?: React.ReactNode;
}

interface RadioGroupProps {
  /** Array of options to display */
  options: RadioOption[];
  /** Currently selected value */
  value?: string;
  /** Callback when selection changes */
  onChange?: (value: string) => void;
  /** Name attribute for the radio group */
  name: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Label for the entire radio group */
  label?: string;
  /** Whether the radio group is required */
  required?: boolean;
  /** Whether the entire radio group is disabled */
  disabled?: boolean;
  /** Optional class name for the container */
  className?: string;
  /** Orientation of the radio group */
  orientation?: 'vertical' | 'horizontal';
}

export const RadioGroup = ({
  options,
  value,
  onChange,
  name,
  id,
  label,
  required,
  disabled,
  className,
  orientation = 'vertical',
}: RadioGroupProps & AutomationProps) => {
  // Register with UI reflection system if id is provided
  const updateMetadata = useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    id: id || '__skip_registration_radiogroup',
    label,
    value,
    disabled,
    required
  });

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value,
        label,
        disabled,
        required
      });
    }
  }, [value, updateMetadata, label, disabled, required]);

  const handleChange = (optionValue: string) => {
    if (onChange && !disabled) {
      onChange(optionValue);
    }
  };

  return (
    <div
      className={cn(
        'space-y-3',
        orientation === 'horizontal' && 'flex flex-row gap-6 space-y-0',
        className
      )}
      role="radiogroup"
      aria-label={label}
      {...withDataAutomationId({ id })}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        const isDisabled = disabled || option.disabled;
        const optionId = `${id || name}-${option.value}`;

        return (
          <div
            key={option.value}
            className="flex items-start space-x-3"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={isSelected}
              onChange={() => handleChange(option.value)}
              disabled={isDisabled}
              className={cn(
                'mt-1 h-4 w-4 border-gray-300 text-primary-500',
                'focus:ring-2 focus:ring-primary-500 focus:ring-offset-0',
                'focus-visible:outline-none focus:outline-none',
                isDisabled && 'cursor-not-allowed opacity-50'
              )}
              style={{
                accentColor: 'rgb(var(--color-primary-500))',
              }}
              {...withDataAutomationId({ id: optionId })}
            />
            <div className="space-y-1">
              <label
                htmlFor={optionId}
                className={cn(
                  'flex items-center gap-2 text-sm text-gray-900 cursor-pointer',
                  isDisabled && 'cursor-not-allowed opacity-50'
                )}
              >
                {option.icon}
                {option.label}
              </label>
              {option.description && (
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default RadioGroup;
