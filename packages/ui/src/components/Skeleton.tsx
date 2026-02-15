'use client';

import { cn } from '../lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[rgb(var(--color-border-200))] dark:bg-[rgb(var(--color-border-100))]', className)}
      {...props}
    />
  );
}

export { Skeleton };
