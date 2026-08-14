/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DateTimeField } from './DateTimeField';
import { buildTimeOptions, parseDateInput, parseTimeInput } from '../lib/dateTimeInput';

/**
 * The family's contract, in the order it was argued for: you can type, the
 * panel is an assist, arbitrary minutes survive, back-dating works, and nothing
 * the user set is replaced behind their back.
 */

let mockLocale: string | null = 'en';

vi.mock('../lib/i18n/client', () => ({
  useOptionalI18n: () => (mockLocale ? { locale: mockLocale } : null),
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

const fields = () => screen.getAllByRole('combobox') as HTMLInputElement[];
const railValues = () => screen.queryAllByRole('option').map((option) => option.textContent);

afterEach(() => {
  cleanup();
  mockLocale = 'en';
});

describe('typing', () => {
  it('accepts a bare 4-digit time and commits it on Enter', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="time" value="09:00" onChange={onChange} timeFormat="24h" />);

    const [input] = fields();
    fireEvent.change(input, { target: { value: '1437' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith('14:37');
  });

  it('parses a date in the locale field order, including back-dated years', () => {
    mockLocale = 'de';
    const onChange = vi.fn();
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} />);

    const [input] = fields();
    fireEvent.change(input, { target: { value: '1.3.2019' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(new Date(2019, 2, 1));
  });

  it('keeps the previous value when the text does not parse', () => {
    mockLocale = 'de';
    const onChange = vi.fn();
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} />);

    const [input] = fields();
    fireEvent.change(input, { target: { value: '31.02.2026' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // The text stays put so it can be corrected rather than retyped.
    expect(input.value).toBe('31.02.2026');
  });
});

describe('the rail', () => {
  it('inserts the exact minute in sequence instead of rounding it away', () => {
    render(<DateTimeField variant="time" value="14:37" onChange={() => {}} timeFormat="24h" />);

    fireEvent.focus(fields()[0]);

    const values = railValues();
    expect(values).toContain('14:37');
    expect(values.indexOf('14:37')).toBe(values.indexOf('14:30') + 1);
    expect(values.indexOf('14:45')).toBe(values.indexOf('14:37') + 1);
  });

  it('follows the time while it is typed, before anything is committed', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="time" value="09:00" onChange={onChange} timeFormat="24h" />);

    const [input] = fields();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '14:37' } });

    expect(railValues()).toContain('14:37');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads on a 12-hour dial where the locale does', () => {
    render(<DateTimeField variant="time" value="14:35" onChange={() => {}} timeFormat="12h" />);

    fireEvent.focus(fields()[0]);

    expect(railValues()).toContain('2:35 PM');
    expect(railValues()).toContain('2:30 PM');
  });

  it('commits and closes on a click', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="time" value="14:37" onChange={onChange} timeFormat="24h" />);

    fireEvent.focus(fields()[0]);
    fireEvent.click(screen.getByRole('option', { name: '15:00' }));

    expect(onChange).toHaveBeenCalledWith('15:00');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});

describe('the exit contract', () => {
  it('keeps the panel for the time half after a day is picked, then closes on the time', () => {
    const onChange = vi.fn();
    render(
      <DateTimeField
        variant="datetime"
        value={new Date(2026, 7, 13, 14, 35)}
        onChange={onChange}
        timeFormat="24h"
      />
    );

    const [dateInput] = fields();
    fireEvent.focus(dateInput);
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));

    // Day picked, panel stays: the time half is still to come.
    expect(railValues().length).toBeGreaterThan(0);
    const afterDay = onChange.mock.calls.length;
    expect(afterDay).toBe(1);
    // The minute the user set survives the day change.
    expect((onChange.mock.calls[0][0] as Date).getMinutes()).toBe(35);

    fireEvent.click(screen.getByRole('option', { name: '14:35' }));
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('closes on Escape without committing what was typed', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="time" value="09:00" onChange={onChange} timeFormat="24h" />);

    const [input] = fields();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '14:37' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('14:37');
  });

  it('offers a written way out and a close button', () => {
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={() => {}} />);

    fireEvent.focus(fields()[0]);

    expect(screen.getByText('Pick a day to save and close')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});

describe('keyboard', () => {
  it('steps the date a day at a time without committing', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} />);

    const [input] = fields();
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(input.value).toBe('08/12/2026');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual(new Date(2026, 7, 12));
  });

  it('steps time by the rail granularity, and by five minutes with Shift', () => {
    render(<DateTimeField variant="time" value="14:37" onChange={() => {}} timeFormat="24h" />);

    const [input] = fields();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('14:45');

    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    expect(input.value).toBe('14:40');
  });
});

describe('parsing rules', () => {
  it('takes the shortcuts the timesheet already knew, and refuses nonsense', () => {
    expect(parseTimeInput('930p')).toBe('21:30');
    expect(parseTimeInput('9a')).toBe('09:00');
    expect(parseTimeInput('14.35')).toBe('14:35');
    expect(parseTimeInput('1435')).toBe('14:35');
    expect(parseTimeInput('25:00')).toBeNull();
  });

  it('reads dates in the locale order, with relative words and offsets', () => {
    const today = new Date(2026, 7, 13);

    expect(parseDateInput('13/8', 'it', { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('13/08/26', 'it', { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('130826', 'it', { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('08/13/2026', 'en', { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('yesterday', 'en', { today })).toEqual(new Date(2026, 7, 12));
    expect(parseDateInput('+7', 'en', { today })).toEqual(new Date(2026, 7, 20));
    expect(parseDateInput('31/02/2026', 'it', { today })).toBeNull();
  });

  it('builds a quarter-hour rail that still carries the odd minute', () => {
    expect(buildTimeOptions(undefined, 15)).toHaveLength(96);
    expect(buildTimeOptions('14:30', 15)).toHaveLength(96);

    const withExact = buildTimeOptions('14:37', 15);
    expect(withExact).toHaveLength(97);
    expect(withExact[withExact.indexOf('14:30') + 1]).toBe('14:37');
  });
});
