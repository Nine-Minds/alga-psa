import React, { InputHTMLAttributes, useEffect, useRef } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import { cn } from 'server/src/lib/utils';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label?: string | React.ReactNode;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the checkbox is required */
  required?: boolean;
  /** Skip UI reflection registration (useful when parent component handles registration) */
  skipRegistration?: boolean;
  /** Optional wrapper class overrides */
  containerClassName?: string;
  /** Display indeterminate state */
  indeterminate?: boolean;
}

export const Checkbox: React.FC<CheckboxProps & AutomationProps> = ({
  label,
  className,
  id,
  checked,
  disabled,
  required,
  skipRegistration = false,
  containerClassName,
  indeterminate,
  ...props
}) => {
  const checkboxRef = useRef<HTMLInputElement | null>(null);

  // Register with UI reflection system if id is provided and not skipped
  const updateMetadata = useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'checkbox',
    id: skipRegistration ? '__skip_registration_checkbox' : (id || '__skip_registration_checkbox'),
    label: typeof label === 'string' ? label : undefined,
    value: typeof checked === 'boolean' ? checked : undefined,
    disabled,
    required
  });

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: typeof checked === 'boolean' ? checked : undefined,
        label: typeof label === 'string' ? label : undefined,
        disabled,
        required
      });
    }
  }, [checked, updateMetadata, label, disabled, required]);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = !!indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  const wrapperClasses = cn('flex items-center', containerClassName ?? 'mb-4');

  return (
    <div className={wrapperClasses}>
      <input
        type="checkbox"
        className={`alga-checkbox h-4 w-4 rounded-md border-gray-300 text-primary-500 focus-visible:outline-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:border-primary-500 ${className || ''}`}
        style={{
          accentColor: 'rgb(var(--color-primary-500))',
          colorScheme: 'light',
          borderRadius: '0.375rem'
        }}
        checked={checked}
        disabled={disabled}
        required={required}
        ref={checkboxRef}
        {...withDataAutomationId({ id })}
        onChange={(event) => {
          props.onChange?.(event);
        }}
        {...props}
      />
      {label && (
        <label className="ml-2 block text-sm text-gray-900">
          {label}
        </label>
      )}
    </div>
  );
};
