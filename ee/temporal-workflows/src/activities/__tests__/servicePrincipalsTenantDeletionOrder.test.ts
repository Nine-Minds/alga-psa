import { describe, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';

describe('service principal tenant deletion', () => {
  it('deletes service identities before users and preserves another tenant', async () => {
    await expectTenantDeletion([
      ['service_principals', 'users'],
      ['users', 'tenants'],
    ]);
  });
});
