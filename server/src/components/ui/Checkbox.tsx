import React, { InputHTMLAttributes, useEffect, useRef } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';
import { cn } from 'server/src/lib/utils';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the checkbox is required */
  required?: boolean;
  /** Custom classes for the checkbox container */
  containerClassName?: string;
  /** Display an indeterminate state */
  indeterminate?: boolean;
}

export const Checkbox: React.FC<CheckboxProps & AutomationProps> = ({
  label,
  className,
  id,
  checked,
  disabled,
  required,
  containerClassName,
  indeterminate,
  ...props
}) => {
  // Register with UI reflection system if id is provided
  const updateMetadata = useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'checkbox',
    id: id || '__skip_registration_checkbox',
    label,
    value: checked,
    disabled,
    required
  });

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: checked,
        label,
        disabled,
        required
      });
    }
  }, [checked, updateMetadata, label, disabled, required]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = !!indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <div className={cn('flex items-center', containerClassName ?? 'mb-4')}>
      <input
        type="checkbox"
        className={`h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded ${className}`}
        checked={checked}
        disabled={disabled}
        required={required}
        ref={inputRef}
        {...withDataAutomationId({ id })}
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
