'use client';

import React, { createContext, useContext } from 'react';
import type { IScheduleEntry } from '@alga-psa/types';

type EventProps = { event: IScheduleEntry };
type RenderEvent = (props: EventProps) => React.ReactElement;

export const ScheduleCalendarEventContext = createContext<RenderEvent | null>(null);

export function ScheduleCalendarEventRenderer(props: EventProps) {
  const render = useContext(ScheduleCalendarEventContext);
  if (!render) throw new Error('Schedule events require their calendar rendering context');
  // The callback changes with calendar state. Calling it as a render function
  // preserves the event's component identity, pointer target and keyboard focus.
  return render(props);
}
