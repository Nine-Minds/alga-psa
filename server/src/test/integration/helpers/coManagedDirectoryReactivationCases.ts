import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { acceptCoManagedRelationship } from '../../../../../packages/co-managed/src/acceptance';

// SCIM provisioning lives in the enterprise server, so this case stays under
// server/ — the co-managed bootstrap suite it belongs to runs from the Temporal
// worker's integration directory, which must not reach into ee/server.
export function registerCoManagedDirectoryReactivationCases(
  getDb: () => Knex,
  readyForAcceptance: () => Promise<any>,
  createCustomerTechnician: (tenant: string, email?: string) => Promise<any>,
) {
  describe('co-managed directory reactivation', () => {
    it('keeps a directory-deactivated user inactive when another technician has taken the available seat', async () => {
      const db = getDb();
      const { customer, actor, input } = await readyForAcceptance(); await acceptCoManagedRelationship(db, actor, input);
      const linked = await createCustomerTechnician(actor.tenant, 'directory-tech@example.test');
      const [connection] = await customer.table('scim_connections').insert({ tenant: actor.tenant, enabled: true,
        current_token_generation: 1, created_at: new Date(), updated_at: new Date() }).returning('*');
      const { ScimProvisioningService } = await import('../../../../../ee/server/src/lib/scim/service');
      const service = new ScimProvisioningService(db, connection, 'https://example.test/scim');
      const resource = await service.createUser({ externalId: randomUUID(), userName: linked.email, primaryEmail: linked.email,
        active: true, displayName: 'Directory Tech', givenName: 'Directory', familyName: 'Tech', title: null });
      await service.patchUser(String(resource.id), [{ op: 'replace', path: 'active', value: false }]);
      await createCustomerTechnician(actor.tenant);
      await expect(service.patchUser(String(resource.id), [{ op: 'replace', path: 'active', value: true }])).rejects.toThrow('allocation is full');
      expect(await customer.table('users').where('user_id', linked.user_id).first()).toMatchObject({ is_inactive: true });
    });
  });
}
