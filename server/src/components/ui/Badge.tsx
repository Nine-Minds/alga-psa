import { cn } from 'server/src/lib/utils';
import * as React from 'react';

export type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'error';

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
          {
            'border-transparent bg-primary text-primary-foreground': variant === 'primary',
            'border-transparent bg-success text-success-foreground': variant === 'success',
            'border-transparent bg-warning text-warning-foreground': variant === 'warning',
            'border-transparent bg-error text-error-foreground': variant === 'error',
            'border-border bg-background text-foreground': variant === 'default',
          },
          className
        )}
        {...props}
      />
    );
  }
);

Badge.displayName = 'Badge';

export { Badge };