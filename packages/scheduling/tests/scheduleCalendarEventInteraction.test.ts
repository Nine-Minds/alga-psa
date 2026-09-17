// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { IScheduleEntry } from '@alga-psa/types';
import { ScheduleCalendarEventContext, ScheduleCalendarEventRenderer } from '../src/components/schedule/ScheduleCalendarEventRenderer';

afterEach(cleanup);
const event = { entry_id: 'calendar-entry', title: 'Customer visit' } as IScheduleEntry;

it('delivers the first click when hovering updates the event presentation', async () => {
  const select = vi.fn();
  function Calendar() {
    const [hovered, setHovered] = useState(false);
    const renderEvent = ({ event }: { event: IScheduleEntry }) => React.createElement('button', {
      onMouseEnter: () => setHovered(true),
      onClick: () => select(event.entry_id, hovered),
      'aria-pressed': hovered,
    }, event.title);
    return React.createElement(ScheduleCalendarEventContext.Provider, { value: renderEvent },
      React.createElement(ScheduleCalendarEventRenderer, { event }));
  }
  render(React.createElement(Calendar));
  await userEvent.setup().click(screen.getByRole('button', { name: event.title }));
  expect(select).toHaveBeenCalledExactlyOnceWith(event.entry_id, true);
});

it('keeps keyboard focus and uses the latest event after a calendar refresh', async () => {
  const select = vi.fn();
  const calendar = (title: string) => React.createElement(ScheduleCalendarEventContext.Provider, {
    value: ({ event: current }) => React.createElement('button', { onClick: () => select(current.title) }, current.title),
  }, React.createElement(ScheduleCalendarEventRenderer, { event: { ...event, title } }));
  const view = render(calendar('Original visit'));
  const user = userEvent.setup();
  await user.tab();
  view.rerender(calendar('Updated visit'));
  await user.keyboard('{Enter}');
  expect(select).toHaveBeenCalledExactlyOnceWith('Updated visit');
});
