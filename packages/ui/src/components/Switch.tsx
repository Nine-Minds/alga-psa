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
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Ref for the switch element */
  ref?: React.Ref<React.ElementRef<typeof SwitchPrimitives.Root>>;
}

const switchSizeStyles: Record<'sm' | 'md' | 'lg', { root: React.CSSProperties; thumb: React.CSSProperties }> = {
  sm: {
    root: { width: '34px', height: '20px' },
    thumb: { width: '16px', height: '16px', transform: 'translateX(2px)' },
  },
  md: {
    root: {},
    thumb: {},
  },
  lg: {
    root: { width: '50px', height: '30px' },
    thumb: { width: '26px', height: '26px', transform: 'translateX(2px)' },
  },
};

const switchThumbCheckedTranslate: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'translateX(14px)',
  md: '',
  lg: 'translateX(20px)',
};

function Switch({
  className,
  label,
  id,
  required,
  checked,
  disabled,
  size = 'md',
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

  const sizeRoot = switchSizeStyles[size].root;
  const sizeThumb = switchSizeStyles[size].thumb;
  const thumbStyle: React.CSSProperties = checked && switchThumbCheckedTranslate[size]
    ? { ...sizeThumb, transform: switchThumbCheckedTranslate[size] }
    : { ...sizeThumb };

  return (
    <div className="flex items-center gap-2">
      <SwitchPrimitives.Root
        className={`switch-root ${className}`}
        style={sizeRoot}
        checked={checked}
        disabled={disabled}
        required={required}
        {...withDataAutomationId({ id })}
        {...props}
        ref={ref}
      >
        <SwitchPrimitives.Thumb className="switch-thumb" style={thumbStyle} />
      </SwitchPrimitives.Root>
      {label && (
        <label className="text-sm font-medium text-[rgb(var(--color-text-700))]">
          {label}
        </label>
      )}
    </div>
  );
}

export { Switch };
