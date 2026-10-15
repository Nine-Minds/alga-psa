/** @vitest-environment jsdom */

process.env.TZ = 'UTC';

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { countryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import { DateFormatProvider } from './useDateFormat';
import { useFormatters } from '../i18n/client';

// The shared server test setup stubs @alga-psa/ui/lib/i18n/client wholesale,
// which would hand this suite a canned formatter instead of the real hook.
vi.mock('@alga-psa/ui/lib/i18n/client', async () => vi.importActual('../i18n/client'));

// The language half (month/weekday names) is exercised in
// i18n/formatDateValue.country.test.ts; this suite is about the provider
// reaching useFormatters at all, so it runs on the default language.
const INSTANT = new Date('2026-09-30T13:23:00.000Z');

function Probe() {
  const { formatDate } = useFormatters();
  return (
    <>
      <span data-testid="numeric">
        {formatDate(INSTANT, { year: 'numeric', month: '2-digit', day: '2-digit' })}
      </span>
      <span data-testid="named">
        {formatDate(INSTANT, { year: 'numeric', month: 'long', day: 'numeric' })}
      </span>
      <span data-testid="time">{formatDate(INSTANT, { hour: 'numeric', minute: '2-digit' })}</span>
    </>
  );
}

describe('useFormatters under DateFormatProvider', () => {
  afterEach(cleanup);

  it('takes digit order and separator from the resolved pattern', () => {
    render(
      <DateFormatProvider dateFormat={countryDateFormat('AU')}>
        <Probe />
      </DateFormatProvider>
    );

    expect(screen.getByTestId('numeric').textContent).toBe('30/09/2026');
    // A named month keeps the language's own wording and order.
    expect(screen.getByTestId('named').textContent).toBe('September 30, 2026');
  });

  it('accepts a bare country code as well as a resolved pattern', () => {
    render(
      <DateFormatProvider countryCode="DE">
        <Probe />
      </DateFormatProvider>
    );
    expect(screen.getByTestId('numeric').textContent).toBe('30.09.2026');
  });

  it('forces the clock from the country', () => {
    const first = render(
      <DateFormatProvider countryCode="US">
        <Probe />
      </DateFormatProvider>
    );
    expect(screen.getByTestId('time').textContent).toMatch(/PM/);
    first.unmount();

    render(
      <DateFormatProvider countryCode="GB">
        <Probe />
      </DateFormatProvider>
    );
    expect(screen.getByTestId('time').textContent).toBe('13:23');
  });

  it('falls back to the fixed system default with no provider above it', () => {
    render(<Probe />);
    expect(screen.getByTestId('numeric').textContent).toBe('09/30/2026');
  });

  it("treats 'XX' and unknown codes as the system default", () => {
    const first = render(
      <DateFormatProvider countryCode="XX">
        <Probe />
      </DateFormatProvider>
    );
    expect(screen.getByTestId('numeric').textContent).toBe('09/30/2026');
    first.unmount();

    render(
      <DateFormatProvider countryCode="not-a-country">
        <Probe />
      </DateFormatProvider>
    );
    expect(screen.getByTestId('numeric').textContent).toBe('09/30/2026');
  });
});
