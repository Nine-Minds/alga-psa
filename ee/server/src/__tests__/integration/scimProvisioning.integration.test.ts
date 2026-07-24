import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '@ee/lib/testing/db-test-utils';
import { ScimProvisioningService } from '@ee/lib/scim/service';

describe('SCIM provisioning database lifecycle', () => {
  let db: Knex;

  beforeAll(() => {
    db = createTestDbConnection();
  });

  afterAll(async () => {
    await db.destroy();
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
});
