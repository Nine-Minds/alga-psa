// server/src/components/ui/Label.tsx

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { AutomationProps } from '../../types/ui-reflection/types'

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & AutomationProps
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className}`}
    {...props}
  />
))
Label.displayName = LabelPrimitive.Root.displayName

export { Label }
