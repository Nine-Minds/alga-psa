/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// ──────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ──────────────────────────────────────────────────────────────────────────────
const createPricingScheduleMock = vi.hoisted(() => vi.fn());
const updatePricingScheduleMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/billing/actions/contractPricingScheduleActions', () => ({
  createPricingSchedule: async (...args: unknown[]) => createPricingScheduleMock(...args),
  updatePricingSchedule: async (...args: unknown[]) => updatePricingScheduleMock(...args),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useOptionalI18n: () => null,
  useTranslation: () => ({
    t: (key: string, fallback?: string | ({ defaultValue?: string } & Record<string, unknown>)) => {
      if (!fallback) return key;
      if (typeof fallback === 'string') return fallback;
      const base = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : key;
      return base.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name] ?? ''));
    },
  }),
  useFormatters: () => ({ locale: 'en-US' }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));

// Interactive stand-ins: the date and line-scope assertions below have to pick a
// value the way the user does. The date field speaks local calendar parts, like
// the real picker's own Date output.
vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: ({ id, value, onChange }: any) => (
    <input
      id={id}
      aria-label={id ?? 'date-picker'}
      value={value
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
        : ''}
      onChange={(e) => {
        const [year, month, day] = e.target.value.split('-').map(Number);
        onChange(new Date(year, month - 1, day));
      }}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, options, onValueChange, placeholder }: any) => (
    <select id={id} aria-label={id} value={value ?? ''} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">{placeholder ?? ''}</option>
      {(options ?? []).map((option: any) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/SwitchWithLabel', () => ({
  SwitchWithLabel: ({ label, checked, onCheckedChange }: any) => (
    <label>
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

// The global test setup mocks useAutomationIdAndRegister with empty automation
// props, which strips `id` from the real Input; stub it so #custom-rate resolves.
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ id, ...props }: any) => <input id={id} {...props} />,
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: () => <div data-testid="rate-symbol-skeleton" />,
}));

import type { IContractPricingSchedule } from '@alga-psa/types';
import { CurrencyFormatProvider } from '@alga-psa/ui/lib';
import type { PricingScheduleLineScope } from '@alga-psa/billing/actions/contractPricingScheduleActions';
import { PricingScheduleDialog } from './PricingScheduleDialog';

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

function schedule(overrides: Partial<IContractPricingSchedule> = {}): IContractPricingSchedule {
  return {
    tenant: 'tenant-1',
    schedule_id: 'schedule-1',
    contract_id: 'contract-1',
    contract_line_id: 'line-1',
    effective_date: '2026-01-01',
    custom_rate: 12345,
    ...overrides,
  };
}

const fixedLine = (id: string, name: string, overrides: Partial<PricingScheduleLineScope> = {}): PricingScheduleLineScope => ({
  contract_line_id: id,
  contract_line_name: name,
  has_bundle_fee: true,
  has_unit_priced_members: false,
  ...overrides,
});

const ONE_LINE = [fixedLine('line-1', 'Managed Services')];

function renderDialog(props: {
  schedule: IContractPricingSchedule | null;
  currencyCode?: string;
  ambientCurrency?: string;
  eligibleLines?: PricingScheduleLineScope[];
  currentLineName?: string;
  unitPricedLineCount?: number;
}) {
  const onClose = vi.fn();
  const onSave = vi.fn();
  const tree = () => (
    <CurrencyFormatProvider currencyCode={props.ambientCurrency ?? 'USD'}>
      <PricingScheduleDialog
        contractId="contract-1"
        schedule={props.schedule}
        currencyCode={props.currencyCode}
        eligibleLines={props.eligibleLines ?? ONE_LINE}
        currentLineName={props.currentLineName}
        unitPricedLineCount={props.unitPricedLineCount}
        onClose={onClose}
        onSave={onSave}
      />
    </CurrencyFormatProvider>
  );
  const utils = render(tree());
  return { ...utils, onClose, onSave };
}

function rateInput(): HTMLInputElement {
  return document.getElementById('custom-rate') as HTMLInputElement;
}

function dateInput(id: 'effective-date' | 'end-date'): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

function linePicker(): HTMLSelectElement {
  return document.getElementById('pricing-schedule-contract-line') as HTMLSelectElement;
}

function submitForm() {
  fireEvent.submit(document.getElementById('pricing-schedule-form') as HTMLFormElement);
}

