/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import TimezonePicker from './TimezonePicker';
import { DateFormatProvider } from '../lib/dateFormat/useDateFormat';

// Same shape as the TimezonePicker.i18n.test mock, extended so object-form
// options ({ defaultValue, ...interpolation }) resolve like real i18next.
vi.mock('../lib/i18n/client', () => ({
  useOptionalI18n: () => ({ locale: 'en' }),
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | { defaultValue?: string; [k: string]: unknown }) => {
      if (typeof fallbackOrOptions === 'string') return fallbackOrOptions;
      const template = fallbackOrOptions?.defaultValue ?? key;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(fallbackOrOptions?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

// jsdom lacks these; cmdk calls them when selection changes.
beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

const renderPicker = (value: string) =>
  render(
    <DateFormatProvider countryCode="US">
      <TimezonePicker value={value} onValueChange={vi.fn()} />
    </DateFormatProvider>
  );

const openAndSearch = (value: string, query: string) => {
  renderPicker(value);
  fireEvent.click(screen.getByRole('button'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: query } });
  return screen.getAllByRole('option');
};

const rowFor = (options: HTMLElement[], zoneId: string) =>
  options.find((o) => o.textContent?.startsWith(zoneId.replaceAll('_', ' ')));

describe('TimezonePicker search ranking', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe.each([
    ['July (US daylight time)', '2026-07-15T12:00:00Z'],
    ['January (US standard time)', '2026-01-15T12:00:00Z'],
  ])('in %s', (_label, iso) => {
    it('puts America/New York first for "EST" and marks Panama as No DST', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));

      const options = openAndSearch('America/Chicago', 'EST');
      expect(options[0].textContent).toContain('America/New York');
      // New York is a DST zone: both abbreviations, no badge.
      expect(options[0].textContent).toContain('EST / EDT');
      expect(within(options[0]).queryByText('No DST')).toBeNull();

      const panama = rowFor(options, 'America/Panama');
      expect(panama).toBeDefined();
      expect(within(panama as HTMLElement).getByText('No DST')).toBeTruthy();
    });

    it('puts Denver above Phoenix for "MST"', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));

      const options = openAndSearch('America/Chicago', 'MST');
      const ids = options.map((o) => o.textContent ?? '');
      const denver = ids.findIndex((t) => t.startsWith('America/Denver'));
      const phoenix = ids.findIndex((t) => t.startsWith('America/Phoenix'));
      expect(denver).toBe(0);
      expect(phoenix).toBeGreaterThan(denver);
    });
  });

  it('shows the no-DST hint under the collapsed button for a fixed-offset zone only', () => {
    renderPicker('America/Panama');
    expect(screen.getByTestId('timezone-no-dst-hint').textContent).toBe(
      'No daylight saving time. Clocks stay at GMT-5 all year.'
    );
    cleanup();

    renderPicker('America/New_York');
    expect(screen.queryByTestId('timezone-no-dst-hint')).toBeNull();
  });

  it('renders a stored legacy value as it is, without crashing', () => {
    renderPicker('EST');
    expect(screen.getByRole('button').textContent).toContain('EST');
    cleanup();

    renderPicker('Not/AZone');
    expect(screen.getByRole('button').textContent).toContain('Not/AZone');
  });

  it('does not build the zone list until the picker is expanded', () => {
    // The descriptor cache is keyed by (locale, year); use a year no other test
    // populated so the first expand is a cache miss.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-07-15T12:00:00Z'));
    const spy = vi.spyOn(Intl, 'supportedValuesOf');
    try {
      renderPicker('America/New_York');
      expect(spy).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button'));
      expect(spy).toHaveBeenCalledWith('timeZone');
    } finally {
      spy.mockRestore();
    }
  });

  it('offers UTC in the list', () => {
    const options = openAndSearch('America/Chicago', 'utc');
    expect(options.some((o) => o.textContent?.startsWith('UTC'))).toBe(true);
  });
});
