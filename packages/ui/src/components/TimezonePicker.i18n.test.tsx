/** @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TimezonePicker from './TimezonePicker';
import { DateFormatProvider } from '../lib/dateFormat/useDateFormat';

let mockLanguage = 'en';

vi.mock('../lib/i18n/client', () => ({
  useOptionalI18n: () => ({ locale: mockLanguage }),
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: mockLanguage },
  }),
}));

/**
 * The collapsed picker shows a live preview clock beside the selected zone.
 * That clock used to be built straight from the language tag, so a German UI
 * rendered 15:04 where an Australian tenant writes 3:04 PM — the language
 * deciding a pattern, which is exactly what the country rule forbids.
 */
function renderPicker(countryCode: string, language: string) {
  mockLanguage = language;
  return render(
    <DateFormatProvider countryCode={countryCode}>
      <TimezonePicker value="Australia/Sydney" onValueChange={vi.fn()} />
    </DateFormatProvider>
  );
}

describe('TimezonePicker preview clock', () => {
  afterEach(() => {
    cleanup();
    mockLanguage = 'en';
  });

  it('takes the 12/24h clock from the country, not the language', () => {
    // AU is a 12-hour country: both languages must render an am/pm clock.
    for (const language of ['en', 'de']) {
      renderPicker('AU', language);
      const label = screen.getByRole('button').textContent ?? '';
      expect(label).toMatch(/\d{1,2}:\d{2}\s?(AM|PM|am|pm)/i);
      cleanup();
    }
  });

  it('renders a 24h clock for a 24h country even under English', () => {
    // DE is a 24-hour country: English must not reintroduce am/pm.
    renderPicker('DE', 'en');
    const label = screen.getByRole('button').textContent ?? '';
    expect(label).not.toMatch(/(AM|PM)/i);
    expect(label).toMatch(/\d{1,2}:\d{2}/);
  });

  it('falls back to the system default clock for an unknown country', () => {
    // XX is the placeholder country: the fixed US-style default is 12h.
    renderPicker('XX', 'de');
    const label = screen.getByRole('button').textContent ?? '';
    expect(label).toMatch(/\d{1,2}:\d{2}\s?(AM|PM|am|pm)/i);
  });

  it('still names the timezone in the reading language', () => {
    // The zone NAME is a name, so it stays the language's job.
    renderPicker('AU', 'de');
    expect(screen.getByRole('button').textContent).toContain('Australia/Sydney');
  });
});