describe('PricingScheduleDialog contract-currency custom rate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPricingScheduleMock.mockResolvedValue(schedule());
    updatePricingScheduleMock.mockResolvedValue(schedule());
  });

  afterEach(() => {
    cleanup();
  });

  it('renders and submits a two-decimal non-default currency (EUR) in contract minor units', async () => {
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 12345 }),
      currencyCode: 'EUR',
    });

    const input = rateInput();
    expect(input.value).toBe('123.45');
    expect(input).toHaveAttribute('step', '0.01');
    expect(screen.getByText('€')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '150.5' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ custom_rate: 15050 })
    );
  });

  it('round-trips a zero-decimal currency (JPY) without a x100 conversion', async () => {
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 5000 }),
      currencyCode: 'JPY',
    });

    const input = rateInput();
    expect(input.value).toBe('5000');
    expect(input).toHaveAttribute('step', '1');
    expect(input).toHaveAttribute('placeholder', '0');
    expect(screen.getByText('¥')).toBeInTheDocument();

    // Save without touching the rate: stored minor units must survive unchanged.
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ custom_rate: 5000 })
    );
  });

  it('switching back to the default rate submits an explicit custom_rate null', async () => {
    const { onSave } = renderDialog({
      schedule: schedule({ custom_rate: 12345 }),
      currencyCode: 'EUR',
    });

    fireEvent.click(screen.getByLabelText('Use default rate'));
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [scheduleId, payload] = updatePricingScheduleMock.mock.calls[0];
    expect(scheduleId).toBe('schedule-1');
    // null, not undefined — Knex drops undefined keys from updates, which
    // silently kept the old rate.
    expect(payload.custom_rate).toBeNull();
  });

});

// effective_date/end_date are DATE columns and a schedule applies to a whole
// service period, so a day stored early reprices an extra period. The day
// picked has to be the day sent, east and west of UTC alike.
describe('PricingScheduleDialog calendar dates', () => {
  const originalTz = process.env.TZ;

  // Offset of each zone on the fixture date (June 2026, so DST is already in
  // the number): Berlin UTC+2, Auckland UTC+12, Los Angeles UTC-7.
  const ZONE_OFFSETS: Record<string, number> = {
    'Europe/Berlin': -120,
    'Pacific/Auckland': -720,
    'America/Los_Angeles': 420,
  };

  /**
   * Pin the process zone and prove Node honoured it — without the offset guard
   * these cases would pass vacuously if setting TZ ever stopped taking effect.
   */
  function useTimeZone(zone: string) {
    process.env.TZ = zone;
    expect(
      new Date('2026-06-01T12:00:00.000Z').getTimezoneOffset(),
      `TZ=${zone} did not take effect`,
    ).toBe(ZONE_OFFSETS[zone]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    createPricingScheduleMock.mockResolvedValue(schedule());
    updatePricingScheduleMock.mockResolvedValue(schedule());
  });

  afterEach(() => {
    // TZ is process-global and vitest isolation is module-level only: assigning
    // an undefined original would set the literal string "undefined", a bogus
    // zone that leaks into every later file in the same worker.
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
    cleanup();
  });

  it.each(['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'])(
    'sends the picked effective date as a calendar date under TZ=%s',
    async (timeZone) => {
      useTimeZone(timeZone);
      const { onSave } = renderDialog({ schedule: null });

      fireEvent.change(linePicker(), { target: { value: 'line-1' } });
      fireEvent.change(dateInput('effective-date'), { target: { value: '2026-06-01' } });
      submitForm();

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(createPricingScheduleMock).toHaveBeenCalledWith(
        expect.objectContaining({ effective_date: '2026-06-01', end_date: null })
      );
    }
  );

  it.each(['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'])(
    'sends the picked end date as a calendar date under TZ=%s',
    async (timeZone) => {
      useTimeZone(timeZone);
      const { onSave } = renderDialog({ schedule: null });

      fireEvent.change(linePicker(), { target: { value: 'line-1' } });
      fireEvent.change(dateInput('effective-date'), { target: { value: '2026-06-01' } });
      fireEvent.click(screen.getByLabelText('Has end date'));
      fireEvent.change(dateInput('end-date'), { target: { value: '2026-12-31' } });
      submitForm();

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(createPricingScheduleMock).toHaveBeenCalledWith(
        expect.objectContaining({ effective_date: '2026-06-01', end_date: '2026-12-31' })
      );
    }
  );

  it.each(['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'])(
    'round-trips a stored calendar date through the edit form under TZ=%s',
    async (timeZone) => {
      useTimeZone(timeZone);
      const { onSave } = renderDialog({
        schedule: schedule({ effective_date: '2026-06-01', end_date: '2026-12-31' }),
      });

      expect(dateInput('effective-date').value).toBe('2026-06-01');
      expect(dateInput('end-date').value).toBe('2026-12-31');

      submitForm();

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(updatePricingScheduleMock).toHaveBeenCalledWith(
        'schedule-1',
        expect.objectContaining({ effective_date: '2026-06-01', end_date: '2026-12-31' })
      );
    }
  );

  it.each(['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles'])(
    'round-trips a DATE column read back as a UTC-midnight Date under TZ=%s',
    async (timeZone) => {
      useTimeZone(timeZone);
      // What the pg driver + server-action payload hand back for a DATE column
      // from a UTC server process.
      const stored = new Date('2026-06-01T00:00:00.000Z') as unknown as string;
      const { onSave } = renderDialog({ schedule: schedule({ effective_date: stored }) });

      expect(dateInput('effective-date').value).toBe('2026-06-01');

      submitForm();

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(updatePricingScheduleMock).toHaveBeenCalledWith(
        'schedule-1',
        expect.objectContaining({ effective_date: '2026-06-01' })
      );
    }
  );
});

