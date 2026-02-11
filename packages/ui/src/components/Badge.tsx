import { cn } from '../lib/utils';
import * as React from 'react';

export type BadgeVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'outline' | 'info' | 'default-muted' | 'itil';
export type BadgeSize = 'sm' | 'md' | 'lg';

const badgeSizeClasses: Record<BadgeSize, string> = {
  sm: 'text-[10px] px-1.5 py-0',
  md: 'text-xs px-2.5 py-0.5',
  lg: 'text-sm px-3 py-1',
};

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  ref?: React.Ref<HTMLDivElement>;
}

function Badge({ className, variant = 'default', size = 'md', ref, ...props }: BadgeProps) {
  return (
    <div
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-full border font-semibold transition-colors',
        badgeSizeClasses[size],
        {
          'border-transparent bg-primary text-primary-foreground': variant === 'primary',
          'border-transparent bg-secondary-100 text-secondary-800': variant === 'secondary',
          'border-transparent bg-success text-success-foreground': variant === 'success',
          'border-transparent bg-warning text-warning-foreground': variant === 'warning',
          'border-transparent bg-error text-error-foreground': variant === 'error',
          'border-border bg-background text-foreground': variant === 'default',
          'border-current bg-transparent': variant === 'outline',
          'border-[rgb(var(--badge-info-border))] bg-[rgb(var(--badge-info-bg))] text-[rgb(var(--badge-info-text))]': variant === 'info',
          'border-[rgb(var(--badge-default-border))] bg-[rgb(var(--badge-default-bg))] text-[rgb(var(--badge-default-text))]': variant === 'default-muted',
          'border-blue-500/30 bg-blue-500/15 text-blue-600': variant === 'itil',
        },
        className
      )}
      {...props}
    />
  );
}

export { Badge };
