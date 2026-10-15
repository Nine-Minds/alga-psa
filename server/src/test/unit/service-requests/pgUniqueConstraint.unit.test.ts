import { describe, expect, it } from 'vitest';
import { isUniqueViolationOnIndex } from '../../../lib/service-requests/pgUniqueConstraint';

const INDEX = 'service_request_submission_applications_replay_unique';

describe('isUniqueViolationOnIndex', () => {
  it('recognizes the bare index name plain Postgres reports', () => {
    expect(isUniqueViolationOnIndex({ code: '23505', constraint: INDEX }, INDEX)).toBe(true);
  });

  it('recognizes the shard-suffixed index name Citus reports', () => {
    expect(
      isUniqueViolationOnIndex({ code: '23505', constraint: `${INDEX}_102008` }, INDEX)
    ).toBe(true);
  });

  it('rejects a differently named index that merely shares the prefix', () => {
    expect(isUniqueViolationOnIndex({ code: '23505', constraint: `${INDEX}_v2` }, INDEX)).toBe(false);
    expect(
      isUniqueViolationOnIndex({ code: '23505', constraint: `${INDEX}_102008_extra` }, INDEX)
    ).toBe(false);
    expect(
      isUniqueViolationOnIndex(
        { code: '23505', constraint: 'service_request_submission_applications_pkey' },
        INDEX
      )
    ).toBe(false);
  });

  it('rejects non-unique-violation errors regardless of constraint name', () => {
    expect(isUniqueViolationOnIndex({ code: '23503', constraint: INDEX }, INDEX)).toBe(false);
    expect(isUniqueViolationOnIndex({ code: '23505' }, INDEX)).toBe(false);
    expect(isUniqueViolationOnIndex(null, INDEX)).toBe(false);
    expect(isUniqueViolationOnIndex(new Error('boom'), INDEX)).toBe(false);
  });

  it('treats regex metacharacters in the index name literally', () => {
    expect(isUniqueViolationOnIndex({ code: '23505', constraint: 'a.b' }, 'a.b')).toBe(true);
    expect(isUniqueViolationOnIndex({ code: '23505', constraint: 'axb' }, 'a.b')).toBe(false);
  });
});
