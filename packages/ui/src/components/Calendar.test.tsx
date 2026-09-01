/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';

describe('Calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 21, 15, 30, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('selects today when the Today button is clicked', () => {
    const onSelect = vi.fn();

    render(
      <Calendar
        mode="single"
        selected={new Date(2026, 3, 5)}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select today' }));

    expect(onSelect).toHaveBeenCalledTimes(1);

    const selectedDate = onSelect.mock.calls[0][0] as Date;
    expect(selectedDate).toEqual(new Date(2026, 3, 21));
  });

  it('disables the Today button when today is outside the allowed range', () => {
    const onSelect = vi.fn();

    render(
      <Calendar
        mode="single"
        selected={new Date(2026, 3, 5)}
        onSelect={onSelect}
        fromDate={new Date(2026, 3, 22)}
      />
    );

    const todayButton = screen.getByRole('button', { name: 'Select today' }) as HTMLButtonElement;

    expect(todayButton.disabled).toBe(true);
    fireEvent.click(todayButton);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // The month list only ran forwards from the current month, so a date in the
  // recent past was unreachable from the dropdown.
  it('navigates to an earlier month and year from the month picker', () => {
    render(<Calendar mode="single" selected={new Date(2026, 3, 5)} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Select month and year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Jan' }));
    expect(screen.getByRole('button', { name: 'Select month and year' }).textContent).toContain(
      'January 2026'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select month and year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dec' }));
    expect(screen.getByRole('button', { name: 'Select month and year' }).textContent).toContain(
      'December 2025'
    );
  });

  it('keeps months outside the allowed range unselectable', () => {
    render(
      <Calendar
        mode="single"
        selected={new Date(2026, 3, 5)}
        onSelect={vi.fn()}
        fromDate={new Date(2026, 3, 1)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select month and year' }));

    expect((screen.getByRole('button', { name: 'Mar' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'May' }) as HTMLButtonElement).disabled).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'Previous year' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('suppresses the day-picker caption in favour of our own header row', () => {
    render(<Calendar mode="single" selected={new Date(2026, 3, 5)} onSelect={vi.fn()} />);

    // Under the pre-v9 key the month title rendered twice, one above the other.
    expect(document.querySelectorAll('.rdp-caption-hidden')).toHaveLength(1);
  });
});
