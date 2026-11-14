import { beforeEach, describe, expect, it, vi } from 'vitest';
import knex from 'knex';
import {
  CommentAudienceError,
  CoManagedAudienceRequiredError,
  CommentAudienceConfirmationRequiredError,
  assertCommentWriteAudience,
  assertNativeEditKeepsAudience,
  assertReplyAudience,
  commentAudienceSql,
  commentAudienceVisibleSql,
  isCommentAudienceVisible,
  isCommentAudienceWidening,
  nativeReplyAudience,
  nativeThreadAudience,
  resolveCommentAudience,
  resolveCommentAudienceForRead,
  type CommentAudience,
  type CommentAudienceOwner,
  type CommentAudienceReader,
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
  // T022 (F035-F038): audience x reader organization x requester.
  const CLIENT = '33333333-3333-4333-8333-333333333333';
  const OTHER_CLIENT = '44444444-4444-4444-8444-444444444444';
  const owner: CommentAudienceOwner = { tenant: OWNER, clientId: CLIENT };
  const READERS: Record<string, CommentAudienceReader> = {
    'MSP staff': { kind: 'staff', tenant: OWNER },
    'staff of another tenant': { kind: 'staff', tenant: OTHER },
    "the client's seat technician": { kind: 'seat', tenant: OWNER, clientId: CLIENT },
    "another client's seat technician": { kind: 'seat', tenant: OWNER, clientId: OTHER_CLIENT },
    "another tenant's seat technician": { kind: 'seat', tenant: OTHER, clientId: CLIENT },
    requester: { kind: 'requester', tenant: OWNER },
  };
  const VISIBLE: Record<string, CommentAudience[]> = {
    'MSP staff': ['requester', 'shared_it', 'organization_private'],
    'staff of another tenant': ['requester', 'shared_it'],
    "the client's seat technician": ['requester', 'shared_it'],
    "another client's seat technician": [],
    "another tenant's seat technician": [],
    requester: ['requester'],
  };

  it('visibility: audience x reader organization', () => {
    for (const [name, reader] of Object.entries(READERS)) {
      for (const audience of AUDIENCES) {
        expect(isCommentAudienceVisible(audience, owner, reader), `${audience} for ${name}`).toBe(VISIBLE[name].includes(audience));
      }
    }
  });

  it('with no seat reader it is the old tenant comparison (single-tenant MSP, no seat arrangement)', () => {
    // The predicate as it was before organizations: (audience, ownerTenant, actorTenant, requester).
    const before = (audience: CommentAudience, ownerTenant: string, actorTenant: string, requester: boolean) => {
      if (!ownerTenant || !actorTenant) return false;
      if (requester) return audience === 'requester';
      return audience === 'requester' || audience === 'shared_it' || (audience === 'organization_private' && ownerTenant === actorTenant);
    };
    for (const audience of AUDIENCES) {
      for (const actor of [OWNER, OTHER]) {
        for (const requester of [false, true]) {
          for (const clientId of [CLIENT, null, undefined]) {
            expect(isCommentAudienceVisible(audience, { tenant: OWNER, clientId }, { kind: requester ? 'requester' : 'staff', tenant: actor }),
              `${audience} actor=${actor === OWNER ? 'owner' : 'other'} requester=${requester}`).toBe(before(audience, OWNER, actor, requester));
          }
        }
      }
    }
  });

  it('a legacy internal thread is private to a seat technician and never shared (F038)', () => {
    const seat = READERS["the client's seat technician"];
    const legacy = [
      { collaboration_audience: null, is_internal: true, root_is_internal: true, comment_is_internal: true },
      { is_internal: true },
      { collaboration_audience: null, is_internal: true, root_is_internal: true, comment_is_internal: false },
      { collaboration_audience: 'shared_it', is_internal: true, root_is_internal: false, comment_is_internal: true },
    ];
    for (const row of legacy) {
      const audience = resolveCommentAudienceForRead(row);
      expect(audience, JSON.stringify(row)).toBe('organization_private');
      expect(isCommentAudienceVisible(audience, owner, seat), JSON.stringify(row)).toBe(false);
      expect(isCommentAudienceVisible(audience, owner, READERS['MSP staff']), JSON.stringify(row)).toBe(true);
    }
  });

  it('fails closed when the owner, the reader or the audience is missing', () => {
    const staff = READERS['MSP staff'];
    expect(isCommentAudienceVisible('requester', { tenant: '' }, staff)).toBe(false);
    expect(isCommentAudienceVisible('requester', owner, { kind: 'staff', tenant: '' })).toBe(false);
    expect(isCommentAudienceVisible('requester', owner, null)).toBe(false);
    expect(isCommentAudienceVisible('requester', owner, undefined)).toBe(false);
    expect(isCommentAudienceVisible('requester', owner, { kind: 'bogus', tenant: OWNER } as any)).toBe(false);
    expect(isCommentAudienceVisible('bogus' as CommentAudience, owner, staff)).toBe(false);
    // A seat technician needs both sides of the client comparison.
    expect(isCommentAudienceVisible('requester', { tenant: OWNER }, READERS["the client's seat technician"])).toBe(false);
    expect(isCommentAudienceVisible('requester', { tenant: OWNER, clientId: null }, { kind: 'seat', tenant: OWNER, clientId: '' })).toBe(false);
    expect(isCommentAudienceVisible('requester', { tenant: OWNER, clientId: null }, { kind: 'seat', tenant: OWNER, clientId: null } as any)).toBe(false);
  });

  it('the SQL visibility form wraps the one audience expression and fails closed like the TypeScript form', () => {
    const db = knex({ client: 'pg' });
    const source = { thread: 'ct', root: 'rc', comment: 'c', ownerTenant: 'c.tenant', ownerClient: 't.client_id' };
    const audienceSql = commentAudienceSql(db, 'ct', 'rc', 'c').toSQL().sql;
    for (const reader of Object.values(READERS)) expect(commentAudienceVisibleSql(db, reader, source).toSQL().sql).toContain(audienceSql);
    const seat = commentAudienceVisibleSql(db, READERS["the client's seat technician"], source).toSQL();
    expect(seat.sql).toContain('"c"."tenant" = ?');
    expect(seat.sql).toContain('"t"."client_id" IS NOT DISTINCT FROM ?');
    expect(seat.bindings).toEqual([OWNER, CLIENT]);
    const staff = commentAudienceVisibleSql(db, READERS['MSP staff'], source).toSQL();
    expect(staff.sql).toContain(`<> 'organization_private' OR "c"."tenant" = ?`);
    expect(staff.bindings).toEqual([OWNER]);
    expect(commentAudienceVisibleSql(db, READERS.requester, source).toSQL().sql).toContain(`= 'requester'`);
    const closed = [
      commentAudienceVisibleSql(db, null, source),
      commentAudienceVisibleSql(db, { kind: 'staff', tenant: '' }, source),
      commentAudienceVisibleSql(db, { kind: 'bogus', tenant: OWNER } as any, source),
      commentAudienceVisibleSql(db, { kind: 'seat', tenant: OWNER, clientId: '' }, source),
      commentAudienceVisibleSql(db, READERS["the client's seat technician"], { ...source, ownerClient: undefined }),
    ];
    for (const raw of closed) expect(raw.toSQL().sql).toBe('FALSE');
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

describe('comment write audience truth table (S17)', () => {
  // F039/F040: author organization x audience x seat arrangement. `null` audience is the legacy form.
  const CLIENT = '33333333-3333-4333-8333-333333333333';
  const OTHER_CLIENT = '44444444-4444-4444-8444-444444444444';
  const staff: CommentAudienceReader = { kind: 'staff', tenant: OWNER };
  const seat: CommentAudienceReader = { kind: 'seat', tenant: OWNER, clientId: CLIENT };
  const requester: CommentAudienceReader = { kind: 'requester', tenant: OWNER };
  const arranged = { tenant: OWNER, clientId: CLIENT, seatArrangement: true };
  const plain = { tenant: OWNER, clientId: CLIENT, seatArrangement: false };
  const WRITES: Array<{ name: string; audience: CommentAudience | null; isInternal: boolean }> = [
    { name: 'requester', audience: 'requester', isInternal: false },
    { name: 'legacy public', audience: null, isInternal: false },
    { name: 'shared_it', audience: 'shared_it', isInternal: true },
    { name: 'organization_private', audience: 'organization_private', isInternal: true },
    { name: 'legacy internal note', audience: null, isInternal: true },
  ];
  const allowed = (author: CommentAudienceReader | null, owner: typeof arranged) => WRITES.filter(write => {
    try { assertCommentWriteAudience(author, owner, write); return true; } catch (error) {
      expect(error).toBeInstanceOf(CommentAudienceError);
      return false;
    }
  }).map(write => write.name);

  it('MSP staff write every audience where the client has a live arrangement, and never shared_it elsewhere (F039)', () => {
    expect(allowed(staff, arranged)).toEqual(['requester', 'legacy public', 'shared_it', 'organization_private', 'legacy internal note']);
    expect(allowed(staff, plain)).toEqual(['requester', 'legacy public', 'organization_private', 'legacy internal note']);
    expect(allowed(staff, { tenant: OWNER } as any)).toEqual(['requester', 'legacy public', 'organization_private', 'legacy internal note']);
  });

  it('a seat technician writes requester and shared_it only, on their own client (F040)', () => {
    expect(allowed(seat, arranged)).toEqual(['requester', 'legacy public', 'shared_it']);
    expect(allowed({ kind: 'seat', tenant: OWNER, clientId: OTHER_CLIENT }, arranged)).toEqual([]);
    expect(allowed({ kind: 'seat', tenant: OTHER, clientId: CLIENT }, arranged)).toEqual([]);
    expect(allowed(seat, { tenant: OWNER } as any)).toEqual([]);
  });

  it('a requester writes requester only; no organization and another tenant write nothing', () => {
    expect(allowed(requester, arranged)).toEqual(['requester', 'legacy public']);
    expect(allowed(null, arranged)).toEqual([]);
    expect(allowed({ kind: 'staff', tenant: OTHER }, arranged)).toEqual([]);
  });

  it('nobody writes an audience they could not read back', () => {
    for (const author of [staff, seat, requester]) {
      for (const write of WRITES) {
        let stored: CommentAudience | null = null;
        try { stored = assertCommentWriteAudience(author, arranged, write); } catch { /* refused */ }
        if (stored) expect(isCommentAudienceVisible(stored, arranged, author)).toBe(true);
      }
    }
  });

  it('refuses a named audience that disagrees with visibility', () => {
    expect(() => assertCommentWriteAudience(staff, arranged, { audience: 'shared_it', isInternal: false })).toThrow(CommentAudienceError);
    expect(() => assertCommentWriteAudience(staff, arranged, { audience: 'requester', isInternal: true })).toThrow(CommentAudienceError);
  });

  it('orders audiences by reach: private < shared_it < requester', () => {
    expect(isCommentAudienceWidening('organization_private', 'shared_it')).toBe(true);
    expect(isCommentAudienceWidening('shared_it', 'requester')).toBe(true);
    expect(isCommentAudienceWidening('organization_private', 'requester')).toBe(true);
    expect(isCommentAudienceWidening('requester', 'shared_it')).toBe(false);
    expect(isCommentAudienceWidening('shared_it', 'organization_private')).toBe(false);
    expect(isCommentAudienceWidening('shared_it', 'shared_it')).toBe(false);
    expect(new CommentAudienceConfirmationRequiredError().code).toBe('COMMENT_AUDIENCE_CONFIRMATION_REQUIRED');
  });

  it('a named seat or absent author is decided with no SQL when nothing needs the ticket', async () => {
    const trx: any = {};
    // Staff named explicitly, legacy thread: no read at all.
    await expect(nativeReplyAudience(trx, OWNER, { thread_id: 't', collaboration_audience: null, is_internal: true },
      { author: staff })).resolves.toBeNull();
    // No live organization: refused before any read.
    await expect(nativeReplyAudience(trx, OWNER, { thread_id: 't', collaboration_audience: null, is_internal: false },
      { author: null })).rejects.toBeInstanceOf(CommentAudienceError);
    await expect(nativeThreadAudience(trx, OWNER, { isInternal: true, authorType: 'internal', author: null }))
      .rejects.toBeInstanceOf(CommentAudienceError);
    // The edit guard: only staff may flip a legacy comment's visibility.
    await expect(assertNativeEditKeepsAudience(trx, OWNER, { collaboration_audience: null }, { isInternal: true, author: seat }))
      .rejects.toBeInstanceOf(CommentAudienceError);
  });
});
