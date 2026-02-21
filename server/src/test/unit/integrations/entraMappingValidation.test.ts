import { describe, expect, it } from 'vitest';

import { findManagedTenantAssignmentConflicts } from '@ee/lib/integrations/entra/mapping/validation';

describe('findManagedTenantAssignmentConflicts', () => {
  it('T025: flags duplicate managed-tenant assignments to different clients', () => {
    const conflicts = findManagedTenantAssignmentConflicts([
      { managedTenantId: 'managed-1', clientId: 'client-a' },
      { managedTenantId: 'managed-1', clientId: 'client-b' },
      { managedTenantId: 'managed-2', clientId: 'client-c' },
    ]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      managedTenantId: 'managed-1',
      clientIds: expect.arrayContaining(['client-a', 'client-b']),
    });
  });

  it('ignores rows without both managedTenantId and clientId', () => {
    const conflicts = findManagedTenantAssignmentConflicts([
      { managedTenantId: 'managed-1', clientId: 'client-a' },
      { managedTenantId: 'managed-1', clientId: 'client-a' },
      { managedTenantId: '', clientId: 'client-b' },
      { managedTenantId: 'managed-2', clientId: null },
    ] as Array<{ managedTenantId: string; clientId: string | null }>);

    expect(conflicts).toEqual([]);
  });
});
