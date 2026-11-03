// Run after building shared: npm run test:recurrence-build --workspace @alga-psa/shared
// Native Node loading exercises package resolution that Vitest transpiles away.
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
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

test('built recurrence utility seeks historical daily series within the work budget', () => {
  const workBudget = { remaining: 12 };
  const endless = { ...entry, recurrence_pattern: { ...entry.recurrence_pattern, count: undefined } };
  const dates = generateOccurrences(endless, new Date('9999-01-01'), new Date('9999-01-02'), {
    workBudget,
  });
  assert.ok(dates.length > 0);
  assert.ok(workBudget.remaining > 0);
});

test('a full candidate page of daily COUNT series stays within CPU and work limits', () => {
  // Run synchronously in a child so a CPU regression cannot block the test
  // runner's own timeout. This previously took over thirteen seconds.
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { generateOccurrences } from '@alga-psa/shared/utils/recurrenceUtils';
    const entry = {
      is_all_day: true,
      scheduled_start: new Date('2025-01-01'), scheduled_end: new Date('2025-01-02'),
      recurrence_pattern: { frequency: 'daily', interval: 1, startDate: '2025-01-01', count: 10000 },
    };
    const workBudget = { remaining: 2000 };
    for (let row = 0; row < 500; row++) {
      assert.equal(generateOccurrences(entry, new Date('2025-01-03'), new Date('2025-01-03'), {
        includeMaster: true, workBudget,
      }).length, 1);
    }
    assert.ok(workBudget.remaining >= 0);
  `], { cwd: new URL('../..', import.meta.url), timeout: 5000, stdio: 'pipe' });
});
