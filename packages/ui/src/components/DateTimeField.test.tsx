/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { countryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import { DateTimeField } from './DateTimeField';
import { DateFormatProvider } from '../lib/dateFormat/useDateFormat';
import {
  buildTimeOptions,
  formatTimeDisplay,
  getDatePlaceholder,
  isTypableDateText,
  isTypableTimeText,
  parseDateInput,
  parseTimeInput,
} from '../lib/dateTimeInput';
import { format as formatDateFns } from 'date-fns';

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

  it('parses a date in the country field order, including back-dated years', () => {
    const onChange = vi.fn();
    render(
      <DateFormatProvider countryCode="DE">
        <DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} />
      </DateFormatProvider>
    );

    const [input] = fields();
    fireEvent.change(input, { target: { value: '1.3.2019' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(new Date(2019, 2, 1));
  });

  it('refuses a character no entry could hold, rather than failing on it later', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} />);

    const [input] = fields();
    fireEvent.change(input, { target: { value: '08/13/2026x' } });

    expect(input.value).toBe('08/13/2026');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('still takes the words and shortcuts the parser understands', () => {
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={() => {}} />);

    const [input] = fields();
    fireEvent.change(input, { target: { value: 'tomorrow' } });
    expect(input.value).toBe('tomorrow');

    cleanup();
    render(<DateTimeField variant="time" value="09:00" onChange={() => {}} timeFormat="12h" />);
    const [timeInput] = fields();
    fireEvent.change(timeInput, { target: { value: '2:35p' } });
    expect(timeInput.value).toBe('2:35p');
  });

  it('keeps the previous value when the text does not parse', () => {
    const onChange = vi.fn();
    render(
      <DateFormatProvider countryCode="DE">
        <DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} />
      </DateFormatProvider>
    );

    const [input] = fields();
    fireEvent.change(input, { target: { value: '31.02.2026' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // The text stays put so it can be corrected rather than retyped, and the
    // field says which value it is still holding.
    expect(input.value).toBe('31.02.2026');
    expect(screen.getByText('Not a date — kept 13.08.2026')).toBeTruthy();
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

  it('reads on a 12-hour dial where the country does', () => {
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

  // Inside a dialog or drawer the scroll lock cancels the wheel over the
  // portalled panel, so the rail has to turn itself. It claims the event as it
  // mounts; binding that from an effect keyed on the open state was too early,
  // and left the rail movable only by dragging its scrollbar.
  it('turns under the wheel, not only under the scrollbar', () => {
    render(<DateTimeField variant="time" value="09:00" onChange={() => {}} timeFormat="24h" />);

    fireEvent.focus(fields()[0]);
    const rail = screen.getByRole('listbox');
    const wheel = new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true });
    rail.dispatchEvent(wheel);

    expect(wheel.defaultPrevented).toBe(true);
  });
});

describe('the exit contract', () => {
  it('commits a typed datetime on Enter and closes without submitting the enclosing form', () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <DateTimeField
          variant="datetime"
          value={new Date(2026, 8, 17, 12, 0)}
          onChange={onChange}
          timeFormat="12h"
        />
        <button type="submit">Save entry</button>
      </form>
    );

    const [, timeInput] = fields();
    fireEvent.focus(timeInput);
    fireEvent.change(timeInput, { target: { value: '12:30 PM' } });
    expect(timeInput.getAttribute('aria-expanded')).toBe('true');

    // Prevent the Enter default action as well as closing the panel: the
    // schedule entry should only submit when its Save button is clicked.
    expect(fireEvent.keyDown(timeInput, { key: 'Enter' })).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(new Date(2026, 8, 17, 12, 30));
    expect(timeInput.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save entry' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

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
    // The time pick is committed, not just the panel closed: same day as picked, 14:35.
    expect(onChange).toHaveBeenCalledTimes(2);
    const committed = onChange.mock.calls[1][0] as Date;
    expect(committed.getHours()).toBe(14);
    expect(committed.getMinutes()).toBe(35);
    expect(formatDateFns(committed, 'yyyy-MM-dd')).toBe(formatDateFns(new Date(), 'yyyy-MM-dd'));
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

describe('ruled-out days', () => {
  // Aug 17–23 2026 is off limits; everything else in range is fine.
  const lockedWeek = (day: Date) => day >= new Date(2026, 7, 17) && day <= new Date(2026, 7, 23);

  it('refuses a typed day the caller has ruled out and keeps the previous value', () => {
    const onChange = vi.fn();
    render(
      <DateFormatProvider countryCode="DE">
        <DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} isDateDisabled={lockedWeek} />
      </DateFormatProvider>
    );

    const [input] = fields();
    fireEvent.change(input, { target: { value: '18.08.2026' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // A real date that is merely unavailable is not described as "not a date".
    expect(screen.getByRole('status').textContent).toMatch(/^That day can’t be chosen/);
  });

  it('still commits a typed day the rule allows', () => {
    const onChange = vi.fn();
    render(
      <DateFormatProvider countryCode="DE">
        <DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} isDateDisabled={lockedWeek} />
      </DateFormatProvider>
    );

    const [input] = fields();
    fireEvent.change(input, { target: { value: '25.08.2026' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual(new Date(2026, 7, 25));
  });

  it('disables ruled-out days in the calendar and ignores clicks on them', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} isDateDisabled={lockedWeek} />);

    fireEvent.focus(fields()[0]);
    const dayButton = (day: number) =>
      screen.getAllByRole('button').find((button) => button.textContent === String(day) && button.closest('[role="grid"]'))!;

    expect((dayButton(18) as HTMLButtonElement).disabled).toBe(true);
    expect((dayButton(12) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(dayButton(18));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows typed text to a ruled-out day without marking it selected', () => {
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={() => {}} isDateDisabled={lockedWeek} />);

    const [input] = fields();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '08/18/2026' } });

    const day = (n: number) =>
      screen.getAllByRole('button').find((button) => button.textContent === String(n) && button.closest('[role="grid"]'))!;
    expect(day(18).closest('[aria-selected="true"]')).toBeNull();
    expect(day(13).closest('[aria-selected="true"]')).not.toBeNull();
  });

  it('disables the Today shortcut when today is ruled out', () => {
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={() => {}} isDateDisabled={() => true} />);

    fireEvent.focus(fields()[0]);

    expect((screen.getByRole('button', { name: 'Today' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('clearing', () => {
  it('clears from the button when the field is clearable', () => {
    const onChange = vi.fn();
    render(
      <DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} clearable />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(fields()[0].value).toBe('');
  });

  it('clears on Backspace only when the whole field is selected', () => {
    const onChange = vi.fn();
    render(
      <DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} clearable />
    );

    const [input] = fields();
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();

    input.setSelectionRange(0, input.value.length);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('leaves a non-clearable value alone when its text is emptied', () => {
    const onChange = vi.fn();
    render(<DateTimeField variant="date" value={new Date(2026, 7, 13)} onChange={onChange} />);

    const [input] = fields();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('08/13/2026');
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
  // What the field prints must be what the field will take back. A display
  // pattern and a parse order derived from different sources is how a date
  // silently moves on a blur.
  it('round-trips display -> parse in every country shape we ship', () => {
    const date = new Date(2026, 7, 13);

    for (const country of ['US', 'AU', 'GB', 'DE', 'CA', 'BR', 'NL', 'SE', 'HU', 'XX']) {
      const shape = countryDateFormat(country);
      const printed = formatDateFns(date, shape.datePattern);
      expect(parseDateInput(printed, shape)).toEqual(date);
      // The placeholder promises the same order the parser reads.
      expect(getDatePlaceholder(shape)).toBe(
        shape.datePattern.replace('MM', 'mm').replace('dd', 'dd')
      );
    }
  });

  it('takes the shortcuts the timesheet already knew, and refuses nonsense', () => {
    expect(parseTimeInput('930p')).toBe('21:30');
    expect(parseTimeInput('9a')).toBe('09:00');
    expect(parseTimeInput('14.35')).toBe('14:35');
    expect(parseTimeInput('1435')).toBe('14:35');
    expect(parseTimeInput('25:00')).toBeNull();
  });

  it('reads dates in the country order, with relative words and offsets', () => {
    const today = new Date(2026, 7, 13);

    const IT = countryDateFormat('IT');
    const US = countryDateFormat('US');

    expect(parseDateInput('13/8', IT, { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('13/08/26', IT, { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('130826', IT, { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('08/13/2026', US, { today })).toEqual(new Date(2026, 7, 13));
    // Pasted ISO reads as ISO in every country, never as 2026 months.
    expect(parseDateInput('2026-08-13', IT, { today })).toEqual(new Date(2026, 7, 13));
    expect(parseDateInput('yesterday', US, { today })).toEqual(new Date(2026, 7, 12));
    expect(parseDateInput('+7', US, { today })).toEqual(new Date(2026, 7, 20));
    expect(parseDateInput('31/02/2026', IT, { today })).toBeNull();
  });

  it('lets only characters a valid entry could hold be typed', () => {
    expect(isTypableDateText('13/08/2026')).toBe(true);
    expect(isTypableDateText('13/')).toBe(true);
    expect(isTypableDateText('-3')).toBe(true);
    expect(isTypableDateText('tod')).toBe(true);
    expect(isTypableDateText('ogg', { words: ['Oggi'] })).toBe(true);
    expect(isTypableDateText('abc')).toBe(false);
    expect(isTypableDateText('13/08/2026x')).toBe(false);

    expect(isTypableTimeText('14:3')).toBe(true);
    expect(isTypableTimeText('1435')).toBe(true);
    expect(isTypableTimeText('2:35p')).toBe(true);
    expect(isTypableTimeText('9a')).toBe(true);
    expect(isTypableTimeText('p')).toBe(false);
    expect(isTypableTimeText('abc')).toBe(false);
  });

  it('builds a quarter-hour rail that still carries the odd minute', () => {
    expect(buildTimeOptions(undefined, 15)).toHaveLength(96);
    expect(buildTimeOptions('14:30', 15)).toHaveLength(96);

    const withExact = buildTimeOptions('14:37', 15);
    expect(withExact).toHaveLength(97);
    expect(withExact[withExact.indexOf('14:30') + 1]).toBe('14:37');
  });
});

/**
 * alga-2026-0002591: a day pick followed by a time that is NOT the one already
 * held (nor midnight). The older "keeps the panel" test picks the time the
 * value already had, so it could not tell a committed pick from a no-op.
 */
describe('datetime: day pick, then a time other than the held one', () => {
  function Controlled({
    initial,
    onCommit,
    timeFormat,
    minDate,
  }: {
    initial?: Date;
    onCommit: (date?: Date) => void;
    timeFormat: '12h' | '24h';
    minDate?: Date;
  }) {
    const [value, setValue] = React.useState<Date | undefined>(initial);
    return (
      <DateTimeField
        variant="datetime"
        value={value}
        minDate={minDate}
        timeFormat={timeFormat}
        onChange={(next) => {
          const date = next instanceof Date ? next : undefined;
          setValue(date);
          onCommit(date);
        }}
      />
    );
  }

  const dayButton = (day: string) => {
    const button = screen
      .getAllByRole('button')
      .find((candidate) => candidate.textContent === day && !(candidate as HTMLButtonElement).disabled);
    if (!button) throw new Error(`no enabled day button ${day}`);
    return button;
  };

  const cases: { name: string; timeFormat: '12h' | '24h'; option: string; shown: string; h: number; m: number }[] = [
    { name: '12h, morning quarter', timeFormat: '12h', option: '9:15 AM', shown: '9:15 AM', h: 9, m: 15 },
    { name: '12h, afternoon quarter', timeFormat: '12h', option: '4:45 PM', shown: '4:45 PM', h: 16, m: 45 },
    { name: '24h, morning quarter', timeFormat: '24h', option: '09:15', shown: '09:15', h: 9, m: 15 },
    { name: '24h, evening quarter', timeFormat: '24h', option: '21:30', shown: '21:30', h: 21, m: 30 },
  ];

  for (const c of cases) {
    it(`commits the rail pick from an empty value (${c.name})`, () => {
      const seen: (Date | undefined)[] = [];
      render(<Controlled onCommit={(d) => seen.push(d)} timeFormat={c.timeFormat} />);

      const [dateInput, timeInput] = fields();
      fireEvent.focus(dateInput);
      fireEvent.click(dayButton('17'));
      fireEvent.click(screen.getByRole('option', { name: c.option }));

      const last = seen.at(-1) as Date;
      expect(last.getDate()).toBe(17);
      expect(last.getHours()).toBe(c.h);
      expect(last.getMinutes()).toBe(c.m);
      expect(timeInput.value).toBe(c.shown);
    });

    it(`commits the rail pick over a different held time (${c.name})`, () => {
      const seen: (Date | undefined)[] = [];
      render(<Controlled initial={new Date(2026, 7, 13, 14, 35)} onCommit={(d) => seen.push(d)} timeFormat={c.timeFormat} />);

      const [dateInput, timeInput] = fields();
      fireEvent.focus(dateInput);
      fireEvent.click(dayButton('17'));
      fireEvent.click(screen.getByRole('option', { name: c.option }));

      const last = seen.at(-1) as Date;
      expect(last.getDate()).toBe(17);
      expect(last.getHours()).toBe(c.h);
      expect(last.getMinutes()).toBe(c.m);
      expect(timeInput.value).toBe(c.shown);
    });
  }

  it('commits the rail pick when minDate is the same day (the End Time case)', () => {
    const seen: (Date | undefined)[] = [];
    const minDate = new Date(2026, 7, 13, 9, 0);
    render(
      <Controlled
        initial={new Date(2026, 7, 13, 9, 0)}
        minDate={minDate}
        onCommit={(d) => seen.push(d)}
        timeFormat="12h"
      />
    );

    const [dateInput, timeInput] = fields();
    fireEvent.focus(dateInput);
    fireEvent.click(dayButton('13'));
    fireEvent.click(screen.getByRole('option', { name: '10:45 AM' }));

    const last = seen.at(-1) as Date;
    expect(formatDateFns(last, 'yyyy-MM-dd HH:mm')).toBe('2026-08-13 10:45');
    expect(timeInput.value).toBe('10:45 AM');
  });

  it('commits a typed time after the day pick, in 12h and in 24h', () => {
    for (const [timeFormat, typed, shown] of [
      ['12h', '3:37 PM', '3:37 PM'],
      ['24h', '15:37', '15:37'],
    ] as const) {
      const seen: (Date | undefined)[] = [];
      const { unmount } = render(<Controlled onCommit={(d) => seen.push(d)} timeFormat={timeFormat} />);

      const [dateInput, timeInput] = fields();
      fireEvent.focus(dateInput);
      fireEvent.click(dayButton('17'));
      fireEvent.change(timeInput, { target: { value: typed } });
      fireEvent.keyDown(timeInput, { key: 'Enter' });

      const last = seen.at(-1) as Date;
      expect(last.getDate()).toBe(17);
      expect(last.getHours()).toBe(15);
      expect(last.getMinutes()).toBe(37);
      expect(timeInput.value).toBe(shown);
      unmount();
    }
  });

  it('round-trips every quarter-hour row through display and parse, in both formats', () => {
    const options = buildTimeOptions(undefined);
    expect(options).toHaveLength(96);
    for (const format of ['12h', '24h'] as const) {
      for (const option of options) {
        expect(parseTimeInput(formatTimeDisplay(option, format))).toBe(option);
      }
    }
  });
});
