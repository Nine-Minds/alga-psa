'use client';

import React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '../lib/utils';
import { AutomationProps } from '../ui-reflection/types';

interface TooltipProps extends AutomationProps { // Include AutomationProps here
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string; // Add className prop for TooltipContent styling
  side?: TooltipPrimitive.TooltipContentProps['side'];
  align?: TooltipPrimitive.TooltipContentProps['align'];
  sideOffset?: TooltipPrimitive.TooltipContentProps['sideOffset'];
}

export const Tooltip = ({ // Removed AutomationProps from here as it's in the interface
  content,
  children,
  className,
  side,
  align,
  sideOffset = 4, // Default offset like Radix
  ...props // Pass down automation props if needed, though Radix might handle accessibility
}: TooltipProps) => {
  // Removed useState, useCallback, useRef, handleMouseMove

  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            sideOffset={sideOffset}
            side={side}
            align={align}
            className={cn(
              // Standard Radix styles (adjust if needed based on project theme)
              "z-[9999] overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
              // Original custom styling
              "w-64 px-4 py-3 text-base text-white bg-gray-800 rounded shadow-sm",
              className // Allow overriding/extending styles
            )}
            {...props} // Spread any remaining props, potentially for data attributes
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
};
