'use client';

import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { useRegisterUIComponent } from '../ui-reflection/useRegisterUIComponent';
import { FormFieldComponent, AutomationProps } from '../ui-reflection/types';
import { withDataAutomationId } from '../ui-reflection/withDataAutomationId';

interface SwitchProps extends Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>, 'id'> {
  /** Label text */
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the switch is required */
  required?: boolean;
  /** Ref for the switch element */
  ref?: React.Ref<React.ElementRef<typeof SwitchPrimitives.Root>>;
}

function Switch({
  className,
  label,
  id,
  required,
  checked,
  disabled,
  ref,
  ...props
}: SwitchProps & AutomationProps) {
  // Register with UI reflection system
  const updateMetadata = useRegisterUIComponent<FormFieldComponent>({
    type: 'formField',
    fieldType: 'checkbox',
    id: id || '__skip_registration_switch',
    label,
    value: checked,
    disabled,
    required
  });

  // Update metadata when field props change
  React.useEffect(() => {
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
    <div className="flex items-center gap-2">
      <SwitchPrimitives.Root
        className={`switch-root ${className}`}
        checked={checked}
        disabled={disabled}
        required={required}
        {...withDataAutomationId({ id })}
        {...props}
        ref={ref}
      >
        <SwitchPrimitives.Thumb className="switch-thumb" />
      </SwitchPrimitives.Root>
      {label && (
        <label className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
    </div>
  );
}

export { Switch };
