/**
 * @vitest-environment jsdom
 *
 * Non-blocking defect #2: the effective-date field serialised a local calendar
 * date through `toISOString()`, which converts to UTC first. In a UTC+ tenant
 * the string sent one day EARLIER than the date the operator picked, moving the
 * price change (and the money) a day. This suite runs under UTC by default and
 * is also listed in the unit-tests workflow's non-UTC timezone step, where the
 * old implementation produces the wrong day.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const previewServicePriceChangeMock = vi.hoisted(() => vi.fn());

const tMock = vi.hoisted(() => (
  (key: string, options?: { defaultValue?: string; [token: string]: unknown }) => {
    let value = options?.defaultValue ?? key;
    for (const [token, replacement] of Object.entries(options ?? {})) {
      if (token !== 'defaultValue') {
        value = value.replace(`{{${token}}}`, String(replacement));
      }
    }
    return value;
  }
));

vi.mock('../../../actions/servicePriceRolloutActions', () => ({
  previewServicePriceChange: (...args: unknown[]) => previewServicePriceChangeMock(...args),
  applyServicePriceChange: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useTranslation: () => ({ t: tMock }),
    useFormatters: () => ({ formatDate: (value: unknown) => String(value) }),
  };
});

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value?: Date;
    onChange: (date: Date | undefined) => void;
  }) => (
    <input
      id={id}
      type="date"
      value={value
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
        : ''}
      onChange={(event) => onChange(event.target.value ? new Date(`${event.target.value}T00:00:00`) : undefined)}
    />
  ),
}));

import PriceChangeRolloutDialog, { toLocalCalendarDate } from './PriceChangeRolloutDialog';

const preview = {
  serviceId: 'svc-1',
  currency: 'USD',
  oldRateCents: 10000,
  newRateCents: 12000,
  effectiveDate: '2026-10-01',
  period: { start: '2026-10-01', end: '2026-11-01' },
  willChange: [],
  custom: [],
  unreviewed: [],
  excluded: [],
  totalMonthlyDeltaCents: 0,
};

describe('toLocalCalendarDate', () => {
  it('formats the local calendar date, not the UTC one', () => {
    // Local midnight on Oct 1. In a UTC+ zone the old `toISOString()` emitted
    // 2026-09-30 because local midnight had not yet reached UTC midnight.
    expect(toLocalCalendarDate(new Date(2026, 9, 1, 0, 0, 0))).toBe('2026-10-01');
    // Local midnight on Jan 1 (year/month boundaries).
    expect(toLocalCalendarDate(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01');
  });
});

describe('PriceChangeRolloutDialog effective date', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewServicePriceChangeMock.mockResolvedValue(preview);
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('sends the local calendar date the operator picked', async () => {
    render(
      <PriceChangeRolloutDialog
        isOpen
        onClose={() => {}}
        serviceId="svc-1"
        serviceName="Emerald City Security"
        newRateCents={12000}
        currency="USD"
        onApply={vi.fn()}
        onSkip={vi.fn()}
      />,
    );

    await waitFor(() => expect(previewServicePriceChangeMock).toHaveBeenCalled());

    const input = document.getElementById('price-change-effective-date') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-10-01' } });

    await waitFor(() => {
      const lastCall = previewServicePriceChangeMock.mock.calls.at(-1);
      expect(lastCall?.[2]).toBe('2026-10-01');
    });
  });
});
