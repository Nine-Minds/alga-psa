import { describe, expect, it } from 'vitest';
import {
  cadencePrepaidBlocksMonthlyCents,
  blockRatePerHourMinor,
  withIssueMode,
  defaultBlockPriceMinor,
  draftFromConfig,
  draftToInput,
  emptyPrepaidBlockDraft,
  hoursTextToMinutes,
  majorToMinor,
  minorToMajor,
  minutesToHoursText,
  emptyPrepaidBlockLineDraft,
  prepaidLineDraftFromSubmission,
  prepaidLineDraftsToSubmission,
} from '../src/components/billing-dashboard/contracts/prepaidBlockConfigDraft';

describe('prepaid block config draft helpers', () => {
  it('converts hours text to whole minutes, allowing fractions and a decimal comma', () => {
    expect(hoursTextToMinutes('40')).toBe(2400);
    expect(hoursTextToMinutes('1.5')).toBe(90);
    expect(hoursTextToMinutes('1,5')).toBe(90);
    expect(hoursTextToMinutes('0')).toBeNull();
    expect(hoursTextToMinutes('')).toBeNull();
    expect(hoursTextToMinutes('abc')).toBeNull();
    // 1/3 hour is not a whole number of minutes.
    expect(hoursTextToMinutes('0.3333333')).toBeNull();
    expect(minutesToHoursText(90)).toBe('1.5');
    expect(minutesToHoursText(2400)).toBe('40');
  });

  it('defaults the price to hours x the hourly rate in minor units but only when both are known', () => {
    expect(defaultBlockPriceMinor('40', 11000)).toBe(440000);
    expect(defaultBlockPriceMinor('1.5', 11000)).toBe(16500);
    expect(defaultBlockPriceMinor('40', undefined)).toBeUndefined();
    expect(defaultBlockPriceMinor('40', 0)).toBeUndefined();
    expect(defaultBlockPriceMinor('x', 11000)).toBeUndefined();
  });

  it('always submits the price explicitly, whether defaulted or typed', () => {
    const defaulted = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '40' }, 11000);
    expect(defaulted).toMatchObject({ input: { block_minutes: 2400, block_price: 440000 } });
    const typed = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '40', priceManual: true, priceMinor: 400000 }, 11000);
    expect(typed).toMatchObject({ input: { block_price: 400000 } });
    const free = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '2', priceManual: true, priceMinor: 0 }, undefined);
    expect(free).toMatchObject({ input: { block_price: 0 } });
  });

  it('reports every invalid field and forces trigger_on_expiry off without an expiry', () => {
    const bad = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '', expiryMonths: '121', thresholdPercent: '100' }, undefined);
    expect(bad).toEqual({ errors: ['hoursInvalid', 'priceInvalid', 'expiryInvalid', 'thresholdInvalid'] });
    const noExpiry = draftToInput({ ...emptyPrepaidBlockDraft(), hours: '10', expiryMonths: '', triggerOnExpiry: true }, 5000);
    expect(noExpiry).toMatchObject({ input: { expiry_months: null, trigger_on_expiry: false } });
  });

  it('round-trips a stored config and converts money by the currency fraction digits', () => {
    const draft = draftFromConfig({
      tenant: 't', contract_line_id: 'l', block_minutes: 90, block_price: 16500, sold_as_service_id: 's',
      expiry_months: null, trigger_on_exhaustion: true, trigger_threshold_percent: 80, trigger_on_expiry: false,
      trigger_on_renewal: true, replenishment_tier: 'auto_issue',
    } as any);
    expect(draft).toMatchObject({ hours: '1.5', priceMinor: 16500, priceManual: true, expiryMonths: '', thresholdPercent: '80', triggerOnRenewal: true });
    expect(draftToInput(draft, undefined)).toMatchObject({
      input: { block_minutes: 90, block_price: 16500, expiry_months: null, trigger_threshold_percent: 80, replenishment_tier: 'auto_issue' },
    });
    expect(minorToMajor(16500, 'EUR', 'en-US')).toBe(165);
    expect(majorToMinor(165, 'EUR', 'en-US')).toBe(16500);
    expect(minorToMajor(1650, 'JPY', 'en-US')).toBe(1650);
    expect(majorToMinor(1650, 'JPY', 'en-US')).toBe(1650);
  });
});

