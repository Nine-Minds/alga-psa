'use client';

import React, { useRef } from 'react';
import type { WorkItemType } from '@alga-psa/types';
import { useSurfaceIsLight } from '@alga-psa/ui/hooks/useSurfaceIsLight';
import { fillTokenFor, inkForFill } from '../../lib/scheduleChipInk';

interface MonthScheduleChipProps {
  workItemType: WorkItemType;
  isPrimary: boolean;
  opacity: number;
  tooltip: string;
  /** Owning calendar's colour when overlaying several calendars; drawn as a left rule. */
  calendarColor?: string;
  onClick: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: React.ReactNode;
}

/**
 * The month view paints one flat chip per entry. It is a component rather than
 * markup inside the calendar's render callback so it can measure the fill it
 * was given: the chip inherits the calendar's text colour otherwise, and on the
 * dark pairs that lands mid-grey ink on a mid-tone fill — or, on high-contrast
 * dark, near-white ink on the near-white ad hoc fill.
 */
const MonthScheduleChip: React.FC<MonthScheduleChipProps> = ({
  workItemType,
  isPrimary,
  opacity,
  tooltip,
  calendarColor,
  onClick,
  onMouseEnter,
  onMouseLeave,
  children,
}) => {
  const chipRef = useRef<HTMLDivElement>(null);
  const fill = fillTokenFor(workItemType, false);
  const fillIsLight = useSurfaceIsLight(chipRef, fill);

  return (
    <div
      ref={chipRef}
      className={`h-full w-full p-1 rounded text-xs ${isPrimary ? 'font-semibold' : ''} flex items-center`}
      style={{
        backgroundColor: `rgb(var(${fill}))`,
        color: inkForFill(fillIsLight),
        minHeight: '30px',
        cursor: 'pointer',
        opacity,
        borderLeft: calendarColor ? `4px solid ${calendarColor}` : undefined,
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={tooltip}
    >
      {children}
    </div>
  );
};

export default MonthScheduleChip;
