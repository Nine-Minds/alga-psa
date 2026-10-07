// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DateFormatProvider, useDateFormat } from '@alga-psa/ui/lib/dateFormat/useDateFormat';
import { toCalendarDateString, toCalendarDisplayDate } from '@alga-psa/core';
import { formatDateValue } from '@alga-psa/ui/lib/i18n/formatDateValue';

// Acceptance test for the effective-date discard prompt. The REAL DatePicker and
// ConfirmationDialog are used; only the server actions and the i18n/formatter
// hooks (backed by the real English pack and the tenant's AU date format) are
// replaced. DatePicker commits on blur, Enter or a day click, so every typed
// date is followed by a blur.

const enContracts = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../server/public/locales/en/msp/contracts.json'), 'utf8'),
);

const actions = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), preview: vi.fn(), revisions: vi.fn(), history: vi.fn(), resolve: vi.fn() }));
vi.mock('@alga-psa/billing/actions/contractLineUnitPricingActions', () => ({
  getEffectiveRecurringUnitPricing: actions.read,
  scheduleRecurringUnitPricingRevision: actions.save,
  listRecurringUnitPricingRevisions: actions.revisions,
  listRecurringUnitPricingRevisionHistory: actions.history,
  resolveRecurringUnitMidPeriod: actions.resolve,
}));
vi.mock('@alga-psa/billing/actions/contractLineSemanticsActions', () => ({ getNextContractServiceBoundary: async () => '2027-01-01' }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({ previewRecurringRevisionInvoiceImpact: actions.preview }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const interpolate = (text: string, options: Record<string, unknown>) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => String(options[key]));
  const lookup = (key: string): string | undefined => {
    const value = key.split('.').reduce<any>((node, part) => (node && typeof node === 'object' ? node[part] : undefined), enContracts);
    return typeof value === 'string' ? value : undefined;
  };
  return {
    // DatePicker calls t(key, 'fallback'); the panel calls t(key, { defaultValue, ...vars }).
    useTranslation: () => ({
      t: (key: string, second?: string | Record<string, unknown>) => {
        const options = typeof second === 'object' && second ? second : {};
        const fallback = typeof second === 'string' ? second : (options.defaultValue as string | undefined);
        return interpolate(lookup(key) ?? fallback ?? key, options);
      },
    }),
    useOptionalI18n: () => ({ locale: 'en' }),
    useFormatters: () => {
      const dateFormat = useDateFormat();
      return {
        formatCurrency: (amount: number) => `$${amount.toFixed(2)}`,
        formatDate: (value: string) => formatDateValue(value, 'en', undefined, dateFormat),
      };
    },
  };
});

import { RecurringUnitSchedulePanel } from '../src/components/billing-dashboard/contracts/RecurringUnitSchedulePanel';

const ORIGINAL_DATE_TEXT = '01/01/2027';
const NEW_DATE_TEXT = '16/01/2027';

const effectiveFor = (servicePeriodStart: string) => ({
  quantity: servicePeriodStart === '2027-01-16' ? 30 : 20,
  pricePolicy: 'override', unitRateCents: 12000, resolvedUnitRateCents: 12000, catalogUnitRateCents: 10000,
  baselineQuantity: 20, baselineUnitRateCents: 10000, currencyCode: 'USD',
  coveredStart: servicePeriodStart, coveredEnd: '2027-02-01',
});

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  confirmSpy = vi.spyOn(window, 'confirm');
  actions.read.mockImplementation(async (args: { service_period_start: string }) => effectiveFor(args.service_period_start));
  actions.save.mockResolvedValue({ revision_id: 'revision', version: 1 });
  actions.revisions.mockResolvedValue([]);
  actions.history.mockResolvedValue([]);
});

