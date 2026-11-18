import knexFactory from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { principalKindOfSubject, type AuthorizationSubject } from '@alga-psa/authorization/kernel';
import {
  mayHoldApiCredentials,
  principalMemberColumns,
  principalMembershipExpression,
  resolvePrincipalKind,
} from '@alga-psa/authorization/subject/principalKind';
import { CO_MANAGED_SEAT_SURFACE, SURFACE_KINDS } from '@shared/services/productSurfaceKinds';
import { CO_MANAGED_SEAT_RESOLVER_ID, CO_MANAGED_SEAT_PRINCIPAL_KIND, coManagedSeatResolver, registerCoManagedSeatAuthority } from '../seatAuthority';

// S12 F029/F030: a seat subject is a principal kind. The class is the seat resolver's, so the surface and the
// credential policy never define "seat technician" a second time.

const subject = (resolverFacts?: Record<string, unknown>): AuthorizationSubject => ({
  tenant: 't1', userId: 'tech-1', userType: 'internal', roleIds: [], teamIds: [], managedUserIds: [], clientId: null,
  portfolioClientIds: [], ...(resolverFacts ? { resolverFacts } : {}),
});
const liveFacts = {
  assignments: [{ arrangement_id: 'a1', state: 'active' }],
  arrangements: [{ arrangement_id: 'a1', client_id: 'c1', state: 'active' }],
  boards: [], projects: [],
};

describe('the seat resolver declares a principal kind', () => {
  beforeAll(() => registerCoManagedSeatAuthority());

  it('names the kind the registry holds a surface for, and refuses API credentials', () => {
    expect(coManagedSeatResolver.principalKind).toEqual({ kind: CO_MANAGED_SEAT_PRINCIPAL_KIND, apiCredentials: 'refused' });
    expect(CO_MANAGED_SEAT_PRINCIPAL_KIND).toBe(CO_MANAGED_SEAT_SURFACE);
    expect(Object.keys(SURFACE_KINDS)).toContain(CO_MANAGED_SEAT_PRINCIPAL_KIND);
  });

  it('classifies a seat subject from the facts it carries', () => {
    expect(principalKindOfSubject(subject({ [CO_MANAGED_SEAT_RESOLVER_ID]: liveFacts }))).toMatchObject({ kind: 'co_managed_seat' });
  });

  it('keeps a revoked or ended technician in the kind: they stay on the closed surface, not on the MSP one', () => {
    const revoked = { ...liveFacts, assignments: [{ arrangement_id: 'a1', state: 'revoked' }] };
    expect(principalKindOfSubject(subject({ [CO_MANAGED_SEAT_RESOLVER_ID]: revoked }))).toMatchObject({ kind: 'co_managed_seat' });
  });

  it('treats facts it cannot read as a seat subject, so doubt closes the surface', () => {
    expect(principalKindOfSubject(subject({ [CO_MANAGED_SEAT_RESOLVER_ID]: { assignments: 'garbled' } }))).toMatchObject({ kind: 'co_managed_seat' });
  });

  it('leaves an ordinary MSP user, with or without facts of the tenant, an ordinary principal', () => {
    expect(principalKindOfSubject(subject())).toBeNull();
    expect(principalKindOfSubject(subject({ [CO_MANAGED_SEAT_RESOLVER_ID]: { ...liveFacts, assignments: [] } }))).toBeNull();
  });
});

describe('deriving the principal kind on the request path', () => {
  const knex = knexFactory({ client: 'pg' });
  afterAll(() => knex.destroy());
  beforeAll(() => registerCoManagedSeatAuthority());

  // Any statement against this connection fails the test: it proves a path issued none.
  const forbidden: any = new Proxy({}, { get: () => { throw new Error('a statement was issued'); } });

  it('costs an ordinary user no statement of its own: membership is one EXISTS in the caller\'s statement', () => {
    const [column] = principalMemberColumns(knex, { tenant: 't1', userId: 'u1' });
    const sql = knex.select('product_code', column).from('tenants').toSQL();
    expect(sql.sql).toMatch(/exists\(\(select 1 from "authorization_resolver_subjects"/i);
    expect(sql.sql).toContain('as principal_member');
    expect(sql.bindings).toEqual(expect.arrayContaining(['u1', CO_MANAGED_SEAT_RESOLVER_ID]));
    expect(principalMembershipExpression(knex, { tenant: 't1', userId: 'u1' })).not.toBeNull();
  });

  it('issues no statement when the membership probe said the user is not a member', async () => {
    await expect(resolvePrincipalKind(forbidden, { tenant: 't1', userId: 'u1', member: false })).resolves.toBeNull();
    await expect(mayHoldApiCredentials(forbidden, { tenant: 't1', userId: 'u1', member: false })).resolves.toBe(true);
  });
});
