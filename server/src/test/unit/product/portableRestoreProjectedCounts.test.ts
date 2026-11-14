import { describe, expect, it } from 'vitest';
import { portableRestoreExpectedCounts } from '../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestore';
import { prepareCoManagedPortableWorkspaceFiles } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreFiles';
import { fixtureManifest, prepare, id, ADMIN, SOURCE } from './portableRestoreFixtures';

describe('portable restore verification counts', () => {
  it('includes native audit rows projected from retained handoff history', async () => {
    const { manifest, files } = await fixtureManifest(add => add('handoff_history', {
      operation_id: id(70), ticket_id: id(32), revision: 1, transition: 'handed_back', actor_tenant: SOURCE,
      actor_user_id: ADMIN, actor_name: 'A B', actor_organization: 'Customer', note: 'Returned to customer',
      audience: 'shared_it', occurred_at: '2026-01-01T00:00:00.000Z',
    }));
    const records = prepare(manifest);
    const prepared = prepareCoManagedPortableWorkspaceFiles({ manifest, files, preparedRecords: records,
      importedByUserId: records.records.users[0].user_id as string });

    expect(prepared.profiles.find(profile => profile.id === 'work')?.project?.(prepared).ticket_audit_logs).toHaveLength(1);
    expect(portableRestoreExpectedCounts(prepared).ticket_audit_logs).toBe(1);
  });
});
