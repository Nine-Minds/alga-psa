/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TimePicker } from './TimePicker';

/**
 * The due-date row puts DatePicker and TimePicker side by side. DatePicker
 * followed the locale and TimePicker did not, so one widget rendered
 * "23/05/2026" next to "7:05 PM" — half converted, in the same breath.
 *
 * The previous sweep missed it because it searched for date formatters, and
 * this component never formats a date: it defaulted a `timeFormat` prop to
 * '12h'. These tests pin the clock convention to the locale.
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

describe('TimePicker clock convention follows the locale', () => {
  afterEach(() => {
    cleanup();
    mockLocale = 'en';
  });

  it('renders 24-hour time for locales that use a 24-hour clock', () => {
    for (const locale of ['fr', 'de', 'pt', 'nl', 'it', 'pl', 'es']) {
      mockLocale = locale;
      const { unmount } = render(<TimePicker value="19:05" onChange={() => {}} />);
      expect(screen.getByDisplayValue('19:05')).toBeTruthy();
      expect(screen.queryByDisplayValue(/PM/)).toBeNull();
      unmount();
    }
  });

  it('keeps 12-hour time with a meridiem for en', () => {
    mockLocale = 'en';
    render(<TimePicker value="19:05" onChange={() => {}} />);
    expect(screen.getByDisplayValue('7:05 PM')).toBeTruthy();
  });

  it('still honours an explicit timeFormat override', () => {
    mockLocale = 'fr';
    render(<TimePicker value="19:05" onChange={() => {}} timeFormat="12h" />);
    expect(screen.getByDisplayValue('7:05 PM')).toBeTruthy();
  });

  it('falls back to the default locale with no provider above it', () => {
    mockLocale = null;
    render(<TimePicker value="19:05" onChange={() => {}} />);
    expect(screen.getByDisplayValue('7:05 PM')).toBeTruthy();
  });
});
