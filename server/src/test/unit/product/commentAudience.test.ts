import { beforeEach, describe, expect, it, vi } from 'vitest';
import knex from 'knex';
import {
  CommentAudienceError,
  CoManagedAudienceRequiredError,
  assertNativeEditKeepsAudience,
  assertReplyAudience,
  commentAudienceSql,
  isCommentAudienceVisible,
  nativeThreadAudience,
  resolveCommentAudience,
  resolveCommentAudienceForRead,
  type CommentAudience,
} from '@alga-psa/shared/lib/commentAudience';
import {
  registerWriteAdmissionResolver,
  resetWriteAdmissionCache,
  resetWriteAdmissionResolver,
} from '@alga-psa/db/writeAdmission';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const AUDIENCES: CommentAudience[] = ['requester', 'shared_it', 'organization_private'];

describe('A1 comment audience truth table', () => {
  it('visibility: audience x owner tenant x actor tenant x requester', () => {
    const expected = (audience: CommentAudience, same: boolean, requester: boolean) => {
      if (requester) return audience === 'requester';
      if (audience === 'organization_private') return same;
      return true;
    };
    for (const audience of AUDIENCES) {
      for (const actor of [OWNER, OTHER]) {
        for (const requester of [false, true]) {
          expect(isCommentAudienceVisible(audience, OWNER, actor, requester), `${audience} actor=${actor === OWNER ? 'owner' : 'other'} requester=${requester}`)
            .toBe(expected(audience, actor === OWNER, requester));
        }
      }
    }
  });

  it('fails closed when a tenant or the audience is missing', () => {
    expect(isCommentAudienceVisible('requester', '', OTHER)).toBe(false);
    expect(isCommentAudienceVisible('requester', OWNER, '')).toBe(false);
    expect(isCommentAudienceVisible('bogus' as CommentAudience, OWNER, OWNER)).toBe(false);
  });

  it('NULL audience resolves through the legacy is_internal rule and never becomes shared_it', () => {
    expect(resolveCommentAudience({ collaboration_audience: null, is_internal: false })).toBe('requester');
    expect(resolveCommentAudience({ collaboration_audience: null, is_internal: true })).toBe('organization_private');
    expect(resolveCommentAudience({ is_internal: null })).toBe('organization_private');
    expect(resolveCommentAudience({})).toBe('organization_private');
    for (const internal of [true, false, null, undefined]) {
      expect(resolveCommentAudience({ collaboration_audience: null, is_internal: internal })).not.toBe('shared_it');
      expect(resolveCommentAudienceForRead({ collaboration_audience: null, is_internal: internal })).not.toBe('shared_it');
    }
  });

  it('explicit audiences must agree with is_internal on write', () => {
    expect(resolveCommentAudience({ collaboration_audience: 'shared_it', is_internal: true })).toBe('shared_it');
    expect(resolveCommentAudience({ collaboration_audience: 'requester', is_internal: false })).toBe('requester');
    expect(() => resolveCommentAudience({ collaboration_audience: 'shared_it', is_internal: false })).toThrow(CommentAudienceError);
    expect(() => resolveCommentAudience({ collaboration_audience: 'requester', is_internal: true })).toThrow(CommentAudienceError);
    expect(() => resolveCommentAudience({ collaboration_audience: 'nonsense', is_internal: true })).toThrow(CommentAudienceError);
  });

  it('inconsistent legacy rows resolve private on read', () => {
    const cases: Array<[Record<string, unknown>, CommentAudience]> = [
      [{ is_internal: false, root_is_internal: false, comment_is_internal: false }, 'requester'],
      [{ is_internal: false, root_is_internal: true, comment_is_internal: false }, 'organization_private'],
      [{ is_internal: false, root_is_internal: false, comment_is_internal: true }, 'organization_private'],
      [{ is_internal: true, root_is_internal: false, comment_is_internal: false }, 'organization_private'],
      [{ is_internal: true, root_is_internal: true, comment_is_internal: true }, 'organization_private'],
      [{ is_internal: null, root_is_internal: null, comment_is_internal: null }, 'organization_private'],
      [{ collaboration_audience: 'shared_it', is_internal: true, root_is_internal: true, comment_is_internal: true }, 'shared_it'],
      [{ collaboration_audience: 'shared_it', is_internal: true, root_is_internal: true, comment_is_internal: false }, 'organization_private'],
      [{ collaboration_audience: 'shared_it', is_internal: false, root_is_internal: false, comment_is_internal: false }, 'organization_private'],
      [{ collaboration_audience: 'requester', is_internal: true, root_is_internal: true, comment_is_internal: true }, 'organization_private'],
      [{ collaboration_audience: 'requester', is_internal: false, root_is_internal: false, comment_is_internal: false }, 'requester'],
      [{ collaboration_audience: 'organization_private', is_internal: true, root_is_internal: true, comment_is_internal: true }, 'organization_private'],
      [{ collaboration_audience: 'garbage', is_internal: false, root_is_internal: false, comment_is_internal: false }, 'organization_private'],
    ];
    for (const [row, audience] of cases) expect(resolveCommentAudienceForRead(row), JSON.stringify(row)).toBe(audience);
  });

  it('the SQL facet is the same expression for every alias and binds identifiers', () => {
    const db = knex({ client: 'pg' });
    const raw = commentAudienceSql(db, 'ct', 'rc', 'c').toSQL();
    expect(raw.sql).toContain("'shared_it'");
    expect(raw.sql).toContain("ELSE 'organization_private'");
    expect(raw.sql).toContain('"ct".collaboration_audience = \'shared_it\'');
    expect(raw.sql).toContain('"rc".is_internal IS TRUE');
    expect(raw.sql).toContain('"c".is_internal IS FALSE');
    expect(commentAudienceSql(db, 'ct', 'rc').toSQL().sql).toContain('"rc".is_internal IS TRUE AND "rc".is_internal IS TRUE');
  });

  it('replies inherit the thread audience and are asserted against it', () => {
    expect(assertReplyAudience({ collaboration_audience: 'shared_it', is_internal: true }, { isInternal: true })).toBe('shared_it');
    expect(assertReplyAudience({ collaboration_audience: null, is_internal: true }, { isInternal: true })).toBe('organization_private');
    expect(() => assertReplyAudience({ collaboration_audience: 'shared_it', is_internal: true }, { audience: 'requester' })).toThrow(CommentAudienceError);
    expect(() => assertReplyAudience({ collaboration_audience: 'shared_it', is_internal: true }, { isInternal: false })).toThrow(CommentAudienceError);
  });
});

