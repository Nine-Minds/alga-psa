/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';

describe('Calendar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 21, 15, 30, 0));
  });

  afterEach(() => {
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

    const todayButton = screen.getByRole('button', { name: 'Select today' });

    expect(todayButton).toBeDisabled();
    fireEvent.click(todayButton);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
