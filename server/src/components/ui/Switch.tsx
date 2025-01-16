import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { useRegisterUIComponent } from '../../types/ui-reflection/useRegisterUIComponent';
import { FormFieldComponent, AutomationProps } from '../../types/ui-reflection/types';
import { withDataAutomationId } from '../../types/ui-reflection/withDataAutomationId';

interface SwitchProps extends Omit<React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>, 'id'> {
  /** Label text */
  label?: string;
  /** Unique identifier for UI reflection system */
  id?: string;
  /** Whether the switch is required */
  required?: boolean;
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps & AutomationProps
>(({ className, label, id, required, checked, disabled, ...props }, ref) => {
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
});

Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
