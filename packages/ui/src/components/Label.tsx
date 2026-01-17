// server/src/components/ui/Label.tsx

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { AutomationProps } from '../ui-reflection/types'

function Label({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & AutomationProps & {
  ref?: React.Ref<React.ElementRef<typeof LabelPrimitive.Root>>;
}) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={`text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className}`}
      {...props}
    />
  )
}

export { Label }
