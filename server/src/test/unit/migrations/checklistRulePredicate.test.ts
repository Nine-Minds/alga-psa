import { test } from 'vitest';
import assert from 'node:assert/strict';
import { legacyChecklistRuleToPredicate as convert } from '../../../../migrations/utils/checklistRulePredicate.cjs';

// Awaited here: a floating import outlives collection-only runs and rejects
// once vitest tears the environment down.
const { evaluatePredicate: matches } = await import('@alga-psa/predicates');

test('unconstrained rules and empty values match', async () => {
  const predicate = convert({ client_ids: [], ticket_origins: null, keywords: [' ', ''], from_service_request: false });
  assert.deepEqual(predicate, { join: 'and', clauses: [] });
  assert.equal(matches(predicate, {}), true);
});

test('all keyword terms can match different fields but not across them', async () => {
  const predicate = convert({ keywords: [' OnBoard ', 'LAPTOP'], keyword_mode: 'all' });
  assert.equal(matches(predicate, { title_folded: 'onboarding', description_folded: 'laptop' }), true);
  assert.equal(matches(predicate, { title_folded: 'onboard', description_folded: 'ing laptop' }), true);
  assert.equal(matches(predicate, { title_folded: 'onbo', description_folded: 'ard laptop' }), false);
  assert.equal(matches(predicate, { title_folded: 'onboarding', description_folded: 'desktop' }), false);
});

test('dimensions compose, and a definition implies service-request origin', async () => {
  const predicate = convert({ board_id: 'b', category_id: 'c', subcategory_id: 's', priority_id: 'p', client_ids: ['client'], ticket_origins: ['api'], from_service_request: true, service_request_definition_id: 'definition', keywords: [' %_ '], keyword_target: 'description' });
  const values = { board_id: 'b', category_id: 'c', subcategory_id: 's', priority_id: 'p', client: { id: 'client' }, ticket_origin: 'api', service_request_definition_id: 'definition', description_folded: 'literal %_ text' };
  assert.equal(matches(predicate, values), true);
  for (const key of Object.keys(values)) assert.equal(matches(predicate, { ...values, [key]: key === 'client' ? { id: 'different' } : 'different' }), false, key);
  assert.equal(predicate.clauses.some((c) => c.path === 'from_service_request'), false);
});

test('any keyword and title-only target', async () => {
  const predicate = convert({ keywords: ['FIRST', 'SECOND'], keyword_target: 'title' });
  assert.equal(matches(predicate, { title_folded: 'second', description_folded: '' }), true);
  assert.equal(matches(predicate, { title_folded: '', description_folded: 'first' }), false);
});


test('keyword conversion keeps frozen v1 casing on newer Unicode runtimes', () => {
  const predicate = convert({ keywords: [' A\ua7ceΣ ', 'İ ΟΣ'], keyword_target: 'title' });
  assert.deepEqual(predicate.clauses, [{ join: 'or', clauses: [
    { path: 'title_folded', operator: 'contains', value: 'a\ua7ceσ' },
    { path: 'title_folded', operator: 'contains', value: 'i\u0307 ος' },
  ] }]);
});
