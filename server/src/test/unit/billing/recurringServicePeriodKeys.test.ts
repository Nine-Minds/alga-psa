import { describe, expect, it } from 'vitest';
import {
  buildRecurringServicePeriodScheduleKey,
  canonicalizeRecurringServicePeriodScheduleKey,
  parseRecurringServicePeriodScheduleKey,
} from '@alga-psa/shared/billingClients/recurringServicePeriodKeys';

const T = '11111111-1111-4111-8111-111111111111';
const O = '22222222-2222-4222-8222-222222222222';
const canonical = `schedule:${T}:${O}:client:arrears`;

describe('recurring service period schedule keys', () => {
  it('builds the canonical five-segment key', () => {
    expect(buildRecurringServicePeriodScheduleKey({ tenant: T, obligationId: O, cadenceOwner: 'client', duePosition: 'arrears' })).toBe(canonical);
  });

  it('parses the canonical key', () => {
    expect(parseRecurringServicePeriodScheduleKey(canonical)).toMatchObject({
      tenant: T, obligationId: O, cadenceOwner: 'client', duePosition: 'arrears', scheduleKey: canonical,
    });
  });

  it.each(['contract_line', 'client_contract_line', 'template_line', 'preset_line'])(
    'accepts the legacy %s key and canonicalizes it',
    (label) => {
      const legacy = `schedule:${T}:${label}:${O}:client:arrears`;
      expect(parseRecurringServicePeriodScheduleKey(legacy)?.scheduleKey).toBe(canonical);
      expect(canonicalizeRecurringServicePeriodScheduleKey(legacy)).toBe(canonical);
    },
  );

  it('leaves canonical keys untouched and rejects unresolved or garbage keys', () => {
    expect(canonicalizeRecurringServicePeriodScheduleKey(canonical)).toBe(canonical);
    expect(parseRecurringServicePeriodScheduleKey(`schedule:${T}:unresolved:time:${O}`)).toBeNull();
    expect(parseRecurringServicePeriodScheduleKey(`schedule:${T}:${O}:bogus:arrears`)).toBeNull();
    expect(parseRecurringServicePeriodScheduleKey(`schedule:${T}:${O}:client:whenever`)).toBeNull();
    expect(parseRecurringServicePeriodScheduleKey(`schedule:${T}:weird_label:${O}:client:arrears`)).toBeNull();
    expect(parseRecurringServicePeriodScheduleKey('nonsense')).toBeNull();
    expect(canonicalizeRecurringServicePeriodScheduleKey('nonsense')).toBe('nonsense');
  });
});
