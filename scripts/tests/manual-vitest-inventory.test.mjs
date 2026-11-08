import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManualRunnerReview } from '../lib/vitest-inventory-collection.mjs';

const reviewedRunner = (expires) => ({
  runner: 'visual-review',
  reason: 'The suite needs a reviewed local environment.',
  issue: 'https://github.com/Nine-Minds/alga-psa/issues/1',
  expires,
});

test('manual runner review remains valid through its stated expiry date', () => {
  assert.doesNotThrow(() => validateManualRunnerReview(
    reviewedRunner('2026-11-08'), new Date('2026-11-08T23:59:59.999Z')));
  assert.throws(() => validateManualRunnerReview(
    reviewedRunner('2026-11-07'), new Date('2026-11-08T00:00:00.000Z')),
  /unexpired review/);
});
