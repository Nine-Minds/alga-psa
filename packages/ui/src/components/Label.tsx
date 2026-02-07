// server/src/components/ui/Label.tsx

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { AutomationProps } from '../ui-reflection/types'

export type LabelSize = 'sm' | 'md' | 'lg';

const labelSizeClasses: Record<LabelSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

function Label({
  className,
  ref,
  size = 'md',
  required = false,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & AutomationProps & {
  ref?: React.Ref<React.ElementRef<typeof LabelPrimitive.Root>>;
  size?: LabelSize;
  required?: boolean;
}) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={`${labelSizeClasses[size]} font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className ?? ''}`}
      {...props}
    >
      {children}
      {required && <span className="text-destructive ml-0.5" aria-hidden="true">*</span>}
    </LabelPrimitive.Root>
  )
}

export { Label }
