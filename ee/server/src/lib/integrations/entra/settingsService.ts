import { createTenantKnex, runWithTenant } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import type { EntraProviderAdapter } from './providers/types';
import { filterEntraUsers, type EntraUserFilterOptions, type EntraUserFilterResult } from './sync/userFilterPipeline';
import type { EntraSyncUser } from './sync/types';
import { EMPTY_ENTRA_USER_FILTER_CONFIG, mergeEntraUserFilterConfig, parseEntraUserFilterConfig, parseEntraUserFilterOverride, type EntraUserFilterConfig } from './sync/userFilterConfig';

export interface EntraUserFilterSettings { exclusionPatterns: string[] }

/** Resolves each directory group once and shares the result across filters and portal entitlement. */
export class GroupMembershipResolver {
  private readonly groups = new Map<string, Promise<Set<string>>>();
  constructor(private readonly input: { tenant: string; entraTenantId: string; adapter: EntraProviderAdapter; users?: EntraSyncUser[] }) {}
  members(groupId: string, membershipMode: 'direct' | 'transitive' = 'transitive'): Promise<Set<string>> {
    const key = `${groupId}:${membershipMode}`;
    let result = this.groups.get(key);
    if (!result) {
      result = this.input.adapter.listSecurityGroupMemberIds({ tenant: this.input.tenant, managedTenantId: this.input.entraTenantId, groupId, membershipMode, users: this.input.users });
      this.groups.set(key, result);
    }
    return result;
  }
  async isMember(groupId: string, userId: string, membershipMode: 'direct' | 'transitive' = 'transitive'): Promise<boolean> { return (await this.members(groupId, membershipMode)).has(userId); }
}
export async function getEntraUserFilterSettings(tenant: string): Promise<EntraUserFilterSettings> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();
    const row = await tenantDb(knex, tenant).table('entra_sync_settings').where({ tenant }).first(['user_filter_config']);
    return { exclusionPatterns: parseEntraUserFilterConfig(row?.user_filter_config).exclusionPatterns };
  });
}

export async function resolveEntraUserFilterPolicy(input: {
  tenant: string; managedTenantId: string; entraTenantId: string; adapter: EntraProviderAdapter; users?: EntraSyncUser[];
}): Promise<EntraUserFilterOptions> {
  const { defaults, override } = await runWithTenant(input.tenant, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, input.tenant);
    const [settings, tenantOverride] = await Promise.all([
      db.table('entra_sync_settings').where({ tenant: input.tenant }).first(['user_filter_config']),
      db.table('entra_managed_tenant_user_filters').where({ tenant: input.tenant, managed_tenant_id: input.managedTenantId }).first(['filter_config']).catch((error: any) => {
        if (error?.code === '42P01') return undefined;
        throw error;
      }),
    ]);
    return { defaults: parseEntraUserFilterConfig(settings?.user_filter_config), override: tenantOverride ? parseEntraUserFilterOverride(tenantOverride.filter_config) : null };
  });
  const effective: EntraUserFilterConfig = mergeEntraUserFilterConfig(defaults || EMPTY_ENTRA_USER_FILTER_CONFIG, override);
  const resolver = new GroupMembershipResolver({ tenant: input.tenant, entraTenantId: input.entraTenantId, adapter: input.adapter, users: input.users });
  const includeMemberIds = new Set<string>();
  const excludeMemberIds = new Set<string>();
  for (const groupId of effective.includeGroupIds) {
    const ids = await resolver.members(groupId);
    for (const id of ids) includeMemberIds.add(id);
  }
  for (const groupId of effective.excludeGroupIds) {
    const ids = await resolver.members(groupId);
    for (const id of ids) excludeMemberIds.add(id);
  }
  return { customExclusionPatterns: effective.exclusionPatterns, memberUsersOnly: effective.memberUsersOnly, licensedUsersOnly: effective.licensedUsersOnly, includeGroupIds: effective.includeGroupIds, excludeGroupIds: effective.excludeGroupIds, includeMemberIds, excludeMemberIds, deactivateExcludedContacts: effective.deactivateExcludedContacts, groupMembershipResolver: resolver };
}

export async function filterEntraUsersForManagedTenant(input: Parameters<typeof resolveEntraUserFilterPolicy>[0]): Promise<EntraUserFilterResult> {
  const policy = await resolveEntraUserFilterPolicy(input);
  return filterEntraUsers(input.users ?? [], policy);
}
