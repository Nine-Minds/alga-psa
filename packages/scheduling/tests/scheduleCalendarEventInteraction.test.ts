// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: event.title });
  // click() bundles its hover-then-press pointer sequence into a single
  // dispatch, which races the mouseenter-triggered re-render against the
  // press under CI load. Awaiting the hover and its resulting re-render as
  // their own step removes that race before the click fires.
  await user.hover(button);
  await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'));
  await user.click(button);
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
