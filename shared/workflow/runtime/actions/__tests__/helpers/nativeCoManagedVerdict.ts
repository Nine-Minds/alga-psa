import { afterEach, beforeEach } from 'vitest';
import { invalidateCapability, registerCapabilityParticipation } from '@alga-psa/core/capability';

/**
 * Workflow ticket mutations fail closed unless the co-managed capability gives a definite verdict
 * (`retainWorkflowTicketAuthority`). Tests that exercise native (non co-managed) ticket actions must
 * therefore say so: register a participation resolver that answers "no tenant participates", so the
 * tenant resolves `not-participating` exactly as a plain native tenant does in a registered worker.
 *
 * Call once inside a `describe` block; hooks restore the unregistered state afterwards.
 */
export function useNativeCoManagedVerdict(): void {
  beforeEach(() => {
    registerCapabilityParticipation('co-managed', async () => []);
    invalidateCapability('co-managed');
  });
  afterEach(() => {
    registerCapabilityParticipation('co-managed', null);
    invalidateCapability('co-managed');
  });
}
