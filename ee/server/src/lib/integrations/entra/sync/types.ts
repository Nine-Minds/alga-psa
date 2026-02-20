export interface EntraSyncUser {
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

export interface EntraSyncTenantContext {
  tenantId: string;
  managedTenantId: string;
  clientId: string | null;
}

export function normalizeEntraSyncUser(
  input: Omit<EntraSyncUser, 'businessPhones' | 'raw'> &
    Partial<Pick<EntraSyncUser, 'businessPhones' | 'raw'>>
): EntraSyncUser {
  const businessPhones = Array.isArray(input.businessPhones)
    ? input.businessPhones
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : [];

  return {
    ...input,
    userPrincipalName: typeof input.userPrincipalName === 'string' ? input.userPrincipalName.trim() : null,
    email: typeof input.email === 'string' ? input.email.trim() : null,
    displayName: typeof input.displayName === 'string' ? input.displayName.trim() : null,
    givenName: typeof input.givenName === 'string' ? input.givenName.trim() : null,
    surname: typeof input.surname === 'string' ? input.surname.trim() : null,
    jobTitle: typeof input.jobTitle === 'string' ? input.jobTitle.trim() : null,
    mobilePhone: typeof input.mobilePhone === 'string' ? input.mobilePhone.trim() : null,
    businessPhones,
    raw: input.raw && typeof input.raw === 'object' ? input.raw : {},
  };
}
