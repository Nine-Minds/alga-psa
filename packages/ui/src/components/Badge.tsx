import { cn } from '../lib/utils';
import * as React from 'react';

export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'outline';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
  ref?: React.Ref<HTMLDivElement>;
}

function Badge({ className, variant = 'default', ref, ...props }: BadgeProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
        {
          'border-transparent bg-primary text-primary-foreground': variant === 'primary',
          'border-transparent bg-secondary-100 text-secondary-800': variant === 'secondary',
          'border-transparent bg-success text-success-foreground': variant === 'success',
          'border-transparent bg-warning text-warning-foreground': variant === 'warning',
          'border-transparent bg-error text-error-foreground': variant === 'error',
          'border-border bg-background text-foreground': variant === 'default',
          'border-current bg-transparent': variant === 'outline',
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
