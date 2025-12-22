import * as ProgressPrimitive from '@radix-ui/react-progress';
import { cn } from 'server/src/lib/utils';
import * as React from 'react';

interface ProgressProps extends React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> {
  value: number;
  max?: number;
  className?: string;
  ref?: React.Ref<React.ElementRef<typeof ProgressPrimitive.Root>>;
}

function Progress({ value, max = 100, className, ref, ...props }: ProgressProps) {
  const percentage = Math.min((value / max) * 100, 100);

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - percentage}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
