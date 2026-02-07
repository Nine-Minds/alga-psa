'use client';

import React, { InputHTMLAttributes, useEffect, useRef } from 'react';
import { useRegisterUIComponent } from '../ui-reflection/useRegisterUIComponent';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';
import { cn } from '../lib/utils';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id' | 'size'> {
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
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

const checkboxSizeClasses: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

export function Checkbox({
  label,
  className,
  id,
  checked,
  disabled,
  required,
  skipRegistration = false,
  containerClassName,
  indeterminate,
  size = 'md',
  ...props
}: CheckboxProps & AutomationProps): React.ReactElement {
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

  const wrapperClasses = cn('flex items-center gap-2', containerClassName ?? 'mb-4');

  return (
    <div className={wrapperClasses}>
      <input
        type="checkbox"
        className={`alga-checkbox ${checkboxSizeClasses[size]} rounded-md border-[rgb(var(--color-border-300))] text-primary-500 focus-visible:outline-none focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 focus:border-primary-500 ${className || ''}`}
        style={{
          accentColor: 'rgb(var(--color-primary-500))',
          colorScheme: 'light',
          borderRadius: '0.375rem'
        }}
        checked={checked}
        disabled={disabled}
        required={required}
        ref={checkboxRef}
        onChange={(event) => {
          props.onChange?.(event);
        }}
        {...props}
        {...withDataAutomationId({ id })}
      />
      {label && (
        <label htmlFor={id} className="ml-2 block text-sm text-[rgb(var(--color-text-900))]">
          {label}
        </label>
      )}
    </div>
  );
}
