export interface EntraManagedTenantRecord {
  entraTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
  sourceUserCount: number;
  raw: Record<string, unknown>;
}

export interface EntraManagedUserRecord {
  entraTenantId: string;
  entraObjectId: string;
  userPrincipalName: string | null;
  email: string | null;
  displayName: string | null;
  givenName: string | null;
  surname: string | null;
  accountEnabled: boolean;
  jobTitle: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
  raw: Record<string, unknown>;
}

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
