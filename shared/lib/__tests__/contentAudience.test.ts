import { describe, expect, it } from 'vitest';
import knex from 'knex';
import {
  CONTENT_AUDIENCES,
  contentAudienceVisibleSql,
  contentAudiencesVisibleTo,
  isContentAudienceVisible,
  type ContentAudience,
  type ContentAudienceReader,
} from '../contentAudience';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OTHER_CLIENT = '44444444-4444-4444-8444-444444444444';

const owner = { tenant: OWNER, clientId: CLIENT };
const staff: ContentAudienceReader = { kind: 'staff', tenant: OWNER };
const seat: ContentAudienceReader = { kind: 'seat', tenant: OWNER, clientId: CLIENT };
const requester: ContentAudienceReader = { kind: 'requester', tenant: OWNER };

describe('content audience predicate (TypeScript form)', () => {
  it('reproduces the reader table', () => {
    const table: Record<ContentAudience, [boolean, boolean, boolean]> = {
      organization_private: [true, false, false],
      shared_it: [true, true, false],
      requester: [true, true, true],
    };
    for (const audience of CONTENT_AUDIENCES) {
      const [s, t, r] = table[audience];
      expect(isContentAudienceVisible(audience, owner, staff), `${audience} staff`).toBe(s);
      expect(isContentAudienceVisible(audience, owner, seat), `${audience} seat`).toBe(t);
      expect(isContentAudienceVisible(audience, owner, requester), `${audience} requester`).toBe(r);
    }
  });

  it('staff of another tenant never sees private, sees the other two', () => {
    const other: ContentAudienceReader = { kind: 'staff', tenant: OTHER };
    expect(isContentAudienceVisible('organization_private', owner, other)).toBe(false);
    expect(isContentAudienceVisible('shared_it', owner, other)).toBe(true);
    expect(isContentAudienceVisible('requester', owner, other)).toBe(true);
  });

  it('a seat of another client or tenant sees nothing', () => {
    for (const reader of [
      { kind: 'seat', tenant: OWNER, clientId: OTHER_CLIENT },
      { kind: 'seat', tenant: OTHER, clientId: CLIENT },
    ] as ContentAudienceReader[]) {
      for (const audience of CONTENT_AUDIENCES) expect(isContentAudienceVisible(audience, owner, reader)).toBe(false);
    }
  });

  it('fails closed on missing client, tenant, reader or audience', () => {
    for (const audience of CONTENT_AUDIENCES) {
      expect(isContentAudienceVisible(audience, owner, { kind: 'seat', tenant: OWNER, clientId: '' })).toBe(false);
      expect(isContentAudienceVisible(audience, owner, { kind: 'seat', tenant: OWNER } as any)).toBe(false);
      expect(isContentAudienceVisible(audience, { tenant: OWNER }, seat)).toBe(false);
      expect(isContentAudienceVisible(audience, { tenant: OWNER, clientId: null }, seat)).toBe(false);
      expect(isContentAudienceVisible(audience, owner, null)).toBe(false);
      expect(isContentAudienceVisible(audience, owner, undefined)).toBe(false);
      expect(isContentAudienceVisible(audience, { tenant: '' }, staff)).toBe(false);
      expect(isContentAudienceVisible(audience, owner, { kind: 'staff', tenant: '' })).toBe(false);
      expect(isContentAudienceVisible(audience, owner, { kind: 'bogus', tenant: OWNER } as any)).toBe(false);
    }
    expect(isContentAudienceVisible('bogus' as ContentAudience, owner, staff)).toBe(false);
    expect(isContentAudienceVisible(undefined as any, owner, staff)).toBe(false);
  });

  it('contentAudiencesVisibleTo lists what the predicate admits per reader kind', () => {
    expect(contentAudiencesVisibleTo('staff')).toEqual(expect.arrayContaining([...CONTENT_AUDIENCES]));
    expect(contentAudiencesVisibleTo('staff')).toHaveLength(3);
    expect(contentAudiencesVisibleTo('seat').sort()).toEqual(['requester', 'shared_it']);
    expect(contentAudiencesVisibleTo('requester')).toEqual(['requester']);
  });
});

describe('content audience predicate (SQL form)', () => {
  const db = knex({ client: 'pg' });
  const source = { audience: 'd.audience', ownerTenant: 'd.tenant', ownerClient: 'd.client_id' };

  it('binds a plain audience column as an identifier, per reader kind', () => {
    const staffSql = contentAudienceVisibleSql(db, staff, source).toSQL();
    expect(staffSql.sql).toBe(`(("d"."audience") <> 'organization_private' OR "d"."tenant" = ?)`);
    expect(staffSql.bindings).toEqual([OWNER]);

    const seatSql = contentAudienceVisibleSql(db, seat, source).toSQL();
    expect(seatSql.sql).toBe(
      `(("d"."audience") <> 'organization_private' AND "d"."tenant" = ? AND "d"."client_id" IS NOT DISTINCT FROM ?)`);
    expect(seatSql.bindings).toEqual([OWNER, CLIENT]);

    const requesterSql = contentAudienceVisibleSql(db, requester, source).toSQL();
    expect(requesterSql.sql).toBe(`(("d"."audience") = 'requester')`);
    expect(requesterSql.bindings).toEqual([]);
  });

  it('embeds a Knex.Raw audience expression unchanged', () => {
    const expr = db.raw(`CASE WHEN ?? THEN 'requester' ELSE 'organization_private' END`, ['d.flag']);
    const sql = contentAudienceVisibleSql(db, staff, { ...source, audience: expr }).toSQL();
    expect(sql.sql).toContain(`(CASE WHEN "d"."flag" THEN 'requester' ELSE 'organization_private' END) <> 'organization_private'`);
    expect(sql.bindings).toEqual([OWNER]);
  });

  it('is FALSE exactly where the TypeScript form is false for every audience', () => {
    const closed: Array<[ContentAudienceReader | null | undefined, typeof source]> = [
      [null, source],
      [undefined, source],
      [{ kind: 'staff', tenant: '' }, source],
      [{ kind: 'bogus', tenant: OWNER } as any, source],
      [{ kind: 'seat', tenant: OWNER, clientId: '' }, source],
      [seat, { ...source, ownerClient: undefined } as any],
    ];
    for (const [reader, src] of closed) expect(contentAudienceVisibleSql(db, reader, src).toSQL().sql).toBe('FALSE');
    // The TypeScript twin of the "source has no ownerClient" case is an owner with no client.
    for (const audience of CONTENT_AUDIENCES) {
      expect(isContentAudienceVisible(audience, { tenant: OWNER }, seat)).toBe(false);
    }
  });
});
