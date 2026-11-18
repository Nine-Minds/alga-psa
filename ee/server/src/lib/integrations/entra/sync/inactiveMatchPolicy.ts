import type { EntraSyncUser } from './types';

/**
 * An inactive contact at the synced client is that person, so linking it brings it back, but only
 * while the Microsoft account is enabled. A disabled account's contact stays inactive: that is the
 * disable rule (shared mailboxes, disabled by nature, have their own recovery in contactReconciler).
 */
export function shouldReactivateInactiveMatch(contactIsInactive: boolean, user: Pick<EntraSyncUser, 'accountEnabled'>): boolean {
  return contactIsInactive && user.accountEnabled !== false;
}
