/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DatePicker } from './DatePicker';
import { DateTimePicker } from './DateTimePicker';
import { Calendar } from './Calendar';
import { DateFormatProvider } from '../lib/dateFormat/useDateFormat';

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

const date = new Date(2026, 5, 10, 14, 30); // 2026-06-10 14:30 local

describe('DatePicker country display', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('renders the short date per country, whatever the language', () => {
    const cases: Array<[string, string, string]> = [
      ['FR', 'en', '10/06/2026'],
      ['DE', 'en', '10.06.2026'],
      ['US', 'fr', '06/10/2026'],
      ['AU', 'de', '10/06/2026'],
    ];
    for (const [country, locale, expected] of cases) {
      mockLocale = locale;
      const { unmount } = render(
        <DateFormatProvider countryCode={country}>
          <DatePicker value={date} onChange={() => {}} />
        </DateFormatProvider>
      );
      expect(screen.getByDisplayValue(expected)).toBeTruthy();
      unmount();
    }
  });

  it('honors displayFormat override regardless of country', () => {
    render(
      <DateFormatProvider countryCode="DE">
        <DatePicker value={date} onChange={() => {}} displayFormat="yyyy-MM-dd" />
      </DateFormatProvider>
    );
    expect(screen.getByDisplayValue('2026-06-10')).toBeTruthy();
  });

  it('renders without either provider (auth-page scenario), on the system default', () => {
    mockLocale = null;
    render(<DatePicker value={date} onChange={() => {}} />);
    expect(screen.getByDisplayValue('06/10/2026')).toBeTruthy();
  });
});

describe('DateTimePicker country display', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('explicit timeFormat=24h overrides the country dial', () => {
    render(
      <DateFormatProvider countryCode="FR">
        <DateTimePicker value={date} onChange={() => {}} timeFormat="24h" />
      </DateFormatProvider>
    );
    expect(screen.getByDisplayValue('10/06/2026')).toBeTruthy();
    expect(screen.getByDisplayValue('14:30')).toBeTruthy();
  });

  it('explicit timeFormat=12h overrides the country dial', () => {
    render(
      <DateFormatProvider countryCode="DE">
        <DateTimePicker value={date} onChange={() => {}} timeFormat="12h" />
      </DateFormatProvider>
    );
    expect(screen.getByDisplayValue('10.06.2026')).toBeTruthy();
    expect(screen.getByDisplayValue('2:30 PM')).toBeTruthy();
  });

  it('unset timeFormat takes date and dial from the country, not the language', () => {
    mockLocale = 'de';
    const first = render(
      <DateFormatProvider countryCode="US">
        <DateTimePicker value={date} onChange={() => {}} />
      </DateFormatProvider>
    );
    expect(screen.getByDisplayValue('06/10/2026')).toBeTruthy();
    expect(screen.getByDisplayValue('2:30 PM')).toBeTruthy();
    first.unmount();

    mockLocale = 'en';
    render(
      <DateFormatProvider countryCode="DE">
        <DateTimePicker value={date} onChange={() => {}} />
      </DateFormatProvider>
    );
    expect(screen.getByDisplayValue('10.06.2026')).toBeTruthy();
    expect(screen.getByDisplayValue('14:30')).toBeTruthy();
  });
});

describe('Calendar locale display', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('shows localized month caption under fr and es', () => {
    mockLocale = 'fr';
    const first = render(
      <Calendar mode="single" selected={date} onSelect={() => {}} defaultMonth={date} />
    );
    expect(screen.getAllByText('juin 2026').length).toBeGreaterThan(0);
    first.unmount();

    mockLocale = 'es';
    render(<Calendar mode="single" selected={date} onSelect={() => {}} defaultMonth={date} />);
    expect(screen.getAllByText('junio 2026').length).toBeGreaterThan(0);
  });
});