describe('nativeThreadAudience reducer', () => {
  const lookup = vi.fn();
  // A recording stand-in for tenantDb(...).unscoped('tenants').where().first().
  const trx: any = { __lookup: lookup };

  beforeEach(() => {
    resetWriteAdmissionCache();
    resetWriteAdmissionResolver();
    lookup.mockReset();
  });

  it('is a pure early return (no SQL) for internal notes and plain authors', async () => {
    registerWriteAdmissionResolver((async () => ({ canWrite: true })) as any);
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: true, authorType: 'internal' })).resolves.toEqual({});
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: false, authorType: 'client' })).resolves.toEqual({});
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: false, authorType: 'unknown' })).resolves.toEqual({});
    expect(lookup).not.toHaveBeenCalled();
  });

  it('is zero SQL for a tenant with no co-managed resolver registered', async () => {
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: false, authorType: 'internal' })).resolves.toEqual({});
  });

  it('rejects an audience that disagrees with visibility, before any lookup', async () => {
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: true, authorType: 'internal', audience: 'requester' })).rejects.toBeInstanceOf(CommentAudienceError);
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: false, authorType: 'internal', audience: 'organization_private' })).rejects.toBeInstanceOf(CommentAudienceError);
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: true, authorType: 'internal', audience: 'shared_it' })).rejects.toBeInstanceOf(CommentAudienceError);
  });

  it('assertNativeEditKeepsAudience refuses relabelling a labelled thread', async () => {
    await expect(assertNativeEditKeepsAudience(trx, OWNER, { collaboration_audience: 'shared_it' }, { isInternal: false })).rejects.toBeInstanceOf(CommentAudienceError);
    await expect(assertNativeEditKeepsAudience(trx, OWNER, { collaboration_audience: null }, { isInternal: false })).resolves.toBeUndefined();
  });

  it('exports the required error code', () => {
    expect(new CoManagedAudienceRequiredError().code).toBe('CO_MANAGED_AUDIENCE_REQUIRED');
  });
});
