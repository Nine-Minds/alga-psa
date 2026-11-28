import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertRenewedReviewCollects } from './helpers/manual-review-renewal.mjs';

// The workspace DB job passed all test bodies, then failed manual collection
// when these reviews reached their deadline at midnight UTC on November 8.
const renewal = { previousExpiry: '2026-11-08', now: '2026-11-09T01:54:56Z' };

test('renewed legacy email review collects real cases after the previous deadline', t => {
  assertRenewedReviewCollects(t, { ...renewal, runner: 'legacy-email-review' });
});

test('renewed invoice visual review collects real cases after the previous deadline', t => {
  assertRenewedReviewCollects(t, { ...renewal, runner: 'invoice-visual-review', inspect: collection => {
    const cases = JSON.parse(readFileSync(path.join(collection.collectionDirectory, 'collected-tests.json'), 'utf8'));
    assert.ok(cases.every(entry => entry.skipped), 'Unavailable DB must remain visible as skipped cases');
  } });
});
