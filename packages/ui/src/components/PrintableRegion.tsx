'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

export interface PrintableRegionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export const PrintableRegion = React.forwardRef<HTMLDivElement, PrintableRegionProps>(
  function PrintableRegion({ className, title, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-print-region
        data-print-title={title}
        className={cn(className)}
        {...props}
      />
    );
  }
);
