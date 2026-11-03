import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';
import { SCIM_USER_SCHEMA } from '@ee/lib/scim/protocol';
import { generateScimToken } from '@ee/lib/scim/credentials';
import { handleScimPost, handleScimPut } from '@ee/lib/scim/handler';
import { ScimProvisioningService } from '@ee/lib/scim/service';

const { getAdminConnectionMock } = vi.hoisted(() => ({ getAdminConnectionMock: vi.fn() }));

vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: getAdminConnectionMock }));
vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: { getInstance: () => ({ tryConsume: async () => ({ allowed: true, remaining: 10 }) }) },
}));
vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({ assertTenantTierAccess: async () => undefined }));

describe('SCIM provisioning database lifecycle', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
  });

  async function reactivationFixture(options: {
    coManaged?: boolean;
    deniedBy?: 'expired-entitlement' | 'ended-relationship' | 'full-allocation' | 'ordinary-license';
  } = {}) {
    const trx = await db.transaction();
    const discovery = tenantDb(trx, '__scim_integration_discovery__');
    const tenantRow = await discovery
      .unscoped('tenants as t', 'SCIM integration test selects a tenant with no configured connection')
      .whereNotExists(discovery.unscoped('scim_connections as c', 'SCIM reactivation test needs an unconfigured tenant')
        .select(trx.raw('1')).whereRaw('c.tenant = t.tenant'))
      .select('t.tenant').first();
    if (!tenantRow?.tenant) throw new Error('SCIM integration test requires a tenant');

    const tenant = tenantRow.tenant as string;
    const customer = tenantDb(trx, tenant);
    const userId = randomUUID();
    const email = `scim-reactivate-${randomUUID()}@example.test`;
    const connectionId = randomUUID();
    const linkId = randomUUID();
    const externalId = `entra-${randomUUID()}`;
    const token = generateScimToken();
    await customer.table('tenants').where({ tenant }).update({
      product_code: options.coManaged ? 'co_managed' : 'psa',
      plan: 'pro',
      licensed_user_count: options.deniedBy === 'ordinary-license' ? 1 : 20,
    });
    await customer.table('users').insert({ tenant, user_id: userId, username: email, email,
      hashed_password: 'not-a-real-password-hash', user_type: 'internal', is_inactive: true });
    const [connection] = await customer.table('scim_connections').insert({ tenant, connection_id: connectionId,
      enabled: true, current_token_generation: 1, current_token_hash: token.hash }).returning('*');
    await customer.table('scim_user_links').insert({ tenant, link_id: linkId, connection_id: connectionId,
      user_id: userId, external_id: externalId, observed_user_name: email, observed_primary_email: email,
      upstream_active: false, link_state: 'active', scim_inactive_at: trx.fn.now() });

    if (options.coManaged) {
      const sponsorTenant = randomUUID();
      const relationshipId = randomUUID();
      const operationId = randomUUID();
      const allocationId = randomUUID();
      const allocationSeats = options.deniedBy === 'full-allocation' ? 1 : 100;
      const sponsor = tenantDb(trx, sponsorTenant);
      await sponsor.table('tenants').insert({ tenant: sponsorTenant, client_name: 'SCIM sponsor',
        email: `sponsor-${sponsorTenant}@example.test`, plan: 'pro', product_code: 'psa' });
      const expired = options.deniedBy === 'expired-entitlement';
      await sponsor.table('co_managed_entitlements').insert({ tenant: sponsorTenant, source: 'hosted',
        source_reference: randomUUID(), capacity: allocationSeats,
        verified_at: expired ? new Date(Date.now() - 40 * 86400000) : new Date(),
        valid_until: expired ? new Date(Date.now() - 40 * 86400000) : new Date(Date.now() + 3600000) });
      await customer.table('co_management_relationships').insert({ tenant, relationship_id: relationshipId,
        sponsor_tenant: sponsorTenant, sponsor_client_id: randomUUID(), state: options.deniedBy === 'ended-relationship' ? 'terminated' : 'active',
        accepted_by: randomUUID(), accepted_at: trx.fn.now(), ended_at: options.deniedBy === 'ended-relationship' ? trx.fn.now() : null });
      await sponsor.table('co_managed_provisioning_operations').insert({ tenant: sponsorTenant,
        operation_id: operationId, allocation_id: allocationId, customer_tenant: tenant, relationship_id: relationshipId,
        requested_by: randomUUID(), escalation_board_id: randomUUID(), customer_board_id: randomUUID(),
        customer_client_id: randomUUID(), administrator_invitation_id: randomUUID(), request_fingerprint: 'a'.repeat(64),
        request: {}, state: 'pending_acceptance' });
      await sponsor.table('co_managed_allocations').insert({ tenant: sponsorTenant, allocation_id: allocationId,
        operation_id: operationId, request_fingerprint: 'a'.repeat(64), customer_tenant: tenant,
        relationship_id: relationshipId, seats: allocationSeats, state: 'active' });
      if (options.deniedBy === 'full-allocation') {
        const otherEmail = `existing-${randomUUID()}@example.test`;
        await customer.table('users').insert({ tenant, user_id: randomUUID(), username: otherEmail, email: otherEmail,
          hashed_password: 'not-a-real-password-hash', user_type: 'internal', is_inactive: false });
      }
    } else if (options.deniedBy === 'ordinary-license') {
      const otherEmail = `existing-${randomUUID()}@example.test`;
      await customer.table('users').insert({ tenant, user_id: randomUUID(), username: otherEmail, email: otherEmail,
        hashed_password: 'not-a-real-password-hash', user_type: 'internal', is_inactive: false });
    }

    return { trx, tenant, userId, linkId, email, externalId, connection, token: token.plaintext };
  }

  function serviceFor(fixture: Awaited<ReturnType<typeof reactivationFixture>>) {
    return new ScimProvisioningService(fixture.trx, fixture.connection,
      `https://example.test/api/scim/v2/${fixture.connection.connection_id}`);
  }

  const activePatch = [{ op: 'replace' as const, path: 'active', value: true }];

  it('POST rejects omitted active for a new identity before provisioning', async () => {
    const fixture = await reactivationFixture();
    const newEmail = `scim-omitted-active-${randomUUID()}@example.test`;
    const payload = {
      schemas: [SCIM_USER_SCHEMA],
      externalId: `entra-${randomUUID()}`,
      userName: newEmail,
    };
    try {
      getAdminConnectionMock.mockResolvedValue(fixture.trx);
      const response = await handleScimPost(new Request('https://example.test/api/scim/v2/test/Users', {
        method: 'POST',
        headers: { authorization: `Bearer ${fixture.token}`, 'content-type': 'application/scim+json' },
        body: JSON.stringify(payload),
      }), { connectionId: fixture.connection.connection_id, scimPath: ['Users'] });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ scimType: 'invalidValue' });
      const customer = tenantDb(fixture.trx, fixture.tenant);
      expect(await customer.table('users').where({ email: newEmail }).first()).toBeUndefined();
      expect(await customer.table('scim_user_links').where({ external_id: payload.externalId }).first()).toBeUndefined();
      expect(await customer.table('scim_unresolved_identities').where({ external_id: payload.externalId }).first()).toBeUndefined();
    } finally { await fixture.trx.rollback(); }
  });

  it('POST rejects omitted active without reactivating an existing SCIM identity', async () => {
    const fixture = await reactivationFixture();
    try {
      getAdminConnectionMock.mockResolvedValue(fixture.trx);
      const customer = tenantDb(fixture.trx, fixture.tenant);
      const linkBefore = await customer.table('scim_user_links').where({ link_id: fixture.linkId })
        .first(['upstream_active', 'link_state', 'scim_inactive_at']);
      const userBefore = await customer.table('users').where({ user_id: fixture.userId }).first('is_inactive');
      const response = await handleScimPost(new Request('https://example.test/api/scim/v2/test/Users', {
        method: 'POST',
        headers: { authorization: `Bearer ${fixture.token}`, 'content-type': 'application/scim+json' },
        body: JSON.stringify({ schemas: [SCIM_USER_SCHEMA], externalId: fixture.externalId,
          userName: fixture.email, active: undefined }),
      }), { connectionId: fixture.connection.connection_id, scimPath: ['Users'] });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ scimType: 'invalidValue' });
      expect(await customer.table('scim_user_links').where({ link_id: fixture.linkId })
        .first(['upstream_active', 'link_state', 'scim_inactive_at'])).toEqual(linkBefore);
      expect(await customer.table('users').where({ user_id: fixture.userId }).first('is_inactive'))
        .toEqual(userBefore);
    } finally { await fixture.trx.rollback(); }
  });

  it('PUT rejects omitted active without reactivating the addressed SCIM identity', async () => {
    const fixture = await reactivationFixture();
    try {
      getAdminConnectionMock.mockResolvedValue(fixture.trx);
      const customer = tenantDb(fixture.trx, fixture.tenant);
      const linkBefore = await customer.table('scim_user_links').where({ link_id: fixture.linkId })
        .first(['upstream_active', 'link_state', 'scim_inactive_at']);
      const userBefore = await customer.table('users').where({ user_id: fixture.userId }).first('is_inactive');
      const response = await handleScimPut(new Request(`https://example.test/api/scim/v2/test/Users/${fixture.linkId}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${fixture.token}`, 'content-type': 'application/scim+json' },
        body: JSON.stringify({ schemas: [SCIM_USER_SCHEMA], externalId: fixture.externalId, userName: fixture.email }),
      }), { connectionId: fixture.connection.connection_id, scimPath: ['Users', fixture.linkId] });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ scimType: 'invalidValue' });
      expect(await customer.table('scim_user_links').where({ link_id: fixture.linkId })
        .first(['upstream_active', 'link_state', 'scim_inactive_at'])).toEqual(linkBefore);
      expect(await customer.table('users').where({ user_id: fixture.userId }).first('is_inactive'))
        .toEqual(userBefore);
    } finally { await fixture.trx.rollback(); }
  });

  it.each([
    ['expired sponsor entitlement', 'expired-entitlement'],
    ['ended relationship', 'ended-relationship'],
    ['exhausted live allocation', 'full-allocation'],
  ] as const)('denies reactivation when co-managed admission fails: %s', async (_label, deniedBy) => {
    const fixture = await reactivationFixture({ coManaged: true, deniedBy });
    try {
      await expect(serviceFor(fixture).patchUser(fixture.linkId, activePatch)).rejects.toMatchObject({ status: 409 });
      expect(await tenantDb(fixture.trx, fixture.tenant).table('users').where({ user_id: fixture.userId }).first('is_inactive'))
        .toMatchObject({ is_inactive: true });
    } finally { await fixture.trx.rollback(); }
  });

  it('reactivates an eligible co-managed user and commits admission with the update', async () => {
    const fixture = await reactivationFixture({ coManaged: true });
    try {
      const resource = await serviceFor(fixture).patchUser(fixture.linkId, activePatch);
      expect(resource.active).toBe(true);
      expect(await tenantDb(fixture.trx, fixture.tenant).table('users').where({ user_id: fixture.userId }).first('is_inactive'))
        .toMatchObject({ is_inactive: false });
    } finally { await fixture.trx.rollback(); }
  });

  it('keeps ordinary tenant license enforcement and rolls back the attempted activation', async () => {
    const fixture = await reactivationFixture({ deniedBy: 'ordinary-license' });
    try {
      await expect(serviceFor(fixture).patchUser(fixture.linkId, activePatch)).rejects.toMatchObject({ status: 409 });
      expect(await tenantDb(fixture.trx, fixture.tenant).table('users').where({ user_id: fixture.userId }).first('is_inactive'))
        .toMatchObject({ is_inactive: true });
    } finally { await fixture.trx.rollback(); }
  });

  it('links one exact-email internal user and applies reversible lifecycle changes', async () => {
    const trx = await db.transaction();
    try {
      const discovery = tenantDb(trx, '__scim_integration_discovery__');
      const tenantRow = await discovery
        .unscoped('tenants as t', 'SCIM integration test selects a tenant with no configured connection')
        .whereNotExists(
          discovery
            .unscoped('scim_connections as c', 'SCIM integration test excludes configured tenants')
            .select(trx.raw('1'))
            .whereRaw('c.tenant = t.tenant')
        )
        .select('t.tenant')
        .first();
      expect(tenantRow?.tenant).toBeTruthy();

      const tenant = tenantRow.tenant as string;
      const scoped = tenantDb(trx, tenant);
      const userId = randomUUID();
      const email = `scim-${randomUUID()}@example.test`;

      await scoped.table('users').insert({
        tenant,
        user_id: userId,
        username: email,
        email,
        hashed_password: 'not-a-real-password-hash',
        user_type: 'internal',
        is_inactive: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      const [connection] = await scoped.table('scim_connections').insert({
        tenant,
        enabled: true,
        current_token_generation: 1,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      }).returning('*');

      const service = new ScimProvisioningService(
        trx,
        connection,
        `https://example.test/api/scim/v2/${connection.connection_id}`
      );

      const created = await service.createUser({
        externalId: `entra-${randomUUID()}`,
        userName: email.toUpperCase(),
        primaryEmail: email.toUpperCase(),
        active: true,
        displayName: 'SCIM Integration User',
        givenName: 'SCIM',
        familyName: 'User',
        title: 'Tester',
      });
      expect(created.id).toBeTruthy();
      expect(created.active).toBe(true);
      const userCount = await scoped.table('users').where('user_id', userId).count('* as count').first();
      expect(Number(userCount?.count)).toBe(1);

      const sessionId = randomUUID();
      await scoped.table('sessions').insert({
        tenant,
        session_id: sessionId,
        user_id: userId,
        token: '',
        expires_at: new Date(Date.now() + 60_000),
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      const deactivated = await service.patchUser(String(created.id), [
        { op: 'replace', path: 'active', value: false },
      ]);
      expect(deactivated.active).toBe(false);
      expect(await scoped.table('users').where('user_id', userId).first('is_inactive'))
        .toMatchObject({ is_inactive: true });
      expect(await scoped.table('sessions').where('session_id', sessionId).first('revoked_reason'))
        .toMatchObject({ revoked_reason: 'scim' });

      const reactivated = await service.patchUser(String(created.id), [
        { op: 'replace', path: 'active', value: true },
      ]);
      expect(reactivated.active).toBe(true);
      expect(await scoped.table('users').where('user_id', userId).first('is_inactive'))
        .toMatchObject({ is_inactive: false });

      await scoped.table('users').where('user_id', userId).update({ is_inactive: true });
      await service.patchUser(String(created.id), [
        { op: 'replace', path: 'active', value: false },
      ]);
      expect(await scoped.table('scim_user_links').where('link_id', created.id).first('scim_inactive_at'))
        .toMatchObject({ scim_inactive_at: null });

      await service.patchUser(String(created.id), [
        { op: 'replace', path: 'active', value: true },
      ]);
      expect(await scoped.table('users').where('user_id', userId).first('is_inactive'))
        .toMatchObject({ is_inactive: true });

      await service.deleteUser(String(created.id));
      expect(await scoped.table('users').where('user_id', userId).first()).toBeTruthy();
      expect(await scoped.table('scim_user_links').where('link_id', created.id).first('link_state'))
        .toMatchObject({ link_state: 'deprovisioned' });

      const unresolvedExternalId = `entra-${randomUUID()}`;
      await expect(service.createUser({
        externalId: unresolvedExternalId,
        userName: `missing-${randomUUID()}@example.test`,
        primaryEmail: `missing-${randomUUID()}@example.test`,
        active: false,
        displayName: 'Inactive unresolved user',
        givenName: null,
        familyName: null,
        title: null,
      })).rejects.toMatchObject({ status: 409 });
      expect(await scoped.table('scim_unresolved_identities')
        .where('external_id', unresolvedExternalId)
        .first('observed_active'))
        .toMatchObject({ observed_active: false });
    } finally {
      await trx.rollback();
    }
  });

  it('keeps the transaction usable when a link insert loses the uniqueness race', async () => {
    const trx = await db.transaction();
    try {
      const discovery = tenantDb(trx, '__scim_integration_discovery__');
      const tenantRow = await discovery
        .unscoped('tenants as t', 'SCIM integration test selects a tenant with no configured connection')
        .whereNotExists(
          discovery
            .unscoped('scim_connections as c', 'SCIM integration test excludes configured tenants')
            .select(trx.raw('1'))
            .whereRaw('c.tenant = t.tenant')
        )
        .select('t.tenant')
        .first();
      expect(tenantRow?.tenant).toBeTruthy();

      const tenant = tenantRow.tenant as string;
      const scoped = tenantDb(trx, tenant);
      const userId = randomUUID();
      const email = `scim-${randomUUID()}@example.test`;

      await scoped.table('users').insert({
        tenant,
        user_id: userId,
        username: email,
        email,
        hashed_password: 'not-a-real-password-hash',
        user_type: 'internal',
        is_inactive: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });
      const [connection] = await scoped.table('scim_connections').insert({
        tenant,
        enabled: true,
        current_token_generation: 1,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      }).returning('*');

      const service = new ScimProvisioningService(
        trx,
        connection,
        `https://example.test/api/scim/v2/${connection.connection_id}`
      );

      // An administrator-unlinked tombstone still occupies the externalId index
      // entry, so the insert below violates it exactly like a lost race would.
      const externalId = `entra-${randomUUID()}`;
      await scoped.table('scim_user_links').insert({
        tenant,
        connection_id: connection.connection_id,
        user_id: userId,
        external_id: externalId,
        observed_user_name: email,
        observed_primary_email: email,
        upstream_active: true,
        link_state: 'unlinked',
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      const secondUserId = randomUUID();
      const secondEmail = `scim-${randomUUID()}@example.test`;
      await scoped.table('users').insert({
        tenant,
        user_id: secondUserId,
        username: secondEmail,
        email: secondEmail,
        hashed_password: 'not-a-real-password-hash',
        user_type: 'internal',
        is_inactive: false,
        created_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

      // The conflict is reported as a SCIM 409 rather than surfacing as an
      // aborted-transaction error...
      await expect(service.createUser({
        externalId,
        userName: secondEmail,
        primaryEmail: secondEmail,
        active: true,
        displayName: 'Conflicting SCIM user',
        givenName: null,
        familyName: null,
        title: null,
      })).rejects.toMatchObject({ status: 409 });

      // ...and the writes that follow the failed insert are committed, which is
      // only possible if the failure rolled back to a savepoint.
      expect(await scoped.table('scim_unresolved_identities')
        .where('external_id', externalId)
        .first('failure_reason'))
        .toMatchObject({ failure_reason: 'identity_conflict' });
      expect(await scoped.table('scim_operations')
        .where({ external_id: externalId, outcome: 'rejected' })
        .first('detail_code'))
        .toMatchObject({ detail_code: 'identity_conflict' });

      // The transaction is still healthy for unrelated work.
      expect(await scoped.table('users').where('user_id', secondUserId).first('user_id'))
        .toMatchObject({ user_id: secondUserId });
    } finally {
      await trx.rollback();
    }
  });
});
