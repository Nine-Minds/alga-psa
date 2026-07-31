/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { format as formatDateFns } from 'date-fns';
import { de as deLocale } from 'date-fns/locale/de';
import { DatePicker } from './DatePicker';
import { DateTimePicker } from './DateTimePicker';
import { Calendar } from './Calendar';

let mockLocale: string | null = 'en';

vi.mock('../lib/i18n/client', () => ({
  useOptionalI18n: () => (mockLocale ? { locale: mockLocale } : null),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

const date = new Date(2026, 5, 10, 14, 30); // 2026-06-10 14:30 local

describe('DatePicker locale display', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('renders short date per locale (fr 10/06/2026, de 10.06.2026, en 06/10/2026)', () => {
    const cases: Array<[string, string]> = [
      ['fr', '10/06/2026'],
      ['de', '10.06.2026'],
      ['en', '06/10/2026'],
    ];
    for (const [locale, expected] of cases) {
      mockLocale = locale;
      const { unmount } = render(<DatePicker value={date} onChange={() => {}} />);
      expect(screen.getByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it('honors displayFormat override regardless of locale', () => {
    mockLocale = 'fr';
    render(<DatePicker value={date} onChange={() => {}} displayFormat="yyyy-MM-dd" />);
    expect(screen.getByText('2026-06-10')).toBeTruthy();
  });

  it('renders without an I18nProvider (auth-page scenario), defaulting to en', () => {
    mockLocale = null;
    render(<DatePicker value={date} onChange={() => {}} />);
    expect(screen.getByText('06/10/2026')).toBeTruthy();
  });
});

describe('DateTimePicker locale display', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('explicit timeFormat=24h renders 24h time with locale date under fr', () => {
    mockLocale = 'fr';
    render(<DateTimePicker value={date} onChange={() => {}} timeFormat="24h" />);
    expect(screen.getByText('10/06/2026 14:30')).toBeTruthy();
  });

  it('explicit timeFormat=12h renders 12h time with locale date under de', () => {
    mockLocale = 'de';
    render(<DateTimePicker value={date} onChange={() => {}} timeFormat="12h" />);
    expect(screen.getByText(formatDateFns(date, 'P hh:mm a', { locale: deLocale }))).toBeTruthy();
    expect(screen.getByText(/^10\.06\.2026 02:30/)).toBeTruthy();
  });

  it('unset timeFormat renders locale-derived date+time under en and de', () => {
    mockLocale = 'en';
    const first = render(<DateTimePicker value={date} onChange={() => {}} />);
    expect(screen.getByText('06/10/2026 2:30 PM')).toBeTruthy();
    first.unmount();

    mockLocale = 'de';
    render(<DateTimePicker value={date} onChange={() => {}} />);
    expect(screen.getByText('10.06.2026 14:30')).toBeTruthy();
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
