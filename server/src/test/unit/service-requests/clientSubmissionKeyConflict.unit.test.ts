import { describe, expect, it } from 'vitest';
import { isClientSubmissionKeyConflict } from '../../../lib/service-requests/submissionService';

const BARE_INDEX_NAME = 'service_request_submissions_client_key_unique';

describe('isClientSubmissionKeyConflict', () => {
  it('recognizes the bare index name plain Postgres reports', () => {
    expect(
      isClientSubmissionKeyConflict({ code: '23505', constraint: BARE_INDEX_NAME })
    ).toBe(true);
  });

  it('recognizes the shard-suffixed index name Citus reports', () => {
    expect(
      isClientSubmissionKeyConflict({
        code: '23505',
        constraint: `${BARE_INDEX_NAME}_102008`,
      })
    ).toBe(true);
  });

  it('rejects unique violations on other constraints', () => {
    expect(
      isClientSubmissionKeyConflict({
        code: '23505',
        constraint: 'service_request_submissions_pkey',
      })
    ).toBe(false);
  });

  it('rejects a differently named index that merely shares the prefix', () => {
    expect(
      isClientSubmissionKeyConflict({
        code: '23505',
        constraint: `${BARE_INDEX_NAME}_v2`,
      })
    ).toBe(false);
    expect(
      isClientSubmissionKeyConflict({
        code: '23505',
        constraint: `${BARE_INDEX_NAME}_102008_extra`,
      })
    ).toBe(false);
  });

  it('rejects non-unique-violation errors regardless of constraint name', () => {
    expect(
      isClientSubmissionKeyConflict({ code: '23503', constraint: BARE_INDEX_NAME })
    ).toBe(false);
    expect(isClientSubmissionKeyConflict({ code: '23505' })).toBe(false);
    expect(isClientSubmissionKeyConflict(null)).toBe(false);
    expect(isClientSubmissionKeyConflict(new Error('boom'))).toBe(false);
  });
});
