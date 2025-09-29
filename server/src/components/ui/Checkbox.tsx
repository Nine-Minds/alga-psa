import React, { InputHTMLAttributes, useEffect } from 'react';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> {
  label?: string | React.ReactNode;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the checkbox is required */
  required?: boolean;
}

export const Checkbox: React.FC<CheckboxProps & AutomationProps> = ({
  label,
  className,
  id,
  checked,
  disabled,
  required,
  ...props
}) => {
  // Register with UI reflection system if id is provided
  const updateMetadata = useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'checkbox',
    id: id || '__skip_registration_checkbox',
    label: typeof label === 'string' ? label : undefined,
    value: checked,
    disabled,
    required
  });

  // Update metadata when field props change
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value: checked,
        label: typeof label === 'string' ? label : undefined,
        disabled,
        required
      });
    }
  }, [checked, updateMetadata, label, disabled, required]);

  return (
    <div className="flex items-center mb-4">
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
