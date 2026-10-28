/** Exercise the central REST error handler with real lifecycle refusals. */
import { describe, expect, it, vi } from 'vitest';
describe('REST error mapping (real handleApiError)', () => {
  it.each([
    ['read_only', 423, 'CO_MANAGED_READ_ONLY'],
    ['terminated', 423, 'CO_MANAGED_READ_ONLY'],
    ['pending_acceptance', 409, 'CO_MANAGED_NOT_ACTIVE'],
  ] as const)('a thrown CoManagedLifecycleError (%s) becomes HTTP %i / %s', async (state, status, code) => {
    const { handleApiError } = await import('server/src/lib/api/middleware/apiMiddleware');
    const { CoManagedLifecycleError } = await import('@alga-psa/licensing/lib/co-managed-lifecycle-error');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = handleApiError(new CoManagedLifecycleError({ state, canWrite: false, graceEndsAt: null }));
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.error.code).toBe(code);
    } finally {
      quiet.mockRestore();
    }
  });
});
