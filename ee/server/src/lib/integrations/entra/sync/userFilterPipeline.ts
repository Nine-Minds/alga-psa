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

export interface EntraFilteredOutUser {
  user: EntraSyncUser;
  reason: 'account_disabled' | 'missing_identity' | 'service_account';
}

export interface EntraUserFilterResult {
  included: EntraSyncUser[];
  excluded: EntraFilteredOutUser[];
}

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

export function filterEntraUsers(users: EntraSyncUser[]): EntraUserFilterResult {
  const serviceAccountPatterns = compilePatterns(DEFAULT_SERVICE_ACCOUNT_PATTERNS);
  const included: EntraSyncUser[] = [];
  const excluded: EntraFilteredOutUser[] = [];

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

    if (userMatchesPatterns(user, serviceAccountPatterns)) {
      excluded.push({ user, reason: 'service_account' });
      continue;
    }

    included.push(user);
  }

  return {
    included,
    excluded,
  };
}

export function getDefaultServiceAccountPatterns(): string[] {
  return [...DEFAULT_SERVICE_ACCOUNT_PATTERNS];
}
