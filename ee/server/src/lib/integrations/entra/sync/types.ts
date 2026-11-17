export interface EntraSyncUser {
  entraTenantId: string;
  entraObjectId: string;
  userPrincipalName: string | null;
  email: string | null;
  displayName: string | null;
  givenName: string | null;
  surname: string | null;
  accountEnabled: boolean;
  userType?: 'Member' | 'Guest' | null;
  assignedLicenseCount?: number | null;
  mailboxKind?: 'shared' | null;
  jobTitle: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
  clientPortalEntitlement?: {
    groupId: string | null;
    membershipMode: 'transitive';
    isMember: boolean | null;
  };
  raw: Record<string, unknown>;
}

export interface EntraSyncTenantContext {
  tenantId: string;
  managedTenantId: string;
  clientId: string | null;
}

export function normalizeEntraSyncUser(
  input: Omit<EntraSyncUser, 'businessPhones' | 'raw' | 'userType' | 'assignedLicenseCount'> &
    Partial<Pick<EntraSyncUser, 'businessPhones' | 'raw' | 'userType' | 'assignedLicenseCount'>>
): EntraSyncUser {
  const businessPhones = Array.isArray(input.businessPhones)
    ? input.businessPhones
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    : [];

  return {
    ...input,
    userType: input.userType === 'Member' || input.userType === 'Guest' ? input.userType : null,
    assignedLicenseCount: typeof input.assignedLicenseCount === 'number' && Number.isFinite(input.assignedLicenseCount) ? input.assignedLicenseCount : null,
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

export type EntraSyncUserIssueStage = 'match' | 'link' | 'create';

/** Maximum number of per-user issues persisted on one tenant result row. */
export const ENTRA_SYNC_USER_ISSUE_LIMIT = 100;

// LEVERAGE: pattern entra-user-issue-shape — same issue DTO declared in server sync/types.ts, temporal types/entra-sync.ts and integrations entraActions.ts; no shared package spans the workflow sandbox, server and UI
export interface EntraSyncUserIssue {
  /** 'failure': the user was not (fully) synced. 'notice': synced, but a field value was changed or left out. */
  severity: 'failure' | 'notice';
  stage: EntraSyncUserIssueStage;
  entraObjectId: string;
  userPrincipalName: string | null;
  displayName: string | null;
  /** Set when the contact write succeeded before the failure, or for notices on a synced contact. */
  contactNameId?: string | null;
  /** For notices: which field the notice is about. Only 'phone_numbers' today. */
  field?: 'phone_numbers';
  message: string;
}
