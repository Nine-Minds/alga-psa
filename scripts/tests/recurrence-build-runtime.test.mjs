// Run after building shared: npm run test:recurrence-build --workspace @alga-psa/shared
// Native Node loading exercises package resolution that Vitest transpiles away.
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateOccurrences, RecurrenceOccurrenceLimitError } from '@alga-psa/shared/utils/recurrenceUtils';

const entry = {
  is_all_day: true,
  scheduled_start: new Date('2025-01-01T00:00:00Z'),
  scheduled_end: new Date('2025-01-02T00:00:00Z'),
  recurrence_pattern: { frequency: 'daily', interval: 1, startDate: '2025-01-01T00:00:00Z', count: 3 },
};

test('built recurrence utility generates ordinary occurrences in native Node', () => {
  assert.deepEqual(generateOccurrences(entry, new Date('2025-01-01'), new Date('2025-01-03'), {
    includeMaster: true,
  }).map(date => date.toISOString()), [
    '2025-01-01T00:00:00.000Z', '2025-01-02T00:00:00.000Z', '2025-01-03T00:00:00.000Z',
  ]);
});

test('built recurrence utility bounds periods with no matching occurrences', () => {
  const workBudget = { remaining: 12 };
  const empty = { ...entry, recurrence_pattern: {
    frequency: 'daily', interval: 1, startDate: '2025-01-01T00:00:00Z', monthOfYear: 2, dayOfMonth: 30,
  } };
  assert.throws(() => generateOccurrences(empty, new Date('2025-01-01'), new Date('2025-01-02'), {
    workBudget,
  }), RecurrenceOccurrenceLimitError);
  assert.equal(workBudget.remaining, 0);
});

test('built recurrence utility bounds historical traversal for a narrow far-future window', () => {
  const workBudget = { remaining: 12 };
  const endless = { ...entry, recurrence_pattern: { ...entry.recurrence_pattern, count: undefined } };
  assert.throws(() => generateOccurrences(endless, new Date('9999-01-01'), new Date('9999-01-02'), {
    workBudget,
  }), RecurrenceOccurrenceLimitError);
  assert.equal(workBudget.remaining, 0);
});
