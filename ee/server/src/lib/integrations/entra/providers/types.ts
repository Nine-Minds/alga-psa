import type { EntraSyncUser } from '../sync/types';

export interface EntraManagedTenantRecord {
  entraTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
  sourceUserCount: number;
  raw: Record<string, unknown>;
}

export type EntraManagedUserRecord = EntraSyncUser;

export interface EntraProviderAdapterContext {
  tenant: string;
}

export interface EntraListManagedTenantsInput extends EntraProviderAdapterContext {}

export interface EntraListUsersForTenantInput extends EntraProviderAdapterContext {
  managedTenantId: string;
}

export interface EntraProviderAdapter {
  readonly connectionType: 'direct' | 'cipp';
  listManagedTenants(input: EntraListManagedTenantsInput): Promise<EntraManagedTenantRecord[]>;
  listUsersForTenant(input: EntraListUsersForTenantInput): Promise<EntraManagedUserRecord[]>;
}
