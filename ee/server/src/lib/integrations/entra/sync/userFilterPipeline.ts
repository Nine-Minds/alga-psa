import type { EntraSyncUser } from './types';

export interface EntraFilteredOutUser {
  user: EntraSyncUser;
  reason: 'account_disabled' | 'missing_identity';
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

export function filterEntraUsers(users: EntraSyncUser[]): EntraUserFilterResult {
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

    included.push(user);
  }

  return {
    included,
    excluded,
  };
}
