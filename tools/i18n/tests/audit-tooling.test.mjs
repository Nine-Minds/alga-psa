import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const {
  allowlistMatchers,
  collectLeaves,
  findForbiddenTerms,
  forbiddenMatchers,
  isReviewed,
  loadReviewState,
} = require('../lib/translation-utils.cjs');
const { compareBaseline } = require('../audit.cjs');

test('identical allowlist matches exact, locale-folded, and pattern values', () => {
  const allowlist = allowlistMatchers({
    dialect: 'de-DE',
    identicalAllowlist: {
      exact: ['Status'],
      caseInsensitive: ['Webhook'],
      patterns: ['^API v\\d+$'],
    },
  });

  assert.equal(allowlist.isAllowed('Status'), true);
  assert.equal(allowlist.isAllowed('WEBHOOK'), true);
  assert.equal(allowlist.isAllowed('API v2'), true);
  assert.equal(allowlist.isAllowed('Save'), false);
});

test('forbidden matching respects Unicode word boundaries and case folding', () => {
  const matchers = forbiddenMatchers({
    dialect: 'de-DE',
    forbiddenTerms: [{ term: 'job', preferred: 'Auftrag', reason: 'fixture' }],
  });

  assert.deepEqual(findForbiddenTerms('Ein JOB ist bereit.', matchers), [
    { term: 'job', preferred: 'Auftrag', reason: 'fixture' },
  ]);
  assert.deepEqual(findForbiddenTerms('Job-Verlauf', matchers).map((item) => item.term), ['job']);
  assert.deepEqual(findForbiddenTerms('Jobcenter', matchers), []);
});

test('placeholder contents never trip forbidden terms', () => {
  const matchers = forbiddenMatchers({
    dialect: 'nl-NL',
    forbiddenTerms: [{ term: 'email', preferred: 'e-mail', reason: 'fixture' }],
  });

  assert.deepEqual(findForbiddenTerms('Stuur naar {{email}}', matchers), []);
  assert.deepEqual(findForbiddenTerms('Stuur een email naar {{email}}', matchers).map((item) => item.term), ['email']);
});

test('enWhen scopes a ban to keys whose English source matches', () => {
  const matchers = forbiddenMatchers({
    dialect: 'nl-NL',
    forbiddenTerms: [
      { term: 'cliënt', preferred: 'klant', reason: 'fixture', enWhen: '\\bclients?\\b' },
    ],
  });

  assert.deepEqual(
    findForbiddenTerms('Selecteer een cliënt', matchers, 'nl-NL', 'Select a client').map((item) => item.term),
    ['cliënt'],
  );
  assert.deepEqual(findForbiddenTerms('De cliënt van de advocaat', matchers, 'nl-NL', 'The lawyer’s customer'), []);
  assert.deepEqual(findForbiddenTerms('De cliënt', matchers, 'nl-NL', undefined), []);
});

test('unless masks legitimate value-side spans like branded compounds', () => {
  const matchers = forbiddenMatchers({
    dialect: 'fr-FR',
    forbiddenTerms: [
      { term: 'dashboard', preferred: 'tableau de bord', reason: 'fixture', unless: '\\b(?:stripe|ninjaone) dashboard\\b' },
    ],
  });

  assert.deepEqual(findForbiddenTerms('Ouvrez le Stripe Dashboard', matchers), []);
  assert.deepEqual(findForbiddenTerms('Ouvrez le dashboard', matchers).map((item) => item.term), ['dashboard']);
  assert.deepEqual(findForbiddenTerms('Voir https://dashboard.stripe.com maintenant', matchers), []);
});

test('leaf collection preserves arrays and scalar values at dotted keys', () => {
  const leaves = collectLeaves({
    actions: { save: 'Save', retry: true },
    choices: ['one', 'two'],
    count: 3,
  });

  assert.deepEqual([...leaves], [
    ['actions.save', 'Save'],
    ['actions.retry', true],
    ['choices', ['one', 'two']],
    ['count', 3],
  ]);
});

test('review lookup accepts boolean and object ledger entries', () => {
  const state = {
    reviewed: {
      common: {
        direct: true,
        detailed: { reviewed: true },
        pending: { reviewed: false },
      },
    },
  };

  assert.equal(isReviewed(state, 'common', 'direct'), true);
  assert.equal(isReviewed(state, 'common', 'detailed'), true);
  assert.equal(isReviewed(state, 'common', 'pending'), false);
  assert.equal(isReviewed(state, 'common', 'missing'), false);
});

test('missing review state defaults to the requested locale', () => {
  const state = loadReviewState(join(tmpdir(), `missing-review-state-${process.pid}.json`), 'nl');
  assert.deepEqual(state, { version: 1, locale: 'nl', reviewed: {} });
});

test('baseline comparison fails only counts that regress', () => {
  const report = {
    summary: {
      untranslatedCount: 3,
      forbiddenViolationCount: 1,
      unreviewedCount: 8,
    },
    namespaces: [{ structuralErrors: [{ type: 'missing-file' }] }],
  };
  const comparison = compareBaseline(report, {
    counts: { untranslated: 2, forbidden: 1, unreviewed: 10, structural: 1 },
  });

  assert.equal(comparison.regressed, true);
  assert.deepEqual(comparison.deltas.untranslated, { baseline: 2, current: 3, delta: 1 });
  assert.deepEqual(comparison.deltas.forbidden, { baseline: 1, current: 1, delta: 0 });
  assert.deepEqual(comparison.deltas.unreviewed, { baseline: 10, current: 8, delta: -2 });
  assert.deepEqual(comparison.deltas.structural, { baseline: 1, current: 1, delta: 0 });
});