describe('prepaid block wizard line drafts', () => {
  const filled = () => {
    const line = emptyPrepaidBlockLineDraft();
    line.services = [{ service_id: 'svc-a', service_name: 'Remote', hourly_rate: 11000 }];
    line.block = { ...emptyPrepaidBlockDraft(), hours: '40' };
    return line;
  };

  it('drops lines with no picked service and reports no errors for them', () => {
    expect(prepaidLineDraftsToSubmission([emptyPrepaidBlockLineDraft()])).toEqual({ lines: [] });
    expect(prepaidLineDraftsToSubmission(undefined)).toEqual({ lines: [] });
  });

  it('converts a filled draft, defaulting the price to hours x the sold-as service rate in minor units', () => {
    const result = prepaidLineDraftsToSubmission([{ ...filled(), name: '  Support  ' }]);
    expect('lines' in result).toBe(true);
    if (!('lines' in result)) return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].name).toBe('Support');
    expect(result.lines[0].services).toEqual([{ service_id: 'svc-a', service_name: 'Remote', hourly_rate: 11000 }]);
    expect(result.lines[0].block).toMatchObject({ block_minutes: 2400, block_price: 440000 });
  });

  it('reports draft error codes by line index when a line with services has an invalid block', () => {
    const bad = filled();
    bad.block = { ...bad.block, hours: '' };
    const result = prepaidLineDraftsToSubmission([filled(), bad]);
    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors.map((e) => e.lineIndex)).toEqual([1]);
    expect(result.errors[0].codes.length).toBeGreaterThan(0);
  });

  it('round-trips a submission entry through a draft', () => {
    const entry = {
      name: 'Block',
      services: [{ service_id: 'svc-a', hourly_rate: 11000 }],
      block: {
        block_minutes: 90, block_price: 16500, sold_as_service_id: 'svc-a', expiry_months: 6,
        trigger_on_exhaustion: true, trigger_threshold_percent: 25, trigger_on_expiry: false,
        trigger_on_renewal: true, replenishment_tier: 'auto_issue' as const,
      },
    };
    const result = prepaidLineDraftsToSubmission([prepaidLineDraftFromSubmission(entry)]);
    expect(result).toEqual({ lines: [{ ...entry, services: [{ service_id: 'svc-a', service_name: undefined, hourly_rate: 11000 }] }] });
  });
  describe('cadence (every billing period) blocks', () => {
    const cadence = (patch = {}) => ({
      ...withIssueMode({ ...emptyPrepaidBlockDraft(), hours: '40', priceMinor: 400000, priceManual: true }, 'cadence'),
      ...patch,
    });

    it('sends the cadence fields and never the consumption triggers or expiry', () => {
      const result = draftToInput(cadence({ rolloverPeriods: '2' }), undefined);
      expect(result).toEqual({
        input: {
          issue_mode: 'cadence', rollover_periods: 2, block_minutes: 2400, block_price: 400000,
          sold_as_service_id: null, expiry_months: null, trigger_on_exhaustion: false,
          trigger_threshold_percent: null, trigger_on_expiry: false, trigger_on_renewal: false,
          replenishment_tier: 'draft',
        },
      });
    });

    it('rejects a rollover outside 0..12 and a non-integer rollover', () => {
      for (const bad of ['13', '-1', '1.5', 'x']) {
        expect(draftToInput(cadence({ rolloverPeriods: bad }), undefined)).toEqual({ errors: ['rolloverInvalid'] });
      }
      expect(draftToInput(cadence({ rolloverPeriods: '12' }), undefined)).toHaveProperty('input');
    });

    it('resets the other mode\'s fields on a mode switch, in both directions', () => {
      const consumption = { ...emptyPrepaidBlockDraft(), hours: '10', expiryMonths: '6', thresholdPercent: '20', triggerOnRenewal: true };
      const toCadence = withIssueMode(consumption, 'cadence');
      expect(toCadence).toMatchObject({
        issueMode: 'cadence', expiryMonths: '', thresholdPercent: '', triggerOnExhaustion: false,
        triggerOnExpiry: false, triggerOnRenewal: false, hours: '10',
      });
      const back = withIssueMode({ ...toCadence, rolloverPeriods: '3' }, 'consumption');
      expect(back).toMatchObject({ issueMode: 'consumption', rolloverPeriods: '0', expiryMonths: '12', triggerOnExhaustion: true });
      expect(withIssueMode(consumption, 'consumption')).toBe(consumption);
    });

    it('computes price / hours in minor units, rounded once', () => {
      expect(blockRatePerHourMinor('40', 400000)).toBe(10000);
      expect(blockRatePerHourMinor('3', 10000)).toBe(3333);
      expect(blockRatePerHourMinor('1.5', 16500)).toBe(11000);
      expect(blockRatePerHourMinor('', 400000)).toBeUndefined();
      expect(blockRatePerHourMinor('40', undefined)).toBeUndefined();
    });

    it('round-trips a cadence config through a draft', () => {
      const draft = draftFromConfig({
        issue_mode: 'cadence', rollover_periods: 1, block_minutes: 600, block_price: 90000, sold_as_service_id: 'svc-a',
        expiry_months: null, trigger_on_exhaustion: false, trigger_threshold_percent: null,
        trigger_on_expiry: false, trigger_on_renewal: false, replenishment_tier: 'draft',
      } as never);
      expect(draft).toMatchObject({ issueMode: 'cadence', rolloverPeriods: '1', hours: '10', priceMinor: 90000 });
    });
  });

  describe('cadencePrepaidBlocksMonthlyCents', () => {
    const cadenceLine = (hours: string, priceMinor: number) => ({
      services: [{ service_id: 's1', hourly_rate: 15000 }],
      block: { ...withIssueMode(emptyPrepaidBlockDraft(), 'cadence'), hours, priceManual: true, priceMinor },
    });

    it('adds the block price of cadence lines, scaled like the fixed fees', () => {
      expect(cadencePrepaidBlocksMonthlyCents([cadenceLine('10', 150000)], 'monthly')).toBe(150000);
      expect(cadencePrepaidBlocksMonthlyCents([cadenceLine('10', 150000)], 'quarterly')).toBe(50000);
      expect(cadencePrepaidBlocksMonthlyCents([cadenceLine('10', 150000)], 'annually')).toBe(12500);
      expect(cadencePrepaidBlocksMonthlyCents([cadenceLine('10', 150000), cadenceLine('5', 70000)], 'monthly')).toBe(220000);
    });

    it('ignores consumption blocks, lines without a service and drafts that do not validate', () => {
      const consumption = { ...cadenceLine('10', 150000), block: { ...emptyPrepaidBlockDraft(), hours: '10', priceManual: true, priceMinor: 150000 } };
      const noService = { ...cadenceLine('10', 150000), services: [{ service_id: '' }] };
      expect(cadencePrepaidBlocksMonthlyCents([consumption, noService, cadenceLine('', 150000)], 'monthly')).toBe(0);
    });
  });
});
