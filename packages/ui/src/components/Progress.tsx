import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from '../lib/utils';
import * as React from 'react';

type ProgressSize = 'sm' | 'md' | 'lg';
type ProgressColor = 'default' | 'success' | 'warning' | 'danger';
type ProgressLabel = 'none' | 'inside' | 'outside';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value?: number;
  max?: number;
  className?: string;
  indicatorClassName?: string;
  ref?: React.Ref<React.ElementRef<typeof ProgressPrimitive.Root>>;
  /** Size of the progress bar */
  size?: ProgressSize;
  /** Color variant of the progress indicator */
  color?: ProgressColor;
  /** Show an indeterminate animated progress bar */
  indeterminate?: boolean;
  /** Label display mode */
  label?: ProgressLabel;
  /** Show diagonal striped pattern on the indicator */
  striped?: boolean;
}

const sizeClasses: Record<ProgressSize, string> = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

const colorClasses: Record<ProgressColor, string> = {
  default: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

const indeterminateKeyframes = `
@keyframes progress-indeterminate {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(100%);
  }
  100% {
    transform: translateX(-100%);
  }
}
`;

const stripedKeyframes = `
@keyframes progress-striped {
  0% {
    background-position: 0 0;
  }
  100% {
    background-position: 1rem 0;
  }
}
`;

const stripedStyle: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.15) 75%, transparent 75%, transparent)',
  backgroundSize: '1rem 1rem',
  animation: 'progress-striped 1s linear infinite',
};

function Progress({
  value = 0,
  max = 100,
  className,
  ref,
  indicatorClassName,
  size = 'md',
  color = 'default',
  indeterminate = false,
  label = 'none',
  striped = false,
  ...props
}: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  const displayPercentage = Math.round(percentage);

  const rootClassName = cn(
    'relative w-full overflow-hidden rounded-full bg-muted',
    sizeClasses[size],
    className
  );

  const indicatorColor = colorClasses[color];

  if (indeterminate) {
    return (
      <>
        <style>{indeterminateKeyframes}</style>
        <ProgressPrimitive.Root
          ref={ref}
          className={rootClassName}
          {...props}
        >
          <ProgressPrimitive.Indicator
            className={cn(
              'h-full w-1/3 rounded-full',
              indicatorColor,
              indicatorClassName
            )}
            style={{
              animation: 'progress-indeterminate 1.8s ease-in-out infinite',
            }}
          />
        </ProgressPrimitive.Root>
      </>
    );
  }

  const bar = (
    <>
      {striped && <style>{stripedKeyframes}</style>}
      <ProgressPrimitive.Root
        ref={ref}
        className={rootClassName}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn(
            'h-full w-full flex-1 transition-all relative',
            indicatorColor,
            indicatorClassName
          )}
          style={{
            transform: `translateX(-${100 - percentage}%)`,
            ...(striped ? stripedStyle : undefined),
          }}
        >
          {label === 'inside' && (
            <span className="absolute inset-0 flex items-center justify-center text-[8px] font-medium leading-none text-white">
              {displayPercentage}%
            </span>
          )}
        </ProgressPrimitive.Indicator>
      </ProgressPrimitive.Root>
    </>
  );

  if (label === 'outside') {
    return (
      <div className="flex items-center gap-2 w-full">
        <div className="flex-1">{bar}</div>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {displayPercentage}%
        </span>
      </div>
    );
  }

  return bar;
}

export { Progress };
export type { ProgressProps };
