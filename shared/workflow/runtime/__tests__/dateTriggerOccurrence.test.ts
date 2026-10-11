import { describe, expect, it } from 'vitest';

import {
  DATE_TRIGGER_OCCURRENCE_RULES,
  addDaysToIsoDate,
  computeDateTriggerFireDate,
  deriveDateTriggerTiming,
  nextAnnualOccurrenceOnOrAfter,
} from '../dateTriggerOccurrence';
import { dateTriggerPayloadSchemaRefs, dateTriggerPayloadSchemas } from '../schemas/dateTriggerPayloadSchemas';

describe('date trigger occurrence', () => {
  it('fires on the occurrence date plus the offset: "30 days before" is -30', () => {
    expect(computeDateTriggerFireDate('2026-12-08', -30)).toBe('2026-11-08');
    expect(computeDateTriggerFireDate('2026-12-08', 30)).toBe('2027-01-07');
    expect(computeDateTriggerFireDate('2026-12-08', 0)).toBe('2026-12-08');
    expect(addDaysToIsoDate('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDaysToIsoDate('not a date', 1)).toBeNull();
  });

  it('finds the next anniversary like the scheduler: never the first-year date, Feb 29 on Feb 28', () => {
    expect(nextAnnualOccurrenceOnOrAfter('2020-02-29', '2025-01-15')).toEqual({ occursOn: '2025-02-28', years: 5 });
    expect(nextAnnualOccurrenceOnOrAfter('2019-06-01', '2026-10-03')).toEqual({ occursOn: '2027-06-01', years: 8 });
    expect(nextAnnualOccurrenceOnOrAfter('2026-05-01', '2026-10-03')).toEqual({ occursOn: '2027-05-01', years: 1 });
  });

  it('has a rule for every date source', () => {
    expect(Object.keys(DATE_TRIGGER_OCCURRENCE_RULES).sort()).toEqual(Object.keys(dateTriggerPayloadSchemaRefs).sort());
  });

  it('derives a payload the schema accepts, for each source, from the picked record', () => {
    const today = '2026-10-03';
    const cases = [
      {
        source: 'contract.end' as const,
        record: { end_date: '2026-12-08T00:00:00.000Z' },
        payload: { contractId: 'c1', clientId: 'cl1' },
        expected: { occursOn: '2026-12-08', endDate: '2026-12-08', offsetDays: -30, fireDate: '2026-11-08' },
      },
      {
        source: 'contract.renewal_decision' as const,
        record: { decision_due_date: '2026-11-01', end_date: '2026-12-31', renewal_mode: 'manual' },
        payload: { contractId: 'c1', clientId: 'cl1' },
        expected: { occursOn: '2026-11-01', decisionDueDate: '2026-11-01', renewalMode: 'manual', fireDate: '2026-10-02' },
      },
      {
        source: 'client.anniversary' as const,
        record: { client_since: '2019-06-01' },
        payload: { clientId: 'cl1', clientName: 'Acme' },
        expected: { occursOn: '2027-06-01', yearsAsClient: 8, anniversarySource: 'client_since', fireDate: '2027-05-02' },
      },
      {
        source: 'asset.warranty_end' as const,
        record: { warranty_end_date: '2027-01-15' },
        payload: { assetId: 'a1' },
        expected: { occursOn: '2027-01-15', warrantyEndDate: '2027-01-15', fireDate: '2026-12-16' },
      },
    ];
    for (const testCase of cases) {
      const timing = deriveDateTriggerTiming({ source: testCase.source, offsetDays: -30, payload: testCase.payload, record: testCase.record, today });
      expect(timing).toMatchObject(testCase.expected);
      const schema = dateTriggerPayloadSchemas[dateTriggerPayloadSchemaRefs[testCase.source]];
      expect(schema.safeParse({ ...testCase.payload, ...timing }).success).toBe(true);
    }
  });

  it('uses the payload\'s own date when no record is picked, and leaves dates out when there is none', () => {
    expect(deriveDateTriggerTiming({ source: 'contract.end', offsetDays: 7, payload: { endDate: '2026-12-08' }, today: '2026-10-03' }))
      .toEqual({ occursOn: '2026-12-08', fireDate: '2026-12-15', offsetDays: 7 });
    expect(deriveDateTriggerTiming({ source: 'contract.end', offsetDays: -30, payload: {}, record: { end_date: null }, today: '2026-10-03' }))
      .toEqual({ offsetDays: -30 });
  });
});
