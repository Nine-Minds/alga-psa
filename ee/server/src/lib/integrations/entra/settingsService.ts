import { createTenantKnex, runWithTenant } from '@/lib/db';
import { filterEntraUsers, type EntraUserFilterResult } from './sync/userFilterPipeline';
import type { EntraSyncUser } from './sync/types';

export interface EntraUserFilterSettings {
  exclusionPatterns: string[];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function parseExclusionPatterns(userFilterConfig: unknown): string[] {
  if (!userFilterConfig || typeof userFilterConfig !== 'object' || Array.isArray(userFilterConfig)) {
    return [];
  }

  const config = userFilterConfig as Record<string, unknown>;
  return [
    ...toStringArray(config.exclusionPatterns),
    ...toStringArray(config.excludePatterns),
    ...toStringArray(config.excludeUpnPatterns),
    ...toStringArray(config.excludedUpnPatterns),
  ];
}

export async function getEntraUserFilterSettings(
  tenant: string
): Promise<EntraUserFilterSettings> {
  return runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();
    const row = await knex('entra_sync_settings')
      .where({ tenant })
      .first(['user_filter_config']);

    return {
      exclusionPatterns: parseExclusionPatterns(row?.user_filter_config),
    };
  });
}

export async function filterEntraUsersForTenant(
  tenant: string,
  users: EntraSyncUser[]
): Promise<EntraUserFilterResult> {
  const settings = await getEntraUserFilterSettings(tenant);
  return filterEntraUsers(users, {
    customExclusionPatterns: settings.exclusionPatterns,
  });
}