describe('PricingScheduleDialog scope', () => {
  const TWO_LINES = [fixedLine('line-1', 'Managed Services'), fixedLine('line-2', 'Backup')];

  beforeEach(() => {
    vi.clearAllMocks();
    createPricingScheduleMock.mockResolvedValue(schedule());
    updatePricingScheduleMock.mockResolvedValue(schedule());
  });

  afterEach(() => {
    cleanup();
  });

  it('offers only eligible lines, requiring a choice when several exist', () => {
    renderDialog({ schedule: null, eligibleLines: TWO_LINES });

    expect(linePicker().value).toBe('');
    expect([...linePicker().options].map((option) => option.textContent)).toEqual([
      'Select a fixed-fee line',
      'Managed Services',
      'Backup',
    ]);
  });

  it('saves a new schedule scoped to the picked line', async () => {
    const { onSave } = renderDialog({ schedule: null, eligibleLines: TWO_LINES });

    fireEvent.change(dateInput('effective-date'), { target: { value: '2026-06-01' } });
    fireEvent.change(linePicker(), { target: { value: 'line-2' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(createPricingScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-2' })
    );
  });

  it('preselects the only eligible line for a new schedule', async () => {
    const { onSave } = renderDialog({ schedule: null });

    expect(linePicker().value).toBe('line-1');
    fireEvent.change(dateInput('effective-date'), { target: { value: '2026-06-01' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(createPricingScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-1' })
    );
  });

  it('requires a line choice when several lines are eligible', async () => {
    renderDialog({ schedule: null, eligibleLines: TWO_LINES });

    expect(linePicker().value).toBe('');

    fireEvent.change(dateInput('effective-date'), { target: { value: '2026-06-01' } });
    submitForm();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Choose a fixed-fee line for this schedule'
    );
    expect(createPricingScheduleMock).not.toHaveBeenCalled();

    fireEvent.change(linePicker(), { target: { value: 'line-1' } });
    submitForm();

    await waitFor(() => expect(createPricingScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({ contract_line_id: 'line-1' })
    ));
  });

  it('opens a stored whole-contract schedule on that scope and says what it bills', () => {
    renderDialog({
      schedule: schedule({ contract_line_id: null, custom_rate: 90000 }),
      eligibleLines: TWO_LINES,
    });

    expect(linePicker().value).toBe('');
    expect(linePicker().options[0].textContent).toBe('Whole contract');
    expect(
      screen.getByRole('alert')
    ).toHaveTextContent('each of the 2 fixed-fee lines bills $900.00 per billing period');
  });

  it('keeps a whole-contract schedule whole-contract when the picker is untouched', async () => {
    const { onSave } = renderDialog({
      schedule: schedule({ contract_line_id: null, custom_rate: 90000 }),
      eligibleLines: TWO_LINES,
    });

    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ contract_line_id: null })
    );
  });

  it('re-scopes a whole-contract schedule to a line', async () => {
    const { onSave } = renderDialog({
      schedule: schedule({ contract_line_id: null, custom_rate: 90000 }),
      eligibleLines: TWO_LINES,
    });

    fireEvent.change(linePicker(), { target: { value: 'line-2' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ contract_line_id: 'line-2' })
    );
  });

  it('does not offer whole-contract scope when editing a line schedule', () => {
    renderDialog({
      schedule: schedule({ contract_line_id: 'line-1', custom_rate: 90000 }),
      eligibleLines: TWO_LINES,
    });

    expect(linePicker().value).toBe('line-1');
    expect([...linePicker().options].map((option) => option.value)).toEqual(['', 'line-1', 'line-2']);
    expect(screen.queryByText('Whole contract')).not.toBeInTheDocument();
  });

  it('disables create when no line can be repriced, and says where to change the price', () => {
    renderDialog({ schedule: null, eligibleLines: [], unitPricedLineCount: 1 });

    expect(screen.queryByLabelText('pricing-schedule-contract-line')).toBeNull();
    expect(
      screen.getByText(/Lines that bill per unit are not listed/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Change the unit price on the line instead/)).toBeInTheDocument();
    expect(
      (screen.getByText('Add Schedule').closest('button') as HTMLButtonElement)
    ).toBeDisabled();
  });

  it.each([
    { eligibleLines: [] },
    { eligibleLines: [fixedLine('line-2', 'Backup')] },
  ])('shows the stored ineligible binding with $eligibleLines', async ({ eligibleLines }) => {
    // The line the row is scoped to now bills per unit, so it is not offered
    // any more — the row's dates still have to be correctable, and saving keeps
    // the scope it was stored with.
    const { onSave } = renderDialog({
      schedule: schedule({ contract_line_id: 'line-1', effective_date: '2026-01-01' }),
      eligibleLines,
      currentLineName: 'Managed Services',
      unitPricedLineCount: 1,
    });

    expect(linePicker()).toHaveDisplayValue('Managed Services');
    expect(screen.getByRole('option', { name: 'Managed Services' })).toBeDisabled();
    expect(
      (screen.getByText('Update Schedule').closest('button') as HTMLButtonElement)
    ).not.toBeDisabled();

    fireEvent.change(dateInput('effective-date'), { target: { value: '2026-02-01' } });
    submitForm();

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1',
      expect.objectContaining({ contract_line_id: 'line-1', effective_date: '2026-02-01' })
    );
  });

  it('lets an existing ineligible binding be changed to an eligible line', async () => {
    renderDialog({
      schedule: schedule(),
      currentLineName: 'Managed Services',
      eligibleLines: [fixedLine('line-2', 'Backup')],
    });

    expect(linePicker()).toHaveDisplayValue('Managed Services');
    fireEvent.change(linePicker(), { target: { value: 'line-2' } });
    expect(linePicker()).toHaveDisplayValue('Backup');
    submitForm();

    await waitFor(() => expect(updatePricingScheduleMock).toHaveBeenCalledWith(
      'schedule-1', expect.objectContaining({ contract_line_id: 'line-2' })
    ));
  });

  it('never offers an ineligible binding for a new schedule', () => {
    renderDialog({
      schedule: null,
      currentLineName: 'Managed Services',
      eligibleLines: [fixedLine('line-2', 'Backup')],
    });

    expect(linePicker()).toHaveDisplayValue('Backup');
    expect(screen.queryByRole('option', { name: 'Managed Services' })).not.toBeInTheDocument();
  });

  it('notes the unit-priced lines left out of the picker', () => {
    renderDialog({ schedule: null, unitPricedLineCount: 2 });

    expect([...linePicker().options].map((option) => option.value)).toEqual(['', 'line-1']);
    expect(
      screen.getByText(/Lines that bill per unit are not listed/)
    ).toBeInTheDocument();
  });

  it('says the schedule replaces the bundle fee only on a mixed line', () => {
    renderDialog({
      schedule: schedule({ contract_line_id: 'line-1' }),
      eligibleLines: [fixedLine('line-1', 'Managed Services', { has_unit_priced_members: true })],
    });

    expect(
      screen.getByText(/Replaces the bundle fee of this line/)
    ).toBeInTheDocument();
  });
});
