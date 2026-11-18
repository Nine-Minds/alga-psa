import { describe, expect, it } from 'vitest';
import { shouldReactivateInactiveMatch } from '@ee/lib/integrations/entra/sync/inactiveMatchPolicy';

// An inactive contact at the synced client is that person and linking it brings it back, but a
// disabled Microsoft account must leave it inactive: otherwise every sync would undo the disable rule.
describe('shouldReactivateInactiveMatch', () => {
  it('reactivates an inactive same-client match while the account is enabled', () => {
    expect(shouldReactivateInactiveMatch(true, { accountEnabled: true })).toBe(true);
  });

  it('leaves the contact inactive when the account is disabled (shared mailboxes have their own recovery)', () => {
    expect(shouldReactivateInactiveMatch(true, { accountEnabled: false })).toBe(false);
  });

  it('does nothing to an active contact', () => {
    expect(shouldReactivateInactiveMatch(false, { accountEnabled: true })).toBe(false);
  });
});
