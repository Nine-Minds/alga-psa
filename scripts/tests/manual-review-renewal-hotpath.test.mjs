import test from 'node:test';
import { assertRenewedReviewCollects } from './helpers/manual-review-renewal.mjs';

// The workspace DB job passed all 1860 test bodies, then failed manual
// collection when these three reviews reached their 2026-11-27 deadline.
const renewal = { previousExpiry: '2026-11-27', now: '2026-11-28T07:53:36Z' };

for (const runner of ['tenant-deletion-hotpath-review', 'server-hotpath-review', 'co-managed-built-worker-access-review']) {
  test(`renewed ${runner} collects real cases after the November 27 deadline`, t => {
    assertRenewedReviewCollects(t, { ...renewal, runner });
  });
}