afterEach(() => {
  // The native prompt is gone for good: nothing in any path may call it.
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

const dateField = () => document.querySelector('#recurring-effective-config') as HTMLInputElement;
const quantityField = () => document.querySelector('#recurring-quantity-config') as HTMLInputElement;
const dialogTitle = () => screen.queryByText('Discard unsaved edit?');

async function mount() {
  render(
    <DateFormatProvider countryCode="AU">
      <RecurringUnitSchedulePanel contractLineId="line" serviceId="service" configId="config" currencyCode="USD" />
    </DateFormatProvider>,
  );
  await waitFor(() => expect(quantityField()?.value).toBe('20'));
  expect(dateField().value).toBe(ORIGINAL_DATE_TEXT);
  expect(actions.read).toHaveBeenCalledTimes(1);
}

const editQuantity = () => fireEvent.change(quantityField(), { target: { value: '25' } });
const pickTypedDate = (text: string) => {
  fireEvent.focus(dateField());
  fireEvent.change(dateField(), { target: { value: text } });
  fireEvent.blur(dateField());
};

describe('Recurring unit schedule panel: discard prompt on effective-date change', () => {
  it('dirty + Cancel keeps the edit and the original date and reloads nothing', async () => {
    await mount();
    editQuantity();
    pickTypedDate(NEW_DATE_TEXT);

    await screen.findByText('Discard unsaved edit?');
    // Rendered once visibly and once as the dialog's screen-reader description.
    expect(screen.getAllByText(/Changing the effective date reloads the values in force and discards your unsaved edit/).length).toBeGreaterThan(0);
    expect(document.querySelector('#recurring-discard-dirty-config-confirm')!.textContent).toBe('Discard and reload');

    fireEvent.click(document.querySelector('#recurring-discard-dirty-config-close')!);

    await waitFor(() => expect(dialogTitle()).toBeNull());
    expect(actions.read).toHaveBeenCalledTimes(1);
    expect(quantityField().value).toBe('25');
    // The picker kept the rejected text until the reset key remounted it.
    expect(dateField().value).toBe(ORIGINAL_DATE_TEXT);

    fireEvent.click(screen.getByRole('button', { name: 'Schedule change' }));
    await waitFor(() => expect(actions.save).toHaveBeenCalledWith(expect.objectContaining({
      quantity: 25,
      effective_period_start: '2027-01-01',
    })));
  });

  it('dirty + Confirm discards the edit and reloads at the picked date', async () => {
    await mount();
    editQuantity();
    pickTypedDate(NEW_DATE_TEXT);

    await screen.findByText('Discard unsaved edit?');
    fireEvent.click(document.querySelector('#recurring-discard-dirty-config-confirm')!);

    await waitFor(() => expect(actions.read).toHaveBeenCalledTimes(2));
    expect(actions.read).toHaveBeenLastCalledWith(expect.objectContaining({ service_period_start: '2027-01-16' }));
    await waitFor(() => expect(quantityField().value).toBe('30'));
    expect(dateField().value).toBe(NEW_DATE_TEXT);
    expect(dialogTitle()).toBeNull();
  });

  it('a clean change reloads immediately without a prompt', async () => {
    await mount();
    pickTypedDate(NEW_DATE_TEXT);

    await waitFor(() => expect(actions.read).toHaveBeenCalledTimes(2));
    expect(actions.read).toHaveBeenLastCalledWith(expect.objectContaining({ service_period_start: '2027-01-16' }));
    expect(dialogTitle()).toBeNull();
    await waitFor(() => expect(quantityField().value).toBe('30'));
    expect(dateField().value).toBe(NEW_DATE_TEXT);
  });

  it('re-picking the current day while dirty is not a change', async () => {
    await mount();
    editQuantity();

    // Typing the same day: the picker itself does not commit.
    pickTypedDate(ORIGINAL_DATE_TEXT);
    // Clicking the same day in the calendar does commit, which the panel must ignore.
    fireEvent.focus(dateField());
    const dayButton = await waitFor(() => {
      const button = document.querySelector('td[data-day="2027-01-01"] button');
      expect(button).toBeTruthy();
      return button as HTMLButtonElement;
    });
    fireEvent.click(dayButton);

    expect(dialogTitle()).toBeNull();
    expect(actions.read).toHaveBeenCalledTimes(1);
    expect(quantityField().value).toBe('25');
    expect(dateField().value).toBe(ORIGINAL_DATE_TEXT);
  });
});

describe('Recurring unit schedule panel: picker date round trip', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // The picker works in local Dates; the wire value is a calendar day. Neither
  // direction may go through toISOString(), which shifts the day east of UTC.
  it.each(['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Pacific/Kiritimati'])(
    'keeps %s calendar days stable from ISO to picker Date and back',
    (tz) => {
      process.env.TZ = tz;
      for (const day of ['2027-01-01', '2027-01-16', '2027-03-28', '2027-10-31']) {
        expect(toCalendarDateString(toCalendarDisplayDate(day)!)).toBe(day);
      }
    },
  );
});
