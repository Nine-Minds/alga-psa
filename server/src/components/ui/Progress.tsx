import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from 'server/src/lib/utils';
import * as React from 'react';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value: number;
  max?: number;
  className?: string;
  indicatorClassName?: string;
}

const Progress = React.forwardRef<React.ElementRef<typeof ProgressPrimitive.Root>, ProgressProps>(
  ({ value, max = 100, className, indicatorClassName, ...props }, ref) => {
    const percentage = Math.min((value / max) * 100, 100);

    return (
      <ProgressPrimitive.Root
        ref={ref}
        className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary-100 dark:bg-secondary-900', className)}
        {...props}
      >
        <ProgressPrimitive.Indicator
          className={cn('h-full w-full flex-1 bg-primary transition-all', indicatorClassName)}
          style={{ transform: `translateX(-${100 - percentage}%)` }}
        />
      </ProgressPrimitive.Root>
    );
  }
);

Progress.displayName = 'Progress';

export { Progress };
