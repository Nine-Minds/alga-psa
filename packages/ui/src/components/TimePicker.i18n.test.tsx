/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TimePicker } from './TimePicker';
import { DateFormatProvider } from '../lib/dateFormat/useDateFormat';

/**
 * The due-date row puts DatePicker and TimePicker side by side. DatePicker
 * followed the locale and TimePicker did not, so one widget rendered
 * "23/05/2026" next to "7:05 PM" — half converted, in the same breath.
 *
 * The previous sweep missed it because it searched for date formatters, and
 * this component never formats a date: it defaulted a `timeFormat` prop to
 * '12h'. These tests pin the clock convention to the country, which is what
 * decides it — a German-speaking user in the US still reads 7:05 PM.
 */

let mockLocale: string | null = 'en';

vi.mock('../lib/i18n/client', () => ({
  useOptionalI18n: () => (mockLocale ? { locale: mockLocale } : null),
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('../ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({
    automationIdProps: {},
    updateMetadata: vi.fn(),
  }),
}));

describe('TimePicker clock convention follows the country', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('renders 24-hour time for countries that use a 24-hour clock', () => {
    for (const country of ['FR', 'DE', 'PT', 'NL', 'IT', 'PL', 'ES']) {
      const { unmount } = render(
        <DateFormatProvider countryCode={country}>
          <TimePicker value="19:05" onChange={() => {}} />
        </DateFormatProvider>
      );
      expect(screen.getByDisplayValue('19:05')).toBeTruthy();
      expect(screen.queryByDisplayValue(/PM/)).toBeNull();
      unmount();
    }
  });

  it('keeps 12-hour time with a meridiem for the US', () => {
    mockLocale = 'de';
    render(
      <DateFormatProvider countryCode="US">
        <TimePicker value="19:05" onChange={() => {}} />
      </DateFormatProvider>
    );
    expect(screen.getByDisplayValue('7:05 PM')).toBeTruthy();
  });

  it('still honours an explicit timeFormat override', () => {
    render(
      <DateFormatProvider countryCode="FR">
        <TimePicker value="19:05" onChange={() => {}} timeFormat="12h" />
      </DateFormatProvider>
    );
    expect(screen.getByDisplayValue('7:05 PM')).toBeTruthy();
  });

  it('falls back to the fixed system default with no provider above it', () => {
    mockLocale = null;
    render(<TimePicker value="19:05" onChange={() => {}} />);
    expect(screen.getByDisplayValue('7:05 PM')).toBeTruthy();
  });
});
