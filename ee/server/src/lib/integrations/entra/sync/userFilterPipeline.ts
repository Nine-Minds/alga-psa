import type { EntraSyncUser } from './types';

const DEFAULT_SERVICE_ACCOUNT_PATTERNS = [
  '^svc[-_.]',
  '^sa[-_.]',
  '^system[-_.]',
  '^service[-_.]?account',
  'noreply|no-reply|do[-_.]?not[-_.]?reply|donotreply',
  'shared[-_. ]?mailbox',
  'automation|automated|daemon|bot',
];

export interface EntraUserFilterOptions {
  customExclusionPatterns?: string[];
  memberUsersOnly?: boolean;
  licensedUsersOnly?: boolean;
  includeGroupIds?: string[];
  excludeGroupIds?: string[];
  includeMemberIds?: Set<string>;
  excludeMemberIds?: Set<string>;
  deactivateExcludedContacts?: boolean;
  groupMembershipResolver?: { isMember(groupId: string, userId: string, membershipMode?: 'direct' | 'transitive'): Promise<boolean> };
}

export interface EntraFilteredOutUser {
  user: EntraSyncUser;
  reason: 'account_disabled' | 'missing_identity' | 'guest_user' | 'unlicensed' | 'service_account' | 'tenant_custom_pattern' | 'excluded_group' | 'not_in_included_group';
}

export interface EntraUserFilterResult {
  included: EntraSyncUser[];
  excluded: EntraFilteredOutUser[];
  deactivateExcludedContacts: boolean;
  unknownFieldCounts: { userType: number; assignedLicenseCount: number };
  groupMembershipResolver: NonNullable<EntraUserFilterOptions['groupMembershipResolver']>;
}

const EMPTY_GROUP_MEMBERSHIP_RESOLVER = { isMember: async () => false };

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getCandidateIdentity(user: EntraSyncUser): string {
  return normalizeString(user.userPrincipalName || user.email);
}

function isLikelyEmail(value: string): boolean {
  if (!value) {
    return false;
  }

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const rawPattern of patterns) {
    try {
      const pattern = rawPattern.trim();
      if (!pattern) continue;
      compiled.push(new RegExp(pattern, 'i'));
    } catch {
      // Pattern list is static today, but keep parser resilient for future extensions.
    }
  }
  return compiled;
}

function userMatchesPatterns(user: EntraSyncUser, patterns: RegExp[]): boolean {
  if (patterns.length === 0) {
    return false;
  }

  const upn = normalizeString(user.userPrincipalName);
  const email = normalizeString(user.email);
  const displayName = normalizeString(user.displayName);
  const principal = upn.includes('@') ? upn.split('@')[0] : upn;
  const haystacks = [upn, email, displayName, principal].filter(Boolean);

  return patterns.some((pattern) => haystacks.some((value) => pattern.test(value)));
}

export function filterEntraUsers(
  users: EntraSyncUser[],
  options: EntraUserFilterOptions = {}
): EntraUserFilterResult {
  const serviceAccountPatterns = compilePatterns(DEFAULT_SERVICE_ACCOUNT_PATTERNS);
  const tenantCustomPatterns = compilePatterns(options.customExclusionPatterns || []);
  const included: EntraSyncUser[] = [];
  const excluded: EntraFilteredOutUser[] = [];
  const unknownFieldCounts = { userType: 0, assignedLicenseCount: 0 };

  for (const user of users) {
    if (!user.accountEnabled) {
      excluded.push({ user, reason: 'account_disabled' });
      continue;
    }

    const candidateIdentity = getCandidateIdentity(user);
    if (!isLikelyEmail(candidateIdentity)) {
      excluded.push({ user, reason: 'missing_identity' });
      continue;
    }

    // Missing provider data is deliberately fail-open and is counted by callers.
    if (options.memberUsersOnly) {
      if (user.userType === 'Guest') { excluded.push({ user, reason: 'guest_user' }); continue; }
      if (user.userType == null) unknownFieldCounts.userType += 1;
    }
    if (options.licensedUsersOnly) {
      if (user.assignedLicenseCount === 0) { excluded.push({ user, reason: 'unlicensed' }); continue; }
      if (user.assignedLicenseCount == null) unknownFieldCounts.assignedLicenseCount += 1;
    }

    if (userMatchesPatterns(user, serviceAccountPatterns)) {
      excluded.push({ user, reason: 'service_account' });
      continue;
    }

    if (userMatchesPatterns(user, tenantCustomPatterns)) {
      excluded.push({ user, reason: 'tenant_custom_pattern' });
      continue;
    }

    if (options.excludeMemberIds?.has(user.entraObjectId)) {
      excluded.push({ user, reason: 'excluded_group' });
      continue;
    }
    if ((options.includeGroupIds?.length || 0) > 0 && !options.includeMemberIds?.has(user.entraObjectId)) {
      excluded.push({ user, reason: 'not_in_included_group' });
      continue;
    }

    included.push(user);
  }

  return {
    included,
    excluded,
    deactivateExcludedContacts: Boolean(options.deactivateExcludedContacts),
    unknownFieldCounts,
    groupMembershipResolver: options.groupMembershipResolver ?? EMPTY_GROUP_MEMBERSHIP_RESOLVER,
  };
}

export function getDefaultServiceAccountPatterns(): string[] {
  return [...DEFAULT_SERVICE_ACCOUNT_PATTERNS];
}
