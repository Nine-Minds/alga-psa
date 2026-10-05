import { describe, expect, it, vi } from 'vitest';
import { GroupMembershipResolver } from '@ee/lib/integrations/entra/settingsService';

describe('GroupMembershipResolver', () => {
  it('preserves direct and transitive results, caches by mode, and represents no group as null at the caller', async () => {
    const listSecurityGroupMemberIds = vi.fn(async ({ membershipMode }: { membershipMode: 'direct' | 'transitive' }) => membershipMode === 'direct' ? new Set(['direct-user']) : new Set(['direct-user', 'nested-user']));
    const resolver = new GroupMembershipResolver({ tenant: 'tenant', entraTenantId: 'entra-tenant', adapter: { listSecurityGroupMemberIds } as any });
    expect(await resolver.isMember('group', 'nested-user', 'direct')).toBe(false);
    expect(await resolver.isMember('group', 'nested-user', 'transitive')).toBe(true);
    expect(await resolver.isMember('group', 'direct-user', 'direct')).toBe(true);
    expect(listSecurityGroupMemberIds).toHaveBeenCalledTimes(2);
    const membershipFor = (groupId: string | null, userId: string) => groupId ? resolver.isMember(groupId, userId) : null;
    expect(await membershipFor(null, 'direct-user')).toBeNull();
  });
});
