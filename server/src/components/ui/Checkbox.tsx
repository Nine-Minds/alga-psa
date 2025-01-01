import React, { InputHTMLAttributes, useEffect } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormFieldComponent } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the checkbox is required */
  required?: boolean;
}

export const Checkbox: React.FC<CheckboxProps> = ({ 
  label, 
  className, 
  id,
  checked,
  disabled,
  required,
  ...props 
}) => {
  // Register with UI reflection system if id is provided
  const updateMetadata = id ? useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'checkbox',
    id,
    label,
    value: checked,
    disabled,
    required
  }) : undefined;

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

  return (
    <div className="flex items-center mb-4">
      <input
        type="checkbox"
        className={`h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded ${className}`}
        checked={checked}
        disabled={disabled}
        required={required}
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
