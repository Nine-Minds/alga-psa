// server/src/components/ui/Label.tsx

'use client';

import * as React from 'react'
import { useTranslation } from '@alga-psa/ui/lib/i18n/client'
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
  const { t } = useTranslation('common');

  return (
    <LabelPrimitive.Root
      ref={ref}
      className={`${labelSizeClasses[size]} font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 ${className ?? ''}`}
      {...props}
    >
      {children}
      {required && <span className="text-[rgb(var(--color-text-500))] ml-0.5" aria-hidden="true" title={t('label.required')}>*</span>}
    </LabelPrimitive.Root>
  )
}

export { Label }
