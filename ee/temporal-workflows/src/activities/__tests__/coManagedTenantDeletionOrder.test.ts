import { describe, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';

describe('co-managed closure tables in tenant deletion', () => {
  it('deletes closures and archive manifests with the tenant, preserving another tenant', async () => {
    await expectTenantDeletion([
      ['co_managed_relationship_closures', 'tenants'],
      ['co_managed_archive_manifests', 'tenants'],
    ]);
  });
});
