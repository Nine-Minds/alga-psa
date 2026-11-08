import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { evaluatePredicate } from '@alga-psa/predicates';
const require = createRequire(import.meta.url);
const { convert } = require('../../../migrations/20261028101041_convert_service_request_advanced_visibility.cjs');
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const x = '33333333-3333-4333-8333-333333333333';
const y = '44444444-4444-4444-8444-444444444444';
const contexts = [{ client: { id: a }, user: { id: x } }, { client: { id: a }, user: { id: y } }, { client: { id: b }, user: { id: x } }];

describe('advanced visibility conversion', () => {
  it.each([
    [{}, [true, true, true]],
    [{ allowAll: false }, [false, false, false]],
    [{ allowedClientIds: ['invalid'] }, [false, false, false]],
    [{ allowedClientIds: ['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'] }, [false, false, false]],
    [{ allowedClientIds: [a] }, [true, true, false]],
    [{ allowedRequesterUserIds: [x] }, [true, false, true]],
    [{ allowedClientIds: [a], allowedRequesterUserIds: [x] }, [true, false, false]],
  ])('preserves the provider result for %o', (config, expected) => {
    expect(contexts.map((context) => evaluatePredicate(convert(config), context))).toEqual(expected);
  });
});
