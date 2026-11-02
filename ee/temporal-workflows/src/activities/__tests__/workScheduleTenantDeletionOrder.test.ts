import { describe, expect, it } from 'vitest';
import { expectTenantDeletion } from '../../test-utils/tenant-deletion-harness';
import { getTenantTableScope } from '../../../../../packages/db/src/lib/tenantTableMetadata';

describe('work schedule tenant deletion ordering', () => {
  it('deletes work schedules before users and tenants, preserving another tenant', async () => {
    await expectTenantDeletion([
      ['user_work_schedules', 'users'],
      ['users', 'tenants'],
    ]);
    expect(getTenantTableScope('user_work_schedules')).toEqual({ scope: 'tenant' });
  });
});
